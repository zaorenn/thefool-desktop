"""Seslendirme varsayılanı buluta gitmemeli.

``tools/tts_tool.py`` içinde ``DEFAULT_PROVIDER = "edge"``. Edge TTS
Microsoft'un çevrimiçi "Read Aloud" servisi: ajanın söylediği HER cümlenin
metni websocket üzerinden Microsoft'a gidiyor.

STT sızıntısından farkı ve daha kötü yanı: bu bir HATA yolu değil, VARSAYILAN
yol. ``tts.provider`` yazmamış temiz bir kurulumda -- yani her yeni
kullanıcıda -- yerel motorlar kurulu olsa bile Edge seçiliyor.

Kullanıcının kendi ``config.yaml``ında ``tts.provider: qwen3`` yazıyor, o
yüzden bu makinede sızmıyor; ama uygulamayı denemesi için birine
gönderdiğinde sızıyor.
"""

from __future__ import annotations

import pytest

from fool import local_only


def test_bulut_varsayilan_olarak_kapali() -> None:
    assert local_only.cloud_tts_allowed({}) is False


def test_acik_tercih_bulutu_acar() -> None:
    assert local_only.cloud_tts_allowed({"allow_cloud_fallback": "yes"}) is True


def test_bozuk_yapilandirma_kapali_tarafa_duser() -> None:
    assert local_only.cloud_tts_allowed(None) is False
    assert local_only.cloud_tts_allowed(["edge"]) is False


def test_kurulu_yerel_motorlardan_en_hizlisi_seciliyor() -> None:
    """Sıra ölçülmüş gecikmeye göre: Kokoro 0,08 sn, Chatterbox 28 sn."""
    assert local_only.preferred_local_tts({"chatterbox", "kokoro"}) == "kokoro"
    assert local_only.preferred_local_tts({"chatterbox", "qwen3"}) == "qwen3"
    assert local_only.preferred_local_tts(["piper"]) == "piper"


def test_hicbiri_kurulu_degilse_none() -> None:
    assert local_only.preferred_local_tts(set()) is None
    assert local_only.preferred_local_tts({"edge", "openai"}) is None


def test_bozuk_girdide_cokmuyor() -> None:
    assert local_only.preferred_local_tts(None) is None


# ---------------------------------------------------------------------------
# Gerçek çözümleyici
# ---------------------------------------------------------------------------

@pytest.fixture
def tts(monkeypatch):
    from tools import tts_tool

    return tts_tool


def test_acik_secim_hic_dokunulmuyor(tts, monkeypatch) -> None:
    """``tts.provider: edge`` yazan kullanıcı bilerek Edge istiyor."""
    monkeypatch.setattr(tts, "_installed_local_tts", lambda: {"kokoro"})

    assert tts._get_provider({"provider": "edge"}) == "edge"
    assert tts._get_provider({"provider": "openai"}) == "openai"


def test_secim_yokken_kurulu_yerel_motor_seciliyor(tts, monkeypatch) -> None:
    monkeypatch.setattr(tts, "_installed_local_tts", lambda: {"kokoro", "chatterbox"})

    assert tts._get_provider({}) == "kokoro"


def test_yerel_motor_yoksa_sessizce_edge_secilmiyor(tts, monkeypatch) -> None:
    monkeypatch.setattr(tts, "_installed_local_tts", lambda: set())

    assert tts._get_provider({}) == "none"


def test_acik_tercihle_edge_yine_calisiyor(tts, monkeypatch) -> None:
    monkeypatch.setattr(tts, "_installed_local_tts", lambda: set())

    assert tts._get_provider({"allow_cloud_fallback": True}) == "edge"
