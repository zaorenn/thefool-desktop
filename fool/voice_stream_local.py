"""Yerel TTS motorlarını canlı seslendirmeye kat — chunked API'leri yok.

Ölçülen sorun
-------------
``tools/tts_streaming.py`` yalnızca dört bulut sağlayıcı için ``stream()``
tanımlıyor (elevenlabs, gemini, openai, xai). Yerel bir motor seçiliyse
``resolve_streaming_provider`` ``None`` dönüyor ve WS ucu hemen
``{"type": "fallback"}`` gönderiyordu. İstemci de bunu görünce AJANIN TÜM
CEVABI bitmesini bekliyor, sonra tüm metni TEK ÇAĞRIDA sentezliyordu.

Sonuç ölçüldü: LLM cevabı + tam metin sentezi ardışık — kullanıcı "Jarvis
gibi hissettirmiyor, cevap 10 saniye geç geliyor" dedi ve haklıydı. STT
zaten anında modele gidiyordu (``submitAudio`` transkripsiyondan hemen
sonra ``prompt.submit`` çağırıyor); gecikme TAMAMEN ses tarafındaydı.

Çözüm
-----
Yerel motorların chunked bir API'si yok ama HIZLI: kokoro sıcakken 0,20 sn,
styletts2 0,56 sn (ölçüldü). Cümle uzunluğunda bir metni senkron sentezlemek
zaten "gerçek zamanlıya yakın" -- eksik olan sadece bunu CÜMLE CÜMLE
yapıp yayınlamak, tüm cevabı bekleyip TEK metni sentezlemek değil.

``LocalSentenceStreamer`` bu yüzden ``StreamingTTSProvider`` ile AYNI
arayüzü (``sample_rate``, ``channels``, ``stream(text) -> Iterator[bytes]``)
sunuyor ama arkasında ``/api/audio/speak``'in kullandığı senkron
``text_to_speech_tool`` var. Çağıran taraf (``fool_cli/web_server.py``)
ikisini aynı döngüde kullanabiliyor.

Örnek hızı SONRADAN öğreniliyor
--------------------------------
Bulut akıtıcılar ``sample_rate``i sınıf sabiti olarak biliyor (API'nin
kendi sözleşmesi). Yerel motorlarda böyle bir sözleşme yok ve sabit bir
sayı YAZMAK riskli: yanlış olursa oynatma hızı/perdesi bozuk çıkar ama
ÇÖKMEZ -- sessiz bir kalite hatası. Bunun yerine ilk gerçek sentezin WAV
başlığından okunuyor; ``sample_rate``/``channels`` o ana kadar 0.

Neden ``wave`` yetiyor (ffmpeg gerekmiyor)
-------------------------------------------
Her yerel motor eklentisi çıktıyı 16-bit PCM WAV'a yazıyor (bkz.
``fool/sidecar.py`` altındaki eklentiler — float32 çıktı orada PCM_16'ya
çevriliyor). Yani stdlib'in ``wave`` modülü format sorununu tam çözüyor;
sesli sohbet yolunda ffmpeg'e bağımlılık eklemiyor.

Zone A: upstream bu dosyayı bilmiyor.
"""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
import wave
from typing import Any, Iterator, Optional


def _wav_capable_providers() -> frozenset[str]:
    """WAV üreten YEREL motorlar -- katalogdan türetiliyor, elle yazılmıyor.

    Katalog tek kaynak: yeni bir yerel motor eklendiğinde burası kendiliğinden
    öğreniyor. Katalog okunamazsa boş küme dönüyor ve çağıran senkron yolu hiç
    denemiyor -- yani en kötü hâl eski (yavaş ama çalışan) tam-metin yolu.
    """
    try:
        from fool import voice_models

        names: set[str] = set()
        for entry in voice_models.CATALOG:
            if entry.kind != "tts":
                continue
            names.add((entry.provider_id or entry.id).strip().lower())
            names.add(entry.id.strip().lower())
        return frozenset(names)
    except Exception:  # noqa: BLE001
        return frozenset()


def usable_local_provider(provider: str) -> bool:
    """Bu ad senkron cümle-cümle sentez için denenmeye değer mi?

    Sınıfın adı "yerel" diyor ama kural bunu HİÇ uygulamıyordu: boş olmayan
    ve ``"none"`` olmayan HER ad kabul ediliyordu.

    Ölçülen sonuç: ``tts.provider: edge`` (desteklenen bir sağlayıcı) seçili
    olduğunda bu uç senkron yola giriyor, ``_generate_edge_tts`` uzantıya hiç
    bakmadan ``.wav`` yoluna MP3 baytları yazıyor ve ``wave.open`` "file does
    not start with RIFF id" ile düşüyor. Yani her cümle bir Microsoft gidiş
    dönüşü israf ediyor, hiç ses çıkmıyor ve istemci yedek yola ancak bu
    gecikmeden SONRA düşüyor. Aynı şekil ``minimax`` ve MP3 dönen her
    sağlayıcı için geçerli.

    ``_get_provider`` hiçbir motor kurulu/yapılandırılı değilken ``"none"``
    döner (bkz. ``tools/tts_tool.py`` FOOL-SEAM: local-only-tts).
    """
    name = (provider or "").strip().lower()

    if not name or name == "none":
        return False

    return name in _wav_capable_providers()


def _parse_tool_result(raw: Any) -> Optional[dict]:
    """``text_to_speech_tool``ün JSON dizesini (ya da zaten dict'i) çöz."""
    if isinstance(raw, dict):
        return raw

    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return None

    return payload if isinstance(payload, dict) else None


class LocalSentenceStreamer:
    """Chunked API'si olmayan bir motoru cümle başına senkron seslendirir.

    ``StreamingTTSProvider`` ile aynı yüzeyi sunuyor (``sample_rate``,
    ``channels``, ``stream(text)``) ki çağıran taraf true streamer ile bunu
    aynı döngüde kullanabilsin.
    """

    def __init__(self, provider: str) -> None:
        self.provider = provider
        #: İlk başarılı sentezden ÖĞRENİLİYOR — sabit yazmak yanlış
        #: olduğunda sessizce hız/perde bozar (bkz. modül docstring'i).
        self.sample_rate = 0
        self.channels = 0

    def stream(self, text: str) -> Iterator[bytes]:
        from tools.tts_tool import text_to_speech_tool

        handle_fd, tmp_path = tempfile.mkstemp(prefix="fool-speak-stream-", suffix=".wav")
        os.close(handle_fd)
        produced = tmp_path
        frames = b""

        try:
            raw = text_to_speech_tool(text, output_path=tmp_path, provider=self.provider or None)
            payload = _parse_tool_result(raw)

            if payload is not None:
                if not payload.get("success", True):
                    raise RuntimeError(str(payload.get("error") or "synthesis failed"))
                candidate = payload.get("file_path")
                if isinstance(candidate, str) and candidate:
                    produced = candidate

            with wave.open(produced, "rb") as wav_file:
                if wav_file.getsampwidth() != 2:
                    # Protokol yalnizca ham int16 PCM tasiyor. Baska bir
                    # ornek genisligi sessizce gonderilirse GURULTU calar --
                    # burada acikca reddetmek, cagiran tarafin (ki her
                    # istisnayi zaten "senkron sentez basarisiz" olarak
                    # gunluge yazip oturumu normal sekilde bitiriyor)
                    # dogru yola dusmesini sagliyor.
                    raise RuntimeError(
                        f"{self.provider}: beklenmeyen örnek genişliği "
                        f"{wav_file.getsampwidth()} (int16 PCM bekleniyordu)"
                    )

                self.sample_rate = wav_file.getframerate()
                self.channels = wav_file.getnchannels() or 1
                frames = wav_file.readframes(wav_file.getnframes())
        finally:
            for path in {tmp_path, produced}:
                with contextlib.suppress(OSError):
                    os.unlink(path)

        if frames:
            yield frames
