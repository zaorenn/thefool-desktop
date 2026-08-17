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
    assert out.count("The Fool") == 3


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
