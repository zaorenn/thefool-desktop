"""Motorlar VRAM'i paylaşıyor ve kimse bırakmıyordu.

Ölçüldü (RTX 4070 Ti SUPER, uygulama açık, birkaç motor denenmiş):

    nvidia-smi -> 15338 / 16376 MiB dolu, 724 MiB boş, 10 süreç

Her TTS motoru kalıcı bir süreçte yaşıyor ve modelini VRAM'e yükleyip HİÇ
bırakmıyordu. Beş TTS motoru + whisper + LM Studio'daki 9B model aynı kartta
birikince her şey bozuluyor: sentez saniyelerce takılıyor, panelde
"Speaking…" donuyor, çoğu zaman hiç ses çıkmıyor.

Kullanıcıya "TTS çalışmıyor" diye görünen şey buydu -- tek tek her motor
çalışıyor, hepsi birlikte hiçbiri çalışmıyor.

Tahliyeden sonra ölçülen (aynı sıra, aynı motorlar):

    boş VRAM hiç 6688 MiB'in altına düşmedi
    piper 0,17 · kokoro 0,19 · styletts2 0,60 · chatterbox 2,10 sn (ısınmış)
"""

from __future__ import annotations

import threading
import time

import pytest

from fool import engine_host as eh


class _FakeProcess:
    def __init__(self) -> None:
        self.killed = False

    def poll(self):
        return None

    def kill(self) -> None:
        self.killed = True

    def wait(self, timeout=None) -> int:
        return 0

    def terminate(self) -> None:
        self.killed = True

    @property
    def stdin(self):
        return None

    @property
    def stdout(self):
        return None


def _engine(last_used: float = 0.0) -> eh._Engine:
    return eh._Engine(
        lock=threading.Lock(),
        process=_FakeProcess(),
        setup_hash="x",
        last_used=last_used,
    )


@pytest.fixture(autouse=True)
def _clean():
    eh._ENGINES.clear()
    yield
    eh._ENGINES.clear()


# ---------------------------------------------------------------------------
# Tek motor
# ---------------------------------------------------------------------------

def test_ayni_anda_TEK_motor_kaliyor() -> None:
    """Seslendirme sıralı: ikinci bir motoru ayakta tutmanın tek etkisi VRAM."""
    assert eh.MAX_RESIDENT_ENGINES == 1


def test_yeni_motor_istenince_eskisi_bosaltiliyor(monkeypatch) -> None:
    monkeypatch.setattr(eh, "free_vram_mb", lambda: 20_000, raising=False)
    eh._ENGINES["eski"] = _engine(last_used=1.0)

    eh._evict_for("yeni")

    assert "eski" not in eh._ENGINES


def test_EN_ESKI_kullanilan_once_gidiyor(monkeypatch) -> None:
    eh._ENGINES["eski"] = _engine(last_used=1.0)
    eh._ENGINES["yeni"] = _engine(last_used=99.0)

    eh._evict_for("ucuncu")

    assert "eski" not in eh._ENGINES


# ---------------------------------------------------------------------------
# KULLANIMDA olan motor korunuyor
# ---------------------------------------------------------------------------

def test_kullanimda_olan_motor_TAHLIYE_EDILMIYOR() -> None:
    """Kilidi tutulan bir motoru durdurmak süren bir sentezi ortasından kesmek.

    Kullanıcı cümlenin yarısını duyar ve sebebini göremez.
    """
    busy = _engine(last_used=1.0)
    busy.lock.acquire()
    eh._ENGINES["mesgul"] = busy

    try:
        eh._evict_for("yeni")

        assert "mesgul" in eh._ENGINES
    finally:
        busy.lock.release()


def test_kullanimda_olan_bosta_taramada_da_korunuyor() -> None:
    busy = _engine(last_used=time.monotonic() - eh.IDLE_UNLOAD_SECONDS - 100)
    busy.lock.acquire()
    eh._ENGINES["mesgul"] = busy

    try:
        assert eh._idle_sweep() == []
        assert "mesgul" in eh._ENGINES
    finally:
        busy.lock.release()


# ---------------------------------------------------------------------------
# Boşta zaman aşımı
# ---------------------------------------------------------------------------

def test_bosta_kalan_motor_bosaltiliyor() -> None:
    eh._ENGINES["bosta"] = _engine(last_used=time.monotonic() - eh.IDLE_UNLOAD_SECONDS - 1)

    assert eh._idle_sweep() == ["bosta"]
    assert "bosta" not in eh._ENGINES


def test_YENI_kullanilan_motor_bosaltilmiyor() -> None:
    eh._ENGINES["taze"] = _engine(last_used=time.monotonic())

    assert eh._idle_sweep() == []
    assert "taze" in eh._ENGINES


def test_bosta_suresi_bir_sohbet_turundan_uzun() -> None:
    """Tur arasında boşaltmak, her cümlede yeniden yükleme demek.

    Ölçüldü: StyleTTS 2 ilk yükleme 17,56 sn. Kısa bir zaman aşımı
    çözdüğünden çok sorun üretirdi.
    """
    assert eh.IDLE_UNLOAD_SECONDS >= 120


def test_izleyici_TEK_ve_daemon() -> None:
    """İki izleyici iki kat tarama ve yarış demek."""
    eh._ensure_idle_watcher()
    first = eh._IDLE_THREAD
    eh._ensure_idle_watcher()

    assert eh._IDLE_THREAD is first
    assert first is not None and first.daemon


# ---------------------------------------------------------------------------
# Ölçüm çökerse
# ---------------------------------------------------------------------------

def test_VRAM_olculemezse_tahliye_yapilmiyor(monkeypatch) -> None:
    """Ölçemediğimiz bir durumda çalışan motorları durdurmak zarar verir.

    Sayı sınırı yine geçerli; kesilen yalnızca BELLEK kaynaklı tahliye.
    """
    import fool.gpu_budget as gb

    def _boom():
        raise OSError("nvidia-smi yok")

    monkeypatch.setattr(gb, "free_vram_mb", _boom)
    eh._ENGINES["tek"] = _engine(last_used=1.0)

    eh._evict_for("tek")  # kendisi -- sayi siniri tetiklenmiyor

    assert "tek" in eh._ENGINES


def test_bos_kayitta_cokmuyor() -> None:
    assert eh._evict_for("herhangi") == []
    assert eh._idle_sweep() == []
