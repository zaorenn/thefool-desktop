"""Konuşma tanımayı KONUŞULMADAN ÖNCE hazırla.

Ölçüm önce
----------
CODEX görev tanımı "STT tur sonunda çalışıyor, uzun cümlede saniyeler
kaybediliyor" diyor ve akışlı STT öneriyor. Ölçtüm (bu makine, RTX 4070 Ti
SUPER, Whisper large-v3-turbo, float16, 12,18 saniyelik gerçek konuşma):

    ilk çağrı  : 6,94 sn   <- model yükleme dahil
    2. çağrı   : 0,37 sn
    3. çağrı   : 0,36 sn

Yani sıcak durumda 12 saniyelik bir cümle 0,37 saniyede yazıya dökülüyor.
Akışlı STT bunun belki 0,3 saniyesini kazandırırdı. Kaybedilen saniyeler
orada DEĞİL.

Kaybedilen saniyeler **soğuk başlangıçta**: 6,94 sn. Ve o maliyet sürekli
geri geliyor, çünkü paylaşılan 16 GB kartta boşta kalan model boşaltılıyor
(bkz. ``fool/gpu_budget.py`` -- 300 sn). Beş dakika konuşmayan kullanıcı bir
sonraki cümlesinde yeniden 7 saniye bekliyor.

Yaklaşım
--------
Modeli, kullanıcı KONUŞMAYA BAŞLARKEN arka planda yükle. Sesli oturum
açıldığı anda (kısayol ya da uyandırma sözcüğü) yükleme başlıyor; kullanıcı
ilk cümlesini söylerken model çoktan hazır oluyor. Ölçülen 6,94 saniye,
kullanıcının zaten konuşmakla geçirdiği süreye gizleniyor.

Yükleme ASLA istem yolunu bloke etmiyor ve hata ASLA yayılmıyor: ısıtma bir
iyileştirme, bir gereklilik değil. Başarısız olursa eski davranış aynen
geçerli -- ilk transkripsiyon modeli kendisi yükler.
"""

from __future__ import annotations

import logging
import threading
from typing import Any

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_thread: threading.Thread | None = None
_state: dict[str, Any] = {"status": "cold", "error": ""}


def status() -> dict[str, Any]:
    """``cold`` | ``warming`` | ``warm`` | ``failed``."""
    return dict(_state)


def _warm_now() -> None:
    import tools.transcription_tools as tt
    from tools.transcription_tools import (
        _load_local_whisper_model,
        _load_stt_config,
        _normalize_local_model,
    )

    cfg = _load_stt_config()
    local_cfg = cfg.get("local") or {}
    # Model adi transkripsiyon yolundaki ile AYNI kuralla cozuluyor; farkli
    # cozmek yanlis modeli isitip dogru modeli yine sogukta birakirdi.
    model_name = _normalize_local_model(local_cfg.get("model"))

    with tt._local_model_lock:
        if tt._local_model is not None and tt._local_model_name == model_name:
            return
        model = _load_local_whisper_model(
            model_name,
            device=local_cfg.get("device", "auto"),
            compute_type=local_cfg.get("compute_type", "auto"),
        )
        tt._local_model = model
        tt._local_model_name = model_name

    # Isitma da bir kullanim: bosta-bosaltma sayaci sifirlanmali, yoksa
    # isittigimiz model bir sonraki tur baslamadan bosaltilabilirdi.
    tt._touch_transcription_time()


def warm(*, blocking: bool = False) -> dict[str, Any]:
    """Modeli arka planda yükle. Zaten yükleniyorsa/yüklüyse işlemsiz.

    ``blocking=True`` yalnızca testler ve betikler için; istem yolundan
    ASLA böyle çağrılmıyor.
    """
    global _thread

    with _lock:
        if _state["status"] in ("warming", "warm"):
            return status()
        if _thread is not None and _thread.is_alive():
            return status()
        _state["status"] = "warming"
        _state["error"] = ""

    def _run() -> None:
        try:
            _warm_now()
            _state["status"] = "warm"
        except Exception as exc:
            # Isitma bir iyilestirme, bir gereklilik degil: basarisiz olursa
            # eski davranis aynen gecerli -- ilk transkripsiyon modeli
            # kendisi yukler.
            _state["status"] = "failed"
            _state["error"] = str(exc)
            logger.debug("[The Fool] STT warm-up skipped: %s", exc)

    if blocking:
        _run()
        return status()

    thread = threading.Thread(target=_run, name="fool-stt-warm", daemon=True)
    with _lock:
        _thread = thread
    thread.start()
    return status()


def reset_for_tests() -> None:
    """Durumu sıfırla -- yalnızca testler için."""
    global _thread

    with _lock:
        _thread = None
        _state["status"] = "cold"
        _state["error"] = ""
