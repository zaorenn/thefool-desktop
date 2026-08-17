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

import logging
import os
from typing import Any, Dict, List, Optional

from agent.tts_provider import TTSProvider

logger = logging.getLogger(__name__)

#: Model bir kez yüklenir; her çağrıda yeniden yüklemek saniyeler alır.
_model_cache: Dict[str, Any] = {}


class ChatterboxTTSProvider(TTSProvider):
    """Yerel, gerçekçi TTS + sıfır-atış ses klonlama."""

    @property
    def name(self) -> str:
        return "chatterbox"

    @property
    def display_name(self) -> str:
        return "Chatterbox (yerel, gerçekçi)"

    def is_available(self) -> bool:
        """Paket kurulu mu? ASLA hata fırlatmaz — picker bunu çağırıyor."""
        try:
            import importlib.util

            return importlib.util.find_spec("chatterbox") is not None
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

    def _load_model(self, device: str) -> Any:
        cached = _model_cache.get(device)
        if cached is not None:
            return cached

        from chatterbox.tts import ChatterboxTTS

        logger.info("[Chatterbox] Model yukleniyor (device=%s)...", device)
        model = ChatterboxTTS.from_pretrained(device=device)
        logger.info("[Chatterbox] Model hazir")
        _model_cache[device] = model
        return model

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

        tts_model = self._load_model(device)

        # Ses referansı: açık `voice` argümanı > yapılandırma > yok.
        # "default" özel bir değer — modelin kendi sesi demek.
        sample = None
        if voice and voice != "default" and os.path.isfile(voice):
            sample = voice
        elif isinstance(cfg.get("voice_sample"), str):
            candidate = os.path.expanduser(cfg["voice_sample"])
            if os.path.isfile(candidate):
                sample = candidate

        kwargs: Dict[str, Any] = {}
        if sample:
            kwargs["audio_prompt_path"] = sample
        for key, cast in (("exaggeration", float), ("cfg_weight", float)):
            if key in cfg:
                try:
                    kwargs[key] = cast(cfg[key])
                except (TypeError, ValueError):
                    logger.warning("[Chatterbox] gecersiz %s degeri, yok sayildi", key)

        wav = tts_model.generate(text, **kwargs)

        import torchaudio

        torchaudio.save(output_path, wav, tts_model.sr)
        return output_path


def register(ctx) -> None:
    """Eklenti giriş noktası — sağlayıcıyı kayda ekler."""
    ctx.register_tts_provider(ChatterboxTTSProvider())
