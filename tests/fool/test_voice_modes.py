"""İki sesli kip: arkadaş ve Jarvis.

Aynı sesli yüzeyden iki farklı şey isteniyor ve gereksinimleri çelişiyor:
arkadaş kipinde çoğu tur bir görev değil (kısa, sıcak, araçsız), Jarvis
kipinde gerçekten iş yapılıyor (terminal, dosya, kod). Tek kipte
birleştirmek ikisini de bozuyordu.

Bu testlerin ağırlığı SINIRDA: hangi kipin neye dokunabildiği ve tanınmayan
bir değerin nereye düştüğü. Bir yazım hatası yüzünden sesli yüzeyin
terminale açılması kabul edilemez.
"""

from __future__ import annotations

import pytest

from fool import voice_modes as vm
from toolsets import resolve_toolset


DANGEROUS = {
    "computer_use",
    "cronjob",
    "delegate_task",
    "execute_code",
    "read_file",
    "terminal_run",
    "write_file",
}


# ---------------------------------------------------------------------------
# Kip kaydı
# ---------------------------------------------------------------------------

def test_iki_kip_tanimli() -> None:
    assert set(vm.modes()) == {vm.COMPANION, vm.JARVIS}


def test_varsayilan_kip_ARKADAS() -> None:
    """Sesli yüzey varsayılan olarak makineye dokunamamalı."""
    assert vm.DEFAULT_MODE == vm.COMPANION
    assert vm.get(vm.DEFAULT_MODE).touches_machine is False


@pytest.mark.parametrize("mode_id", [vm.COMPANION, vm.JARVIS])
def test_her_kipin_etiketi_ozeti_ve_personasi_var(mode_id: str) -> None:
    mode = vm.get(mode_id)

    assert mode.label.strip()
    assert mode.summary.strip()
    assert mode.guidance.strip()


def test_kip_etiketleri_ingilizce() -> None:
    """Depo kuralı: kullanıcıya görünen metin İngilizce."""
    assert vm.get(vm.COMPANION).label == "Friend"
    assert vm.get(vm.JARVIS).label == "Jarvis"


# ---------------------------------------------------------------------------
# Yetki sınırı
# ---------------------------------------------------------------------------

def test_arkadas_kipi_makineye_dokunamiyor() -> None:
    tools: set[str] = set()
    for name in vm.get(vm.COMPANION).toolsets or ():
        tools |= set(resolve_toolset(name))

    assert tools, "arkadas kipi hicbir araca cozulmuyor"
    assert not (DANGEROUS & tools)


def test_jarvis_normal_cozumlemeye_birakiliyor() -> None:
    """``None`` = kısıtlama yok: Jarvis sahibinin tam yüzeyini alır."""
    assert vm.get(vm.JARVIS).toolsets is None


def test_jarvis_sinav_sart_kosuyor_arkadas_kosmuyor() -> None:
    """Sesle "şunu sil" demek ile modelin çağrıyı DOĞRU üretmesi ayrı şeyler.

    Arkadaş kipinde gereksiz -- orada dokunacak bir şey yok.
    """
    assert vm.requires_benchmark(vm.JARVIS) is True
    assert vm.requires_benchmark(vm.COMPANION) is False


# ---------------------------------------------------------------------------
# Tanınmayan değerler
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("bad", ["", "  ", "JARVİS", "agent", None, 42, "companion "])
def test_taninmayan_kip_ARKADASA_dusuyor(bad) -> None:
    """Kapalı taraf güvenli taraf.

    Bir yazım hatasının sesli yüzeyi terminale açması kabul edilemez.
    ``"companion "`` (bosluklu) ve ``"JARVİS"`` (Türkçe İ) gibi yakın-kaçırma
    durumları bilerek sınanıyor.
    """
    mode = vm.get(bad)

    if str(bad).strip().lower() == "companion":
        assert mode.id == vm.COMPANION
    else:
        assert mode.touches_machine is False


def test_buyuk_harf_ve_bosluk_JARVIS_i_buluyor() -> None:
    assert vm.get("  JARVIS ").id == vm.JARVIS


# ---------------------------------------------------------------------------
# Yapılandırma
# ---------------------------------------------------------------------------

def test_aktif_kip_varsayilani_arkadas() -> None:
    assert vm.active_mode({}) == vm.COMPANION


def test_aktif_kip_okunuyor() -> None:
    assert vm.active_mode({"voice": {"mode": "jarvis"}}) == vm.JARVIS


def test_bozuk_aktif_kip_arkadasa_dusuyor() -> None:
    for bad in (None, [], "x", {"voice": 7}, {"voice": {"mode": "yok-boyle"}}):
        assert vm.active_mode(bad) == vm.COMPANION


def test_kip_basina_ses_okunuyor() -> None:
    """Ayrı panel istemenin asıl sebebi: iki kip AYRI sesle konuşabilmeli."""
    config = {"voice": {"modes": {"jarvis": {"provider": "styletts2"}}}}

    assert vm.mode_provider(config, "jarvis") == "styletts2"


def test_kip_basina_ses_yazilmamissa_bos() -> None:
    """Boş = "genel tts.provider'a düş" -- çağıran taraf karar veriyor."""
    assert vm.mode_provider({}, "jarvis") == ""
    assert vm.mode_provider({"voice": {"modes": {}}}, "jarvis") == ""


def test_bozuk_kip_yapilandirmasi_cokmuyor() -> None:
    for bad in (None, [], "x", {"voice": 7}, {"voice": {"modes": "x"}},
                {"voice": {"modes": {"jarvis": "x"}}}):
        assert vm.mode_provider(bad, "jarvis") == ""


# ---------------------------------------------------------------------------
# Jarvis personası -- sesle iş yapmanın kuralları
# ---------------------------------------------------------------------------

def test_jarvis_yikici_islemden_once_ONAY_istiyor() -> None:
    """Sesle yanlış anlaşılma kolay; bedeli gerçek bir eylem olabilir."""
    flat = " ".join(vm.JARVIS_GUIDANCE.split())

    assert "WAIT for a yes" in flat
    assert "destructive" in flat


def test_jarvis_belirsizlikte_TAHMIN_ETMIYOR() -> None:
    flat = " ".join(vm.JARVIS_GUIDANCE.split())

    assert "ask instead of guessing" in flat


def test_jarvis_sessizce_yeniden_denemiyor() -> None:
    """Kullanıcı ekrana bakmıyor; başarısız denemeleri göremez."""
    flat = " ".join(vm.JARVIS_GUIDANCE.split())

    assert "Do not retry variations silently" in flat


def test_jarvis_yaptigini_gecmis_zamanda_soyluyor() -> None:
    """"Yapacağım" değil "yaptım": kullanıcı sonucu duymak istiyor."""
    flat = " ".join(vm.JARVIS_GUIDANCE.split())

    assert "past tense" in flat


def test_iki_persona_da_kisa() -> None:
    """Sistem promptu bedava değil."""
    for mode_id in (vm.COMPANION, vm.JARVIS):
        assert len(vm.get(mode_id).guidance) < 1_800


# ---------------------------------------------------------------------------
# Gerçek seslendirme yolu
# ---------------------------------------------------------------------------

def test_kip_sesi_genel_ayari_EZIYOR(monkeypatch) -> None:
    """İki kip aynı sesle konuşursa ayrı panel istemenin anlamı kalmıyor."""
    from tools import tts_tool

    monkeypatch.setattr(
        tts_tool,
        "_voice_mode_provider",
        lambda: "styletts2",
    )

    assert tts_tool._get_provider({"provider": "kokoro"}) == "styletts2"


def test_kip_sesi_yoksa_genel_ayar_gecerli(monkeypatch) -> None:
    from tools import tts_tool

    monkeypatch.setattr(tts_tool, "_voice_mode_provider", lambda: "")

    assert tts_tool._get_provider({"provider": "kokoro"}) == "kokoro"


def test_kip_sesi_okuma_hatasi_seslendirmeyi_SUSTURMUYOR(monkeypatch) -> None:
    """Bir yapılandırma hatası yüzünden sesin tamamen kesilmesi kabul edilemez."""
    import fool.voice_modes as _vm
    from tools import tts_tool

    def _boom(*a, **k):
        raise RuntimeError("config unreadable")

    monkeypatch.setattr(_vm, "active_mode", _boom)

    assert tts_tool._get_provider({"provider": "kokoro"}) == "kokoro"


def test_kip_sesi_gercek_yapilandirmadan_okunuyor(monkeypatch) -> None:
    import fool_cli.config as cfg
    from tools import tts_tool

    monkeypatch.setattr(
        cfg,
        "load_config",
        lambda *a, **k: {
            "voice": {"mode": "jarvis", "modes": {"jarvis": {"provider": "orpheus"}}}
        },
    )

    assert tts_tool._voice_mode_provider() == "orpheus"
