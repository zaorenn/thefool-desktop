"""Sesli arkadaş, sahibinin terminalini almamalı.

Ölçüldü (``tui_gateway.server._load_enabled_toolsets``, FOOL_DESKTOP=1):
masaüstü oturumu 21 takım alıyor ve içinde ``terminal``, ``computer_use``,
``code_execution``, ``delegation``, ``cronjob`` var. Notch'un sesli turu O
OTURUMU paylaşıyor (``$activeSessionId``), yani "hava nasıl?" diyen arkadaş
makinenin tamamına sahip.
"""

from __future__ import annotations

import pytest

from fool import session_scope as ss
from toolsets import resolve_toolset


DANGEROUS = {
    "computer_use",
    "cronjob",
    "delegate_task",
    "execute_code",
    "patch",
    "read_file",
    "search_files",
    "terminal_run",
    "write_file",
}


# ---------------------------------------------------------------------------
# Kapsam araçları
# ---------------------------------------------------------------------------

def test_arkadas_kapsami_makineye_dokunmuyor() -> None:
    tools: set[str] = set()
    for name in ss.COMPANION_TOOLSETS:
        tools |= set(resolve_toolset(name))

    assert tools, "arkadas kapsami hicbir araca cozulmuyor"
    assert not (DANGEROUS & tools)


def test_arkadas_kapsaminda_tarayici_ve_hafiza_yok() -> None:
    """Tarayıcı oturum açılmış hesaplar, hafıza sahibinin geçmiş sohbetleri."""
    tools: set[str] = set()
    for name in ss.COMPANION_TOOLSETS:
        tools |= set(resolve_toolset(name))

    assert not [t for t in tools if t.startswith("browser")]
    assert "memory" not in ss.COMPANION_TOOLSETS
    assert "session_search" not in ss.COMPANION_TOOLSETS


def test_arkadas_kapsami_SOHBET_EDEBILIYOR() -> None:
    """Kısıtlamak sakatlamak değil: soru sorabilmeli, bakabilmeli, konuşabilmeli."""
    assert "clarify" in ss.COMPANION_TOOLSETS
    assert "web" in ss.COMPANION_TOOLSETS
    assert "tts" in ss.COMPANION_TOOLSETS


def test_arkadas_kapsami_DOSYA_URETEBILIYOR() -> None:
    """"Bunun PDF'ini çıkar" çalışmalı -- ama okuma yetkisi olmadan."""
    assert "output_file" in ss.COMPANION_TOOLSETS
    assert set(resolve_toolset("output_file")) == {"write_output"}


# ---------------------------------------------------------------------------
# Kapsam çözümlemesi
# ---------------------------------------------------------------------------

def test_arkadas_kapsami_kendi_listesini_veriyor() -> None:
    assert ss.scope_toolsets("companion") == list(ss.COMPANION_TOOLSETS)


@pytest.mark.parametrize("scope", ["cli", "desktop", "tui"])
def test_sahibinin_kapsamlari_kisitlanmiyor(scope: str) -> None:
    """``None`` = "normal çözümlemeye devam et"."""
    assert ss.scope_toolsets(scope) is None


def test_bilinmeyen_kapsam_kisitlanmiyor() -> None:
    """Tanımadığımız bir yüzeyi sessizce kırmak yanlış olurdu."""
    assert ss.scope_toolsets("yarin-eklenecek-yuzey") is None
    assert ss.scope_toolsets(None) is None
    assert ss.scope_toolsets(42) is None


def test_buyuk_harf_ve_bosluk_sorun_degil() -> None:
    assert ss.scope_toolsets("  COMPANION ") == list(ss.COMPANION_TOOLSETS)


# ---------------------------------------------------------------------------
# Yüzey tanıma
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("surface", ["hud", "notch", "companion", "HUD", " hud "])
def test_notch_yuzeyleri_taniniyor(surface: str) -> None:
    """Notch bugün ``surface: 'hud'`` gonderiyor ve sunucuda kimse okumuyor."""
    assert ss.is_companion_surface(surface) is True


@pytest.mark.parametrize("surface", ["chat", "cli", "", None, 42, "desktop"])
def test_diger_yuzeyler_arkadas_sayilmiyor(surface) -> None:
    assert ss.is_companion_surface(surface) is False


# ---------------------------------------------------------------------------
# Gerçek çözümleyici
# ---------------------------------------------------------------------------

def test_gateway_arkadas_kapsamini_uyguluyor() -> None:
    """``_load_enabled_toolsets("companion")`` kısıtlı listeyi vermeli."""
    from tui_gateway.server import _load_enabled_toolsets

    result = _load_enabled_toolsets("companion")

    assert result is not None
    assert set(result) == set(ss.COMPANION_TOOLSETS)


def test_gateway_arkadas_kapsaminda_terminal_VERMIYOR() -> None:
    from tui_gateway.server import _load_enabled_toolsets

    result = set(_load_enabled_toolsets("companion") or [])

    for forbidden in ("terminal", "file", "code_execution", "computer_use", "delegation"):
        assert forbidden not in result


def test_gateway_masaustu_kapsamini_DEGISTIRMIYOR(monkeypatch) -> None:
    """Sahibinin çalıştığı oturum aynen kalmalı."""
    monkeypatch.setenv("FOOL_DESKTOP", "1")
    monkeypatch.delenv("FOOL_DESKTOP_TERMINAL", raising=False)

    from tui_gateway.server import _load_enabled_toolsets

    result = set(_load_enabled_toolsets("desktop") or [])

    assert "terminal" in result
    assert "file" in result


# ---------------------------------------------------------------------------
# Friend penceresi: arkadaş kapsamı + ORTAK HAFIZA
# ---------------------------------------------------------------------------
#
# Uzak bir kullanıcıya sahibinin geçmiş sohbetlerini açmak sızıntı; kendi
# makinesinde kendi penceresinde AÇMAMAK ise arkadaşı hafızasız bırakmak --
# her seferinde kendini yeniden anlatmak zorunda kalıyorsun. İkisi farklı
# sorular ve farklı cevapları var.

def test_friend_kapsami_hafizayi_PAYLASIYOR() -> None:
    assert "memory" in ss.FRIEND_TOOLSETS
    assert "memory" not in ss.COMPANION_TOOLSETS


def test_friend_kapsami_yine_de_makineye_dokunmuyor() -> None:
    tools: set[str] = set()
    for name in ss.FRIEND_TOOLSETS:
        tools |= set(resolve_toolset(name))

    assert tools
    assert not (DANGEROUS & tools)
    assert not [t for t in tools if t.startswith("browser")]


def test_friend_gecmis_sohbetleri_TARAYAMIYOR() -> None:
    """Hatırlamak ile geçmişi taramak farklı şeyler; sohbet için gerekmiyor."""
    assert "session_search" not in ss.FRIEND_TOOLSETS


def test_friend_kapsami_cozumleniyor() -> None:
    assert ss.scope_toolsets("friend") == list(ss.FRIEND_TOOLSETS)


def test_gateway_friend_kapsamini_uyguluyor() -> None:
    from tui_gateway.server import _load_enabled_toolsets

    result = set(_load_enabled_toolsets("friend") or [])

    assert result == set(ss.FRIEND_TOOLSETS)
    for forbidden in ("terminal", "file", "code_execution", "computer_use", "delegation"):
        assert forbidden not in result


def test_uc_kapsam_da_BIRBIRINDEN_farkli() -> None:
    """companion < friend, ve desktop ikisinden de YETKILI.

    Ilk yazimda ``friend < desktop`` diye yazmistim ve YANLISTI: friend'de
    ``output_file`` var (yalnizca yazan, kilitli klasor), desktop'ta onun
    yerine TAM ``file`` var -- yani desktop daha yetkili ama kume olarak
    friend'i kapsamiyor. Kume iliskisi burada yanlis olcut; olcut YETKI.
    """
    from tui_gateway.server import _load_enabled_toolsets

    companion = set(_load_enabled_toolsets("companion") or [])
    friend = set(_load_enabled_toolsets("friend") or [])
    desktop = set(_load_enabled_toolsets("desktop") or [])

    # friend, companion'in her seyini yapabiliyor + hafiza.
    assert companion < friend
    assert friend - companion == {"memory"}

    # desktop makineye dokunuyor, digerleri dokunmuyor.
    machine = {"terminal", "file", "code_execution", "computer_use", "delegation"}
    assert machine <= desktop
    assert not (machine & friend)
    assert not (machine & companion)

    # friend'in dosya uretme yetkisi desktop'ta TAM dosya erisimiyle
    # karsilaniyor -- ayni isin daha genis hali.
    assert "output_file" in friend
    assert "file" in desktop
