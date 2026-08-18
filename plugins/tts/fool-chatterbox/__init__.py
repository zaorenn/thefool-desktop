"""Chatterbox TTS sağlayıcısı (Resemble AI, MIT).

Neden bu model
--------------
Yerel TTS'te iki eksen var: hız ve gerçekçilik. Piper hız tarafının ucunda ama
sesi robotik. Chatterbox gerçekçilik tarafının ucunda ve hâlâ küçük (0.5B —
16 GB VRAM'e fazlasıyla sığar). Üreticinin kör dinleme testinde ElevenLabs'a
%65.3'e %24.5 tercih edilmiş. MIT lisanslı, yani dağıtımda sorun yok.

Ek olarak **sıfır-atış ses klonlama** yapıyor: 5-10 saniyelik bir referans
kaydı yeterli, eğitim gerekmiyor.

Neden eklenti, neden yerleşik değil
-----------------------------------
``agent/tts_provider.py`` ABC'si tam bunun için var — dosyanın kendi ifadesiyle
*"the hook is additive infrastructure waiting for a real consumer"*. Eklenti
olarak eklemek upstream dosyalarına HİÇ dokunmamak demek, yani bu sağlayıcı
``git merge upstream/main`` sırasında asla çakışmaz.

Yapılandırma::

    tts:
      provider: chatterbox
      chatterbox:
        device: auto          # auto | cuda | cpu
        exaggeration: 0.5     # duygu yoğunluğu (0.25-2.0)
        cfg_weight: 0.5       # ifade/hız dengesi
        voice_sample: ~/.fool/voices/ben.wav   # ses klonlama referansı
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

from agent.tts_provider import TTSProvider

logger = logging.getLogger(__name__)

#: Sidecar ortamının adı — ``fool/voice_models.py`` katalog kimliğiyle AYNI
#: olmak zorunda, yoksa panel "kurulu" derken sağlayıcı ortamı bulamaz.
SIDECAR_NAME = "chatterbox"

#: Alt süreçte çalışan sentez betiği.
#:
#: Motor ARTIK ana ortamda değil: ``chatterbox-tts`` ``starlette``ı 1.3.1'in
#: altına düşürüyor ve o pin bir CVE düzeltmesi (CVE-2026-48710). Yani ana
#: ortama kurmak bir güvenlik gerilemesiydi. Kendi ortamına alındı; buradan
#: alt süreç olarak çağrılıyor.
_SYNTH = r"""
import sys, json
text, out_path, device, sample, exaggeration, cfg_weight = sys.argv[1:7]

import torch
from chatterbox.tts import ChatterboxTTS
import torchaudio

if device == "auto":
    device = "cuda" if torch.cuda.is_available() else "cpu"

model = ChatterboxTTS.from_pretrained(device=device)

kwargs = {}
if sample:
    kwargs["audio_prompt_path"] = sample
if exaggeration:
    kwargs["exaggeration"] = float(exaggeration)
if cfg_weight:
    kwargs["cfg_weight"] = float(cfg_weight)

wav = model.generate(text, **kwargs)
torchaudio.save(out_path, wav, model.sr)
print(json.dumps({"ok": True, "path": out_path, "device": device}))
"""


class ChatterboxTTSProvider(TTSProvider):
    """Yerel, gerçekçi TTS + sıfır-atış ses klonlama."""

    @property
    def name(self) -> str:
        return "chatterbox"

    @property
    def display_name(self) -> str:
        return "Chatterbox (yerel, gerçekçi)"

    def is_available(self) -> bool:
        """Sidecar ortamı kurulu ve motor içinde mi?

        ASLA hata fırlatmaz — picker bunu çağırıyor ve bir istisna listeyi
        komple düşürürdü.
        """
        try:
            from fool import sidecar

            return sidecar.is_ready(SIDECAR_NAME, "chatterbox")
        except Exception:
            return False

    def list_voices(self) -> List[Dict[str, Any]]:
        """Chatterbox'ın sabit bir ses kataloğu yok — ses REFERANSTAN geliyor.

        Kullanıcının ``~/.fool/voices/`` altına koyduğu kayıtlar seçilebilir
        ses olarak listelenir; her biri sıfır-atış klonlama için referans.
        """
        voices: List[Dict[str, Any]] = [
            {"id": "default", "display": "Varsayılan (model sesi)", "language": "en"}
        ]

        try:
            from fool_constants import get_hermes_home

            voices_dir = get_hermes_home() / "voices"
            if voices_dir.is_dir():
                for path in sorted(voices_dir.iterdir()):
                    if path.suffix.lower() in {".wav", ".mp3", ".flac", ".ogg"}:
                        voices.append(
                            {
                                "id": str(path),
                                "display": f"{path.stem} (klonlanmış)",
                                "language": "*",
                            }
                        )
        except Exception as exc:  # pragma: no cover — listeleme asla çökmemeli
            logger.debug("[Chatterbox] ses listesi okunamadi: %s", exc)

        return voices

    def get_setup_schema(self) -> Dict[str, Any]:
        return {
            "name": "Chatterbox",
            "badge": "yerel",
            "tag": "Gerçekçi + ses klonlama — CUDA'da hızlı",
            "env_vars": [],
        }

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
        config = extra.get("config") or {}
        cfg = config.get("chatterbox") if isinstance(config, dict) else {}
        cfg = cfg if isinstance(cfg, dict) else {}

        from fool.tts_device import resolve as resolve_device

        device = resolve_device(cfg, provider="chatterbox")

        from fool import sidecar

        if not sidecar.is_ready(SIDECAR_NAME, "chatterbox"):
            raise RuntimeError(
                "Chatterbox kurulu degil. Ayarlar > Voice altindan indirin."
            )

        # Ses referansı: açık `voice` argümanı > yapılandırma > yok.
        # "default" özel bir değer — modelin kendi sesi demek.
        sample = ""
        if voice and voice != "default" and os.path.isfile(voice):
            sample = voice
        elif isinstance(cfg.get("voice_sample"), str):
            candidate = os.path.expanduser(cfg["voice_sample"])
            if os.path.isfile(candidate):
                sample = candidate

        def _num(key: str) -> str:
            if key not in cfg:
                return ""
            try:
                return str(float(cfg[key]))
            except (TypeError, ValueError):
                logger.warning("[Chatterbox] gecersiz %s degeri, yok sayildi", key)
                return ""

        target = output_path
        if not target.lower().endswith(".wav"):
            target = os.path.splitext(output_path)[0] + ".wav"

        stdout = sidecar.run_script(
            SIDECAR_NAME,
            _SYNTH,
            [text, target, device, sample, _num("exaggeration"), _num("cfg_weight")],
        )

        try:
            result = json.loads(stdout.strip().splitlines()[-1])
        except (ValueError, IndexError) as exc:
            raise RuntimeError(f"Chatterbox beklenmeyen cikti verdi: {stdout[:200]}") from exc
        if not result.get("ok"):
            raise RuntimeError(f"Chatterbox sentezi basarisiz: {result}")

        logger.debug("[Chatterbox] %s uzerinde sentezlendi -> %s", result.get("device"), target)
        return target
        return output_path


def register(ctx) -> None:
    """Eklenti giriş noktası — sağlayıcıyı kayda ekler."""
    ctx.register_tts_provider(ChatterboxTTSProvider())
