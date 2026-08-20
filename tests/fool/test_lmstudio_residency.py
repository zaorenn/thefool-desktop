"""Aynı anda TEK dil modeli yüklü kalsın.

Ölçüldü (kullanıcının kartı, RTX 4070 Ti SUPER, 16 GB):

    google/gemma-4-e4b   6,33 GB   TTL yok   <- seçili olan
    qwen/qwen3.5-9b      6,55 GB   TTL 1 sa  <- gün boyu hiç istenmedi
    ------------------------------------------
    toplam              12,88 GB, geriye ~3 GB

Seslendirme motorları AYNI kartta. Günlüklerde sonucu görünüyordu:
``[TTS/piper] device=cuda istendi ama CUDA bulunamadi; CPU'ya dusuluyor``.
qwen boşaltıldıktan sonra ölçüldü: VRAM 12,88 GB -> 3,73 GB.
"""

from __future__ import annotations

import pytest

from fool import lmstudio_residency as residency

#: Fikstür ``unload``u taklit ediyor; bu yolun KENDİSİNİ sınayan testler
#: gerçeğini geri koyuyor, yoksa taklidin taklidi sınanırdı.
_REAL_UNLOAD = residency.unload


@pytest.fixture(autouse=True)
def _no_real_cli(monkeypatch):
    """Sınavlar GERÇEK modelleri boşaltmasın."""
    monkeypatch.setattr(residency, "unload", lambda model_id: True)


def _loaded(monkeypatch, ids):
    monkeypatch.setattr(residency, "loaded_models", lambda base_url: list(ids))


# ---------------------------------------------------------------------------
# Uç nokta çözümlemesi
# ---------------------------------------------------------------------------

def test_api_koku_v1_ekini_atiyor() -> None:
    """Yüklü model listesi ``/v1`` altında DEĞİL, kökte."""
    assert residency._api_root("http://localhost:1234/v1") == "http://localhost:1234"
    assert residency._api_root("http://localhost:1234/v1/") == "http://localhost:1234"
    assert residency._api_root("http://127.0.0.1:9999") == "http://127.0.0.1:9999"


def test_bos_adres_varsayilana_dusuyor() -> None:
    assert residency._api_root("") == "http://localhost:1234"


# ---------------------------------------------------------------------------
# Tek-model kuralı
# ---------------------------------------------------------------------------

def test_secili_OLMAYANLAR_birakiliyor(monkeypatch) -> None:
    _loaded(monkeypatch, ["google/gemma-4-e4b", "qwen/qwen3.5-9b"])

    dropped = residency.enforce_single("http://localhost:1234/v1", "google/gemma-4-e4b")

    assert dropped == ["qwen/qwen3.5-9b"]


def test_secili_model_ASLA_birakilmiyor(monkeypatch) -> None:
    """Kullanıcının o an konuştuğu modeli kapatmak en kötü sonuç."""
    _loaded(monkeypatch, ["google/gemma-4-e4b"])

    assert residency.enforce_single("http://localhost:1234/v1", "google/gemma-4-e4b") == []


def test_KEEP_bos_ise_hicbir_sey_yapilmiyor(monkeypatch) -> None:
    """Hangisinin korunacağını bilmeden boşaltmak körlemesine kapatmaktır."""
    _loaded(monkeypatch, ["google/gemma-4-e4b", "qwen/qwen3.5-9b"])

    assert residency.enforce_single("http://localhost:1234/v1", "") == []
    assert residency.enforce_single("http://localhost:1234/v1", "   ") == []


def test_birakilamayan_model_LISTEDE_gorunmuyor(monkeypatch) -> None:
    """Rapor gerçeği söylemeli: boşaltılamadıysa boşaltılmış sayılmaz."""
    _loaded(monkeypatch, ["a", "b"])
    monkeypatch.setattr(residency, "unload", lambda model_id: model_id == "a")

    assert residency.enforce_single("http://localhost:1234/v1", "keep") == ["a"]


def test_hicbiri_yuklu_degilse_sessizce_geciyor(monkeypatch) -> None:
    _loaded(monkeypatch, [])

    assert residency.enforce_single("http://localhost:1234/v1", "google/gemma-4-e4b") == []


# ---------------------------------------------------------------------------
# Dayanıklılık
# ---------------------------------------------------------------------------

def test_LM_Studio_kapaliysa_COKMUYOR() -> None:
    """Başka bir sağlayıcı kullanılıyor olabilir; burada yapılacak iş yok."""
    assert residency.loaded_models("http://127.0.0.1:59999") == []


def test_lms_komutu_yoksa_bosaltma_DENENMIYOR(monkeypatch) -> None:
    """Bir iyileştirme uğruna sesli oturumu düşürmek yanlış olurdu.

    ``unload`` burada BİLEREK gerçek işlev: fikstürün taklidi geri alınıyor,
    yoksa sınav kendi taklidini sınardı.
    """
    monkeypatch.setattr(residency, "unload", residency.unload.__wrapped__
                        if hasattr(residency.unload, "__wrapped__") else _REAL_UNLOAD)
    monkeypatch.setattr(residency, "_cli", lambda: "")

    assert residency.unload("google/gemma-4-e4b") is False


def test_bos_model_kimligi_bosaltilmiyor(monkeypatch) -> None:
    monkeypatch.setattr(residency, "unload", _REAL_UNLOAD)
    monkeypatch.setattr(residency, "_cli", lambda: "C:/lms.exe")

    assert residency.unload("") is False


# ---------------------------------------------------------------------------
# Isıtma ucuna bağlı mı?
# ---------------------------------------------------------------------------

def test_isitma_ucu_temizligi_ARKA_PLANDA_yapiyor() -> None:
    """Isıtma HEMEN dönmeli.

    Bir bellek temizliği uğruna sesli oturumun açılışını bekletmek, tam
    olarak düzeltilmek istenen yavaşlığı geri getirirdi.
    """
    from pathlib import Path

    source = (Path(__file__).resolve().parents[2] / "fool" / "voice_routes.py").read_text(
        encoding="utf-8"
    )

    assert "_free_unused_llms()" in source
    # Is parcaciginda kosuyor -- ucun kendisi beklemiyor.
    assert "threading.Thread" in source
    assert "enforce_single" in source


# ---------------------------------------------------------------------------
# Katalog budaması
# ---------------------------------------------------------------------------

def test_YAVAS_motorlar_panelde_GORUNMUYOR() -> None:
    """Ölçülen hızları gerçek zamanın çok altında.

        kyutai      2,5-11 sn/cümle
        qwen3-tts   9,42 sn/cümle
        f5-tts      bu makinede hiç çalışmıyor (torchcodec/FFmpeg)

    Karşılaştırma: kokoro 0,13-0,20 sn, piper 0,12 sn, styletts2 0,56 sn.
    """
    from fool import voice_models as vm

    visible = {e.id for e in vm.visible_catalog() if e.kind == "tts"}

    for slow in ("kyutai", "qwen3-tts", "f5-tts"):
        assert slow not in visible or vm.active_providers().get("tts") == (
            vm.entry(slow).provider_id or slow
        ), f"{slow} panelde gorunuyor"


def test_HIZLI_motorlar_panelde_DURUYOR() -> None:
    from fool import voice_models as vm

    visible = {e.id for e in vm.visible_catalog() if e.kind == "tts"}

    assert {"piper", "kokoro", "styletts2", "chatterbox"} <= visible


def test_kayitlar_SILINMEDI_yalnizca_gizlendi() -> None:
    """Kurulu bir motoru katalogdan silmek, kullanıcının diskindeki
    gigabaytları görünmez yapardı. Gizlemek geri alınabilir."""
    from fool import voice_models as vm

    for slow in ("kyutai", "qwen3-tts", "f5-tts"):
        entry = vm.entry(slow)

        assert entry is not None, f"{slow} katalogdan SILINMIS"
        assert entry.hidden is True


def test_SECILI_gizli_motor_yine_gosteriliyor(monkeypatch) -> None:
    """Aksi hâlde kullanıcı ayarlarda hiçbir şey seçili görmez ve sesin
    nereden geldiğini anlayamaz."""
    from fool import voice_models as vm

    monkeypatch.setattr(vm, "active_providers", lambda: {"stt": "", "tts": "kyutai"})

    assert "kyutai" in {e.id for e in vm.visible_catalog()}
