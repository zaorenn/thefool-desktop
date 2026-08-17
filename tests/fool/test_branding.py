"""The Fool markalaşmasının koruma testleri.

Bu testlerin varlık sebebi tek bir senaryo: ``git merge upstream/main``
sırasında bir çakışma **sessizce** upstream lehine çözülür ve markalaşma geri
alınır. Çakışmanın kendisi tehlikeli değil — görürsün, çözersin. Tehlikeli
olan, hiçbir şey söylemeden kaybolmasıdır.

Çalıştırma::

    python -m pytest tests/fool/ -q
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import pytest

from fool import branding

REPO_ROOT = Path(__file__).resolve().parents[2]


# =============================================================================
# Metin dönüşümü
# =============================================================================


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("Hermes Desktop is ready", "The Fool Desktop is ready"),
        ("Starting Hermes Desktop…", "Starting The Fool Desktop…"),
        ("HERMES AGENT", "THE FOOL"),
        ("Update Hermes", "Update The Fool"),
        ("Nous Research", "Fool Labs"),
        ("Hermes couldn't start", "The Fool couldn't start"),
        ("edit ~/.hermes/.env", "edit ~/.thefool/.env"),
        ("run: hermes update", "run: thefool update"),
    ],
)
def test_user_visible_text_is_rebranded(source: str, expected: str) -> None:
    assert branding.brand_text(source) == expected


@pytest.mark.parametrize(
    "source",
    [
        # Backend sözleşmesi: bunlar ASLA değişmemeli.
        "Set HERMES_HOME to override",
        "from hermes_cli.main import main",
        "HERMES_API_TIMEOUT=1800",
        "import hermes_constants",
        "run_agent.py --help",
        "acp_adapter.entry:main",
    ],
)
def test_internal_contract_is_untouched(source: str) -> None:
    """``\\b`` sınırları ``_`` üzerinden eşleşmediği için sözleşme korunur."""
    assert branding.brand_text(source) == source


def test_no_hermes_survives_in_mixed_ui_text() -> None:
    text = "Hermes Desktop could not reach the Hermes backend. Restart Hermes."
    out = branding.brand_text(text)
    assert "Hermes" not in out
    # Artikelli konumda "The" düşer ("the Fool backend"), tek başına korunur.
    assert out == "The Fool Desktop could not reach the Fool backend. Restart The Fool."


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        # Artikel varsa ad sıradan özel isim gibi davranır.
        ("Restore a Hermes backup", "Restore a Fool backup"),
        ("Open the safe Hermes command console", "Open the safe Fool command console"),
        ("View your Hermes plan", "View your Fool plan"),
        # Artikel ürüne ait değilse tam ad korunmalı.
        (
            "Set a standing goal Hermes works on across turns",
            "Set a standing goal The Fool works on across turns",
        ),
        # Tek başına: tam ad.
        ("Hermes could not start", "The Fool could not start"),
    ],
)
def test_article_grammar_is_repaired(source: str, expected: str) -> None:
    """Ad "The" içerdiği için ham değiştirme bozuk İngilizce üretiyordu."""
    assert branding.brand_text(source) == expected


def test_brand_value_walks_nested_structures() -> None:
    payload = {
        "title": "Hermes",
        "items": ["Start Hermes", {"deep": "Nous Research"}],
        "count": 3,
        "flag": True,
        "nothing": None,
    }
    out = branding.brand_value(payload)
    assert out["title"] == "The Fool"
    assert out["items"][0] == "Start The Fool"
    assert out["items"][1]["deep"] == "Fool Labs"
    # String olmayanlar olduğu gibi geçmeli.
    assert out["count"] == 3
    assert out["flag"] is True
    assert out["nothing"] is None


# =============================================================================
# Python <-> TypeScript sabit senkronu
# =============================================================================


def _read_ts_brand() -> dict[str, str]:
    """``branding.ts`` içindeki ``BRAND`` nesnesini kabaca ayrıştır."""
    ts = (REPO_ROOT / "apps/desktop/src/fool/branding.ts").read_text(encoding="utf-8")
    block = re.search(r"export const BRAND = \{(.*?)\} as const", ts, re.DOTALL)
    assert block, "branding.ts içinde BRAND bloğu bulunamadı"
    return dict(re.findall(r"(\w+):\s*'([^']*)'", block.group(1)))


def test_python_and_typescript_brand_constants_agree() -> None:
    """İki taraf ayrışırsa arayüz ve backend farklı isimler gösterir."""
    ts = _read_ts_brand()
    assert ts["name"] == branding.NAME
    assert ts["wordmark"] == branding.WORDMARK
    assert ts["desktop"] == branding.DESKTOP
    assert ts["vendor"] == branding.VENDOR
    assert ts["cli"] == branding.CLI
    assert ts["homeDirName"] == branding.HOME_DIR_NAME
    assert ts["appId"] == branding.APP_ID
    assert ts["protocol"] == branding.PROTOCOL


# =============================================================================
# Dikişler yerinde mi
# =============================================================================

#: docs/fool/SEAMS.md tablosuyla eşleşmeli.
#:
#: Not: ``brand-dist`` burada yok çünkü hedefi ``package.json`` ve JSON yorum
#: kabul etmiyor — o dikiş aşağıdaki
#: :func:`test_desktop_package_carries_fool_identity` ile korunuyor.
EXPECTED_SEAMS = {
    "i18n-brand",
    "wordmark",
    "theme-preset",
    "update-origin",
    "banner-repo",
    "cli-scripts",
    "version-banner",
    "command-descriptions",
    "home-dir",
    "prog-name",
    "argparse-brand",
    "fool-packaging",
    "html-title",
    "bot-display-name",
    "bot-handle",
    "default-mode",
    "model-catalog",
    "diagnostics-endpoint",
    "nous-account-commands",
}


def _grep_seams() -> set[str]:
    proc = subprocess.run(
        ["git", "grep", "-h", "-o", r"FOOL-SEAM: [a-z0-9-]\+"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    return {line.split(": ", 1)[1].strip() for line in proc.stdout.splitlines() if ": " in line}


def test_every_declared_seam_is_still_in_the_tree() -> None:
    """Merge bir dikişi yuttuysa burada yakalanır."""
    found = _grep_seams()
    missing = EXPECTED_SEAMS - found
    assert not missing, (
        f"Kayıp dikiş(ler): {sorted(missing)}. "
        "Muhtemelen bir upstream merge markalaşmayı geri aldı. "
        "docs/fool/SEAMS.md tablosundaki 'geri koyma' sütununa bak."
    )


# =============================================================================
# Dağıtım kimliği
# =============================================================================


def test_desktop_package_carries_fool_identity() -> None:
    pkg = json.loads((REPO_ROOT / "apps/desktop/package.json").read_text(encoding="utf-8"))
    assert pkg["build"]["appId"] == branding.APP_ID
    assert pkg["build"]["productName"] == branding.NAME
    assert "nousresearch" not in json.dumps(pkg["build"]).lower()


def test_cli_entry_points_are_rebranded() -> None:
    text = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    scripts = re.search(r"\[project\.scripts\](.*?)(?:\n\[|\Z)", text, re.DOTALL)
    assert scripts, "pyproject.toml içinde [project.scripts] bulunamadı"
    body = scripts.group(1)
    assert f"{branding.CLI} =" in body
    # Modül yolları korunmalı — yalnızca komut adı değişti.
    assert "hermes_cli.main:main" in body


# =============================================================================
# Python CLI yüzeyleri
# =============================================================================


def test_command_descriptions_carry_no_upstream_brand() -> None:
    """``/help`` listesinde "Hermes" görünmemeli.

    ``CommandDef.__post_init__`` tüm açıklamaları geçerken markalar, bu yüzden
    upstream yeni komut eklediğinde de otomatik kapsanır.
    """
    from hermes_cli.commands import COMMAND_REGISTRY

    leftovers = [c.name for c in COMMAND_REGISTRY if "Hermes" in c.description]
    assert not leftovers, f"Markalanmamış komut açıklamaları: {leftovers}"


def test_version_banner_is_branded() -> None:
    from hermes_cli.banner import format_banner_version_label

    label = format_banner_version_label()
    assert label.startswith(branding.NAME)
    assert "Hermes" not in label


# =============================================================================
# Veri dizini: Python <-> Electron
# =============================================================================


def test_python_and_electron_agree_on_data_dir() -> None:
    """İki taraf ayrışırsa masaüstü uygulaması backend'ini bulamaz.

    Python ``hermes_constants._get_platform_default_hermes_home()`` ve Electron
    ``main.ts::resolveHermesHome()`` veri dizinini BAĞIMSIZ hesaplıyor. Bu test
    ikisinin aynı adı kullandığını doğrular.
    """
    posix_name = branding.HOME_DIR_NAME           # ".thefool"
    windows_name = posix_name.lstrip(".")          # "thefool"

    py = (REPO_ROOT / "hermes_constants.py").read_text(encoding="utf-8")
    assert f'base / "{windows_name}"' in py, "Python Windows yolu ayrışmış"
    assert f'Path.home() / "{posix_name}"' in py, "Python POSIX yolu ayrışmış"

    ts = (REPO_ROOT / "apps/desktop/electron/main.ts").read_text(encoding="utf-8")
    assert f"path.join(process.env.LOCALAPPDATA, '{windows_name}')" in ts, (
        "Electron Windows yolu ayrışmış"
    )
    assert f"path.join(app.getPath('home'), '{posix_name}')" in ts, (
        "Electron POSIX yolu ayrışmış"
    )


def test_the_fool_never_uses_the_upstream_hermes_data_dir() -> None:
    """Kullanıcının kurulu Hermes verisine dokunmama garantisi."""
    import hermes_constants

    home = str(hermes_constants.get_hermes_home()).lower().replace("\\", "/")
    assert not home.endswith("local/hermes")
    assert not home.endswith("/.hermes")


# =============================================================================
# Nous bağlarının kesildiği
# =============================================================================


def test_model_catalog_makes_no_network_call_by_default() -> None:
    """Katalog sürümle birlikte geliyor; her açılışta Nous'a istek gitmiyor."""
    from hermes_cli import model_catalog

    assert model_catalog.DEFAULT_CATALOG_URL == ""
    assert model_catalog.DEFAULT_CATALOG_FALLBACK_URLS == ()
    # URL yoksa fetch zinciri ağa hiç dokunmadan None döner.
    assert model_catalog._fetch_manifest_with_fallback("", 5.0, ()) is None


def test_diagnostics_upload_is_disabled_by_default() -> None:
    """Loglar ve sistem bilgisi üçüncü tarafa gitmemeli."""
    import hermes_cli.diagnostics_upload as diag

    assert diag.NAS_BASE == ""
    with pytest.raises(RuntimeError, match="disabled in The Fool"):
        diag.request_upload_url()


def test_nous_account_commands_are_gone() -> None:
    """Var olmayan bir planı vaat eden komut, olmayan komuttan kötüdür."""
    from hermes_cli.commands import COMMAND_REGISTRY

    names = {c.name for c in COMMAND_REGISTRY}
    assert "subscription" not in names
    assert "topup" not in names


def test_no_command_promises_a_plan_we_do_not_have() -> None:
    from hermes_cli.commands import COMMAND_REGISTRY

    bogus = [c.name for c in COMMAND_REGISTRY if branding.VENDOR in c.description]
    assert not bogus, f"'{branding.VENDOR}' vaadi taşıyan komutlar: {bogus}"
