"""Yerel-önce kalması gereken şeyler.

Neden ayrı bir politika
-----------------------
The Fool yerel bir üründür: model, konuşma tanıma ve seslendirme kullanıcının
kendi makinesinde koşar. Upstream ise bulut sağlayıcılarını birinci sınıf
kabul ediyor ve yerel yol tökezlediğinde sessizce onlara düşüyor. İki ürünün
varsayılanı burada çelişiyor ve çelişkinin bedelini kullanıcı ödüyor.

Somut olarak ölçülen yol (``tools/transcription_tools.py::_get_provider``):
``stt.provider`` yazılmamışsa otomatik algılama merdiveni

    local > groq > openai > mistral > xai > elevenlabs > deepinfra

şeklinde iniyor. ``faster_whisper`` yüklenemezse -- CUDA kütüphanesi eksik,
tekerlek bozuk, sürüm çakışması -- MİKROFON KAYDI üçüncü bir tarafa
yükleniyor. Ortada yalnızca bir ``logger.info`` var; kullanıcıya görünen
hiçbir şey yok. Sesli sohbet çalışmaya devam ettiği için fark edilmesi de
mümkün değil.

Bu, sohbet için zaten bir OpenAI anahtarı olan herkesi vuruyor: anahtar
orada, kod onu bulup kullanıyor.

Kural: bulut, kullanıcının AÇIK tercihi olmadan seçilemez. Açık tercihin iki
biçimi var ve ikisi de saygı görüyor:

  1. ``stt.provider: groq`` -- kullanıcı sağlayıcıyı adıyla yazmış.
  2. ``stt.allow_cloud_fallback: true`` -- "yerel çalışmazsa buluta düş" demiş.

İkisi de yoksa yerel yol çalışmıyor demektir ve doğru davranış bunu
SÖYLEMEK, sessizce ses yüklemek değil.
"""

from __future__ import annotations

from typing import Any

_TRUE = frozenset({"1", "on", "true", "yes", "y"})


def _truthy(value: Any) -> bool:
    """``fool config set`` değerleri metin olarak yazıyor; ikisini de kabul et."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in _TRUE
    return False


def cloud_stt_allowed(stt_config: Any) -> bool:
    """Otomatik algılama bulut sağlayıcısına düşebilir mi?

    Okunamayan bir yapılandırma ``False`` döner: kapalı taraf güvenli taraf.
    """
    if not isinstance(stt_config, dict):
        return False
    return _truthy(stt_config.get("allow_cloud_fallback"))


#: Yerel yol çalışmadığında kullanıcıya söylenecek şey. Ne olduğu VE nasıl
#: düzeltileceği birlikte: yalnızca "STT yok" demek kullanıcıyı günlüklerde
#: dolaştırıyordu.
CLOUD_BLOCKED_MESSAGE = (
    "Local speech-to-text is unavailable and cloud fallback is off, so "
    "nothing was transcribed. Your microphone audio was NOT uploaded. "
    "Fix the local engine from Settings > Speech to text, or opt in "
    "explicitly with `fool config set stt.allow_cloud_fallback true` "
    "(or name a provider with `fool config set stt.provider openai`)."
)


# ---------------------------------------------------------------------------
# Seslendirme
# ---------------------------------------------------------------------------

#: Ana ortamda ya da kendi izole ortamlarında koşan, hiçbir yere bağlanmayan
#: seslendirme motorları. Sıra bilinçli: ölçülen ilk-çağrı sonrası gecikmeye
#: göre (Kokoro 0,08 sn, Piper benzeri, Qwen3-TTS 6,0 sn, Chatterbox 28 sn).
LOCAL_TTS_PROVIDERS = ("kokoro", "piper", "qwen3", "chatterbox")


def cloud_tts_allowed(tts_config: Any) -> bool:
    """Seslendirme buluta gidebilir mi?

    ``tts.provider`` AÇIKÇA yazılmışsa bu işlev hiç sorulmuyor -- kullanıcı
    sağlayıcıyı kendisi seçmiş. Buradaki soru yalnızca "hiç seçim yokken ne
    olacak".
    """
    if not isinstance(tts_config, dict):
        return False
    return _truthy(tts_config.get("allow_cloud_fallback"))


def preferred_local_tts(installed: Any) -> str | None:
    """Kurulu yerel motorlar arasından ilk tercihi seç.

    ``installed`` kurulu sağlayıcı adlarını veren herhangi bir küme/dizi.
    Hiçbiri yoksa ``None``.
    """
    try:
        available = {str(name).lower().strip() for name in installed}
    except TypeError:
        return None

    for provider in LOCAL_TTS_PROVIDERS:
        if provider in available:
            return provider
    return None


#: Yerel motor yokken ve bulut açılmamışken söylenecek şey.
TTS_CLOUD_BLOCKED_MESSAGE = (
    "No local text-to-speech engine is installed and cloud TTS is off, so "
    "nothing was spoken. Your text was NOT sent to Microsoft. Install a local "
    "voice from Settings > Text to speech (Kokoro is the fastest), or opt in "
    "explicitly with `fool config set tts.allow_cloud_fallback true` "
    "(or name a provider with `fool config set tts.provider edge`)."
)
