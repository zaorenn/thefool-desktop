"""Kokoro TTS sağlayıcısı (hexgrad, Apache-2.0).

Neden bu var
------------
Kokoro ses modeli kataloğunda zaten listeleniyordu ama **hiçbir sağlayıcısı
yoktu**. Yani indirilebiliyor, panel "Installed" diyordu ve ajan onu asla
kullanamıyordu — kullanıcıya hiçbir hata da görünmüyordu. Sessiz başarı,
görünür hatadan çok daha kötü; bu dosya o boşluğu kapatıyor.

Neden bu model
--------------
Yerel TTS'te Piper hız ucunda ama robotik, Chatterbox gerçekçilik ucunda ama
2 GB ve CUDA istiyor. Kokoro ikisinin arasında: 82M parametre, ~350 MB, CPU'da
kullanılabilir hızda ve tonlaması Piper'dan belirgin biçimde iyi.

Neden AYRI bir ortamda çalışıyor
--------------------------------
``kokoro`` ana ortamda ``tokenizers``ı geriye düşürüyor — o paket
``faster-whisper`` ile paylaşılıyor. Ölçüldü, tahmin değil. Motor bu yüzden
``fool/sidecar.py`` üzerinden kendi sanal ortamına kuruluyor ve buradan alt
süreç olarak çağrılıyor.

Yapılandırma::

    tts:
      provider: kokoro
      kokoro:
        device: auto          # auto | cuda | cpu
        voice: af_heart       # bkz. list_voices()
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

from agent.tts_provider import TTSProvider

logger = logging.getLogger(__name__)

#: Sidecar ortamının adı — ``fool/voice_models.py`` katalog kimliğiyle AYNI.
SIDECAR_NAME = "kokoro"

#: Kokoro'nun ses kimlikleri. Önek dili ve cinsiyeti kodluyor:
#: ``a``=Amerikan, ``b``=İngiliz; ``f``=kadın, ``m``=erkek.
_VOICES: tuple[tuple[str, str], ...] = (
    ("af_heart", "Amerikan kadın — sıcak, varsayılan"),
    ("af_bella", "Amerikan kadın — berrak"),
    ("af_nicole", "Amerikan kadın — yumuşak"),
    ("am_michael", "Amerikan erkek — dengeli"),
    ("am_puck", "Amerikan erkek — canlı"),
    ("bf_emma", "İngiliz kadın"),
    ("bm_george", "İngiliz erkek"),
)

DEFAULT_VOICE = "af_heart"

#: Alt süreçte çalışan sentez betiği.
_SYNTH = r"""
import sys, json
text, out_path, voice, device, speed = sys.argv[1:6]

import torch
import numpy as np
import soundfile as sf
from kokoro import KPipeline

if device == "auto":
    device = "cuda" if torch.cuda.is_available() else "cpu"

# lang_code sesin ilk harfinden geliyor: 'a' Amerikan, 'b' Ingiliz.
pipeline = KPipeline(lang_code=voice[0], device=device)

chunks = []
for _, _, audio in pipeline(text, voice=voice, speed=float(speed or 1.0)):
    chunks.append(audio)

if not chunks:
    raise SystemExit("kokoro ses uretmedi")

wav = np.concatenate(chunks) if len(chunks) > 1 else chunks[0]
sample_rate = 24000
sf.write(out_path, wav, sample_rate)
print(json.dumps({"ok": True, "path": out_path, "device": device, "sample_rate": sample_rate}))
"""


class KokoroTTSProvider(TTSProvider):
    @property
    def name(self) -> str:
        return "kokoro"

    @property
    def display_name(self) -> str:
        return "Kokoro"

    def is_available(self) -> bool:
        """ASLA hata fırlatmaz — picker bunu çağırıyor."""
        try:
            from fool import sidecar

            return sidecar.is_ready(SIDECAR_NAME, "kokoro")
        except Exception:
            return False

    def list_voices(self) -> List[Dict[str, Any]]:
        return [
            {"id": voice_id, "name": voice_id, "description": description}
            for voice_id, description in _VOICES
        ]

    def default_voice(self) -> str:
        return DEFAULT_VOICE

    def synthesize(
        self,
        text: str,
        output_path: str,
        *,
        voice: Optional[str] = None,
        model: Optional[str] = None,
        speed: Optional[float] = None,
        format: str = "wav",
        **extra: Any,
    ) -> str:
        from fool import sidecar
        from fool.tts_device import resolve as resolve_device

        if not sidecar.is_ready(SIDECAR_NAME, "kokoro"):
            raise RuntimeError("Kokoro kurulu degil. Ayarlar > Voice altindan indirin.")

        config = extra.get("config") or {}
        cfg = config.get("kokoro") if isinstance(config, dict) else {}
        cfg = cfg if isinstance(cfg, dict) else {}

        device = resolve_device(cfg, provider="kokoro")

        selected = voice or cfg.get("voice") or DEFAULT_VOICE
        known = {voice_id for voice_id, _ in _VOICES}
        if selected not in known:
            # Bilinmeyen ses adı Kokoro'da anlaşılmaz bir hataya yol açıyor;
            # varsayılana düşüp UYARMAK sessizce çökmekten iyi.
            logger.warning("[Kokoro] bilinmeyen ses %r, %s kullanilacak", selected, DEFAULT_VOICE)
            selected = DEFAULT_VOICE

        target = output_path
        if not target.lower().endswith(".wav"):
            target = os.path.splitext(output_path)[0] + ".wav"

        stdout = sidecar.run_script(
            SIDECAR_NAME,
            _SYNTH,
            [text, target, selected, device, str(speed or 1.0)],
        )

        try:
            result = json.loads(stdout.strip().splitlines()[-1])
        except (ValueError, IndexError) as exc:
            raise RuntimeError(f"Kokoro beklenmeyen cikti verdi: {stdout[:200]}") from exc
        if not result.get("ok"):
            raise RuntimeError(f"Kokoro sentezi basarisiz: {result}")

        logger.debug("[Kokoro] %s uzerinde sentezlendi -> %s", result.get("device"), target)
        return target


def register(ctx: Any) -> None:
    ctx.register_tts_provider(KokoroTTSProvider())
