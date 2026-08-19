"""Ses panelinde model başına dinleme düğmesi.

Neden gerekiyor
---------------
Dört TTS motoru "kurulu" yazıyor ve kullanıcı hangisinin nasıl konuştuğunu
duymadan seçim yapmak zorunda. Ses seçmek kulakla yapılan bir iş; katalogdan
okunmuyor.

Asıl kazanç ise ölçüm. Bu depodaki en pahalı hata sınıfı -- "cihaz cuda
yazıyordu, motor CPU'da koşuyordu" -- tam burada görünür hâle geliyor.
Ölçülen fark küçük değil:

    Kokoro      ilk çağrı 7,6 sn   sonraki 0,08 sn   (CUDA)
    Qwen3-TTS   ilk çağrı 18,4 sn  sonraki 6,0 sn
    Chatterbox  ilk çağrı 58 sn    sonraki 28 sn

Bir düğmeye basıp "3,4 saniye" görmek, panelin "CUDA" yazmasından daha
inandırıcı bir kanıt.
"""

from __future__ import annotations

import base64
import os
import tempfile
import time
from typing import Any

#: Deneme cümlesi bilerek KISA ve SABİT.
#:
#: Uzun bir metin, ölçümü sentez hızı yerine metin uzunluğuyla karıştırırdı
#: ve motorlar arası karşılaştırmayı anlamsız kılardı.
PREVIEW_TEXT = "Hello — this is how I sound. One, two, three."


def _status(entry_id: str) -> dict[str, Any]:
    from fool.voice_models import status

    return status(entry_id)


def _synthesize(provider: str, path: str) -> str:
    from tools.tts_tool import text_to_speech_tool

    return text_to_speech_tool(PREVIEW_TEXT, output_path=path, provider=provider)


def preview(entry_id: str) -> dict[str, Any]:
    """*entry_id* motoruyla kısa bir cümle seslendir; sesi ve süreyi döndür.

    Hata YUTULMUYOR: sessizce başarısız olan bir dinleme düğmesi, düğmenin
    kendisinin bozuk olması demek. Çağıran taraf sebebi kullanıcıya
    gösterebilsin diye istisna yukarı çıkıyor.
    """
    from fool.voice_models import entry

    e = entry(entry_id)
    if e is None:
        raise ValueError(f"bilinmeyen motor: {entry_id}")
    if e.kind != "tts":
        raise ValueError(f"{e.label} bir seslendirme motoru degil")

    if not _status(entry_id).get("installed"):
        raise ValueError(f"{e.label} kurulu degil")

    provider = e.provider_id or e.id

    handle, path = tempfile.mkstemp(prefix="fool-preview-", suffix=".wav")
    os.close(handle)

    try:
        started = time.monotonic()
        produced = _synthesize(provider, path)
        elapsed_ms = int((time.monotonic() - started) * 1000)

        with open(produced, "rb") as fh:
            audio = fh.read()
    finally:
        # Her onizleme diske bir dosya birakmamali. Sentez BASKA bir yola
        # yazmis olabilir; ikisi de temizleniyor.
        for leftover in {path, locals().get("produced")}:
            if leftover:
                try:
                    os.unlink(leftover)
                except OSError:
                    pass

    return {
        "ok": True,
        "provider": provider,
        "entry_id": entry_id,
        "elapsed_ms": elapsed_ms,
        "bytes": len(audio),
        "mime": "audio/wav",
        "audio_base64": base64.b64encode(audio).decode("ascii"),
    }
