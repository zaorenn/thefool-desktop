"""Yetki kazanılır, varsayılan olarak verilmez.

Sorun ölçülebilir: 9B'lik yerel bir model ``computer_use``, ``execute_code``,
``terminal_run`` ve ``delegate_task`` gibi araçları güvenilir biçimde
çağıramıyor. Upstream'in kendi kodu bunu zaten biliyor --
``agent/agent_init.py`` bazı modeller için "NOT agentic" uyarısı basıyor --
ama uyarı bir DİZE eşleşmesi ve yalnızca uyarı: araçlar yine de veriliyor.

Sonuç sessiz sınıftan: model aracı yanlış çağırıyor, tur boşa gidiyor,
kullanıcı "aptal" sanıyor. Kötü ihtimalde yanlış argümanla gerçekten bir şey
yapıyor.

Bu modül yetkiyi ÖLÇÜME bağlıyor: tehlikeli takımlar ancak model tool-calling
sınavını geçtiyse veriliyor.
"""

from __future__ import annotations

import pytest

from fool import agent_authority as aa


# ---------------------------------------------------------------------------
# Hangi takımlar yetki istiyor
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("toolset", [
    "code_execution", "computer_use", "cronjob", "delegation", "file", "terminal",
])
def test_makineyi_suren_takimlar_yetki_istiyor(toolset: str) -> None:
    assert toolset in aa.EARNED_TOOLSETS


@pytest.mark.parametrize("toolset", ["clarify", "image_gen", "tts", "vision", "web"])
def test_zararsiz_takimlar_yetki_istemiyor(toolset: str) -> None:
    """Yanlış çağrılan bir ``web_search`` yalnızca boşa giden bir tur."""
    assert toolset not in aa.EARNED_TOOLSETS


# ---------------------------------------------------------------------------
# Yetki kararı
# ---------------------------------------------------------------------------

BASE = {"clarify", "computer_use", "file", "terminal", "web"}


def test_sinav_gecilmemisse_tehlikeli_takimlar_dusuyor() -> None:
    granted = aa.granted_toolsets(BASE, passed=False)

    assert granted == {"clarify", "web"}


def test_sinav_gecilmisse_hicbir_sey_dusmuyor() -> None:
    assert aa.granted_toolsets(BASE, passed=True) == BASE


def test_kapi_kapaliyken_hicbir_sey_dusmuyor() -> None:
    """Varsayılan olarak kapı KAPALI: ölçüm var, kısıtlama opsiyonel.

    Çalışan bir kurulumu ölçüm yüzünden kırmak, çözdüğünden çok sorun
    üretirdi. Kullanıcı açık şekilde açıyor.
    """
    assert aa.granted_toolsets(BASE, passed=False, enforce=False) == BASE


def test_bos_kume_cokmuyor() -> None:
    assert aa.granted_toolsets(set(), passed=False) == set()


def test_sonuc_yeni_kume_giren_degismiyor() -> None:
    base = set(BASE)
    aa.granted_toolsets(base, passed=False)

    assert base == BASE


# ---------------------------------------------------------------------------
# Yapılandırma
# ---------------------------------------------------------------------------

def test_kapi_varsayilan_olarak_kapali() -> None:
    assert aa.enforcement_enabled({}) is False


@pytest.mark.parametrize("raw", [True, "true", "yes", "1", "on"])
def test_kapi_acik_tercihle_aciliyor(raw) -> None:
    assert aa.enforcement_enabled({"agent": {"require_benchmark": raw}}) is True


@pytest.mark.parametrize("raw", [False, "false", "no", "0", "", None])
def test_yanlis_degerler_kapiyi_acmiyor(raw) -> None:
    assert aa.enforcement_enabled({"agent": {"require_benchmark": raw}}) is False


def test_bozuk_yapilandirmada_kapi_kapali() -> None:
    for bad in (None, [], "nonsense", {"agent": 7}):
        assert aa.enforcement_enabled(bad) is False


# ---------------------------------------------------------------------------
# Kullanıcıya söylenen
# ---------------------------------------------------------------------------

def test_uyari_olcumu_ve_cozumu_birlikte_veriyor() -> None:
    message = aa.blocked_message("qwen/qwen3.5-9b", score=2, total=5)

    assert "qwen/qwen3.5-9b" in message
    assert "2/5" in message
    assert "fool" in message  # ne yapacagi yaziyor
