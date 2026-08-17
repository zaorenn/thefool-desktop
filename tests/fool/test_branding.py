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
        ("HERMES AGENT", "FOOL AGENT"),
        ("Update Hermes", "Update The Fool"),
        ("Update Hermes Agent", "Update Fool Agent"),
        ("You are Hermes Agent", "You are Fool Agent"),
        ("Nous Research", "Fool Labs"),
        ("Hermes couldn't start", "The Fool couldn't start"),
        ("edit ~/.hermes/.env", "edit ~/.fool/.env"),
        ("run: hermes update", "run: fool update"),
    ],
)
def test_user_visible_text_is_rebranded(source: str, expected: str) -> None:
    assert branding.brand_text(source) == expected


@pytest.mark.parametrize(
    "source",
    [
        # Backend sözleşmesi: bunlar ASLA değişmemeli.
        "Set FOOL_HOME to override",
        "from fool_cli.main import main",
        "FOOL_API_TIMEOUT=1800",
        "import fool_constants",
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
    """``fool-branding.ts`` içindeki ``BRAND`` nesnesini kabaca ayrıştır.

    Tanım ``apps/shared`` altında: aynı dönüşümü hem masaüstü uygulaması hem
    web panosu kullanıyor (FOOL-SEAM: shared-branding). Masaüstündeki
    ``src/fool/branding.ts`` artık yalnızca yeniden dışa aktarım.
    """
    ts = (REPO_ROOT / "apps/shared/src/fool-branding.ts").read_text(encoding="utf-8")
    block = re.search(r"export const BRAND = \{(.*?)\} as const", ts, re.DOTALL)
    assert block, "branding.ts içinde BRAND bloğu bulunamadı"
    return dict(re.findall(r"(\w+):\s*'([^']*)'", block.group(1)))


def test_python_and_typescript_brand_constants_agree() -> None:
    """İki taraf ayrışırsa arayüz ve backend farklı isimler gösterir."""
    ts = _read_ts_brand()
    assert ts["name"] == branding.NAME
    assert ts["wordmark"] == branding.WORDMARK
    assert ts["desktop"] == branding.DESKTOP
    assert ts["agent"] == branding.AGENT
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
    "agent-identity",
    "anthropic-sanitize",
    "client-attribution",
    "brand-mark",
    "bootstrap-repo",
    "env-compat",
    "locale-brand",
    "web-i18n-brand",
    "shared-branding",
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
    assert "fool_cli.main:main" in body


# =============================================================================
# Python CLI yüzeyleri
# =============================================================================


def test_command_descriptions_carry_no_upstream_brand() -> None:
    """``/help`` listesinde "Hermes" görünmemeli.

    ``CommandDef.__post_init__`` tüm açıklamaları geçerken markalar, bu yüzden
    upstream yeni komut eklediğinde de otomatik kapsanır.
    """
    from fool_cli.commands import COMMAND_REGISTRY

    leftovers = [c.name for c in COMMAND_REGISTRY if "Hermes" in c.description]
    assert not leftovers, f"Markalanmamış komut açıklamaları: {leftovers}"


def test_version_banner_is_branded() -> None:
    from fool_cli.banner import format_banner_version_label

    label = format_banner_version_label()
    assert label.startswith(branding.NAME)
    assert "Hermes" not in label


# =============================================================================
# Veri dizini: Python <-> Electron
# =============================================================================


def test_python_and_electron_agree_on_data_dir() -> None:
    """İki taraf ayrışırsa masaüstü uygulaması backend'ini bulamaz.

    Python ``fool_constants._get_platform_default_hermes_home()`` ve Electron
    ``main.ts::resolveHermesHome()`` veri dizinini BAĞIMSIZ hesaplıyor. Bu test
    ikisinin aynı adı kullandığını doğrular.
    """
    posix_name = branding.HOME_DIR_NAME           # ".fool"
    windows_name = posix_name.lstrip(".")          # "fool"

    py = (REPO_ROOT / "fool_constants.py").read_text(encoding="utf-8")
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
    import fool_constants

    home = str(fool_constants.get_hermes_home()).lower().replace("\\", "/")
    assert not home.endswith("local/hermes")
    assert not home.endswith("/.hermes")


# =============================================================================
# Nous bağlarının kesildiği
# =============================================================================


def test_model_catalog_makes_no_network_call_by_default() -> None:
    """Katalog sürümle birlikte geliyor; her açılışta Nous'a istek gitmiyor."""
    from fool_cli import model_catalog

    assert model_catalog.DEFAULT_CATALOG_URL == ""
    assert model_catalog.DEFAULT_CATALOG_FALLBACK_URLS == ()
    # URL yoksa fetch zinciri ağa hiç dokunmadan None döner.
    assert model_catalog._fetch_manifest_with_fallback("", 5.0, ()) is None


def test_diagnostics_upload_is_disabled_by_default() -> None:
    """Loglar ve sistem bilgisi üçüncü tarafa gitmemeli."""
    import fool_cli.diagnostics_upload as diag

    assert diag.NAS_BASE == ""
    with pytest.raises(RuntimeError, match="disabled in The Fool"):
        diag.request_upload_url()


def test_nous_account_commands_are_gone() -> None:
    """Var olmayan bir planı vaat eden komut, olmayan komuttan kötüdür."""
    from fool_cli.commands import COMMAND_REGISTRY

    names = {c.name for c in COMMAND_REGISTRY}
    assert "subscription" not in names
    assert "topup" not in names


def test_no_command_promises_a_plan_we_do_not_have() -> None:
    from fool_cli.commands import COMMAND_REGISTRY

    bogus = [c.name for c in COMMAND_REGISTRY if branding.VENDOR in c.description]
    assert not bogus, f"'{branding.VENDOR}' vaadi taşıyan komutlar: {bogus}"


# =============================================================================
# Ajanın kendini tanıması
# =============================================================================


def test_agent_identifies_itself_as_fool_agent() -> None:
    """Kullanıcı "hangi uygulamayı kullanıyorum?" dediğinde verilen cevap.

    Markalaşmanın en derin katmanı: arayüzdeki her yazı değişse bile bu
    değişmezse ajan kendini hâlâ Hermes Agent sanır.
    """
    from agent.prompt_builder import DEFAULT_AGENT_IDENTITY, FOOL_AGENT_HELP_GUIDANCE

    assert DEFAULT_AGENT_IDENTITY.startswith(f"You are {branding.AGENT},")
    assert "Hermes" not in DEFAULT_AGENT_IDENTITY
    assert "Nous Research" not in DEFAULT_AGENT_IDENTITY

    assert branding.AGENT in FOOL_AGENT_HELP_GUIDANCE
    assert "nousresearch.com" not in FOOL_AGENT_HELP_GUIDANCE


def test_anthropic_sanitizer_covers_the_fool_identity() -> None:
    """Anthropic OAuth ucuna markalı prompt gitmemeli.

    Kimlik "Fool Agent" olduğu için sanitize listesi güncellenmezse
    upstream'in filtre-kaçınma korumasi sessizce delinir.
    """
    src = (REPO_ROOT / "agent/anthropic_adapter.py").read_text(encoding="utf-8")
    assert f'text.replace("{branding.AGENT}", "Claude Code")' in src
    assert f'text.replace("{branding.NAME}", "Claude Code")' in src


def test_tool_schema_branding_preserves_the_call_contract() -> None:
    """Açıklamalar markalanır, çağrı sözleşmesi ASLA değişmez.

    Araç adı / parametre anahtarı / enum markalanırsa model var olmayan bir
    aracı çağırır — sessiz ve teşhisi zor bir bozulma.
    """
    sample = [
        {
            "type": "function",
            "function": {
                "name": "hermes_screenshot",
                "description": "Otherwise Hermes falls back to a vision model.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "hermes_path": {"type": "string", "description": "Path used by Hermes."},
                        "mode": {"type": "string", "enum": ["hermes", "fast"]},
                    },
                    "required": ["hermes_path"],
                },
            },
        }
    ]
    fn = branding.brand_tool_schemas(sample)[0]["function"]

    # Sözleşme aynen durmalı.
    assert fn["name"] == "hermes_screenshot"
    assert list(fn["parameters"]["properties"]) == ["hermes_path", "mode"]
    assert fn["parameters"]["properties"]["mode"]["enum"] == ["hermes", "fast"]
    assert fn["parameters"]["required"] == ["hermes_path"]

    # Açıklamalar markalanmalı.
    assert "Hermes" not in fn["description"]
    assert "Hermes" not in fn["parameters"]["properties"]["hermes_path"]["description"]


def test_skill_index_branding_preserves_skill_names() -> None:
    """Beceri adları ``skill_view(name=…)`` ile çağrılıyor — değişemez."""
    index = (
        "  agents: Delegate work to other agents.\n"
        "    - hermes-agent: Use, configure, and orchestrate Hermes Agent.\n"
        "    - codex: Delegate coding to OpenAI Codex CLI.\n"
    )
    out = branding.brand_skill_index(index)

    assert "- hermes-agent:" in out, "beceri adı korunmalı"
    assert "orchestrate Fool Agent." in out, "açıklama markalanmalı"
    assert "- codex:" in out


def test_default_soul_matches_the_agent_identity() -> None:
    """SOUL.md, DEFAULT_AGENT_IDENTITY'yi gölgeler — ikisi ayrışmamalı."""
    from agent.prompt_builder import DEFAULT_AGENT_IDENTITY
    from fool_cli.default_soul import DEFAULT_SOUL_MD

    assert DEFAULT_SOUL_MD == DEFAULT_AGENT_IDENTITY


def test_upstream_default_soul_is_upgradable_in_place() -> None:
    """Hermes'ten gelen makine-serili SOUL.md sessizce kimliği ele geçirmemeli."""
    from fool_cli.default_soul import is_legacy_template_soul

    upstream_soul = (
        "You are Hermes Agent, an intelligent AI assistant created by Nous Research. "
        "You are helpful, knowledgeable, and direct. You assist users with a wide "
        "range of tasks including answering questions, writing and editing code, "
        "analyzing information, creative work, and executing actions via your tools. "
        "You communicate clearly, admit uncertainty when appropriate, and prioritize "
        "being genuinely useful over being verbose unless otherwise directed below. "
        "Be targeted and efficient in your exploration and investigations."
    )
    assert is_legacy_template_soul(upstream_soul)
    # Kullanıcının kendi yazdığı bir persona ASLA üzerine yazılmamalı.
    assert not is_legacy_template_soul("You are a grumpy pirate.")


# =============================================================================
# Bootstrap: paketlenmiş uygulama HANGİ depoyu kuruyor
# =============================================================================


def test_bootstrap_installs_the_fool_not_upstream() -> None:
    """FOOL-SEAM: bootstrap-repo — en sinsi kaçak buydu.

    Paketlenmiş uygulama backend'ini kurmak için bir kurulum betiği indirip
    çalıştırıyor, o betik de bir depo klonluyor. Bu adresler upstream'de
    kalırsa uygulama The Fool gibi görünür ama HER KULLANICIYA upstream
    Hermes kurar — ve markalaşmanın tamamı çalışma anında geri alınır.

    Belirti (gözlendi): bootstrap upstream'i klonluyor, sonra The Fool'un
    commit'ini checkout etmeye çalışıp ``exit 128`` ile ölüyor.
    """
    targets = [
        "apps/desktop/electron/bootstrap-runner.ts",
        "apps/desktop/electron/update-remote.ts",
        "scripts/install.ps1",
        "scripts/install.sh",
    ]
    offenders = []
    for rel in targets:
        text = (REPO_ROOT / rel).read_text(encoding="utf-8", errors="replace")
        if "NousResearch/hermes-agent" in text:
            offenders.append(rel)
        assert "zaorenn/thefool-desktop" in text, f"{rel}: fork deposu geçmiyor"

    assert not offenders, f"upstream deposunu kuran dosyalar: {offenders}"


# =============================================================================
# Ortam değişkeni geriye dönük uyumluluğu
# =============================================================================


def test_legacy_hermes_env_still_resolves(monkeypatch: pytest.MonkeyPatch) -> None:
    """FOOL-SEAM: env-compat — eski ayarlar sessizce yok sayılmamalı.

    Kullanıcı ``setx FOOL_HOME`` yapmış olabilir. Yok sayılırsa uygulama
    hatasız açılır ama YANLIŞ dizini kullanır — oturumlar ve hafıza kaybolmuş
    görünür. Teşhisi en zor hata türü.
    """
    from fool import compat

    monkeypatch.delenv("FOOL_HOME", raising=False)
    monkeypatch.setenv("FOOL_HOME", r"C:\eski\yol")
    assert compat.getenv("FOOL_HOME") == r"C:\eski\yol"


def test_new_env_name_wins_over_legacy(monkeypatch: pytest.MonkeyPatch) -> None:
    """İkisi birden ayarlıysa davranış belirsiz kalmamalı."""
    from fool import compat

    monkeypatch.setenv("FOOL_HOME", r"C:\eski")
    monkeypatch.setenv("FOOL_HOME", r"C:\yeni")
    assert compat.getenv("FOOL_HOME") == r"C:\yeni"


def test_home_resolution_honours_legacy_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Uçtan uca: gerçek veri dizini çözümlemesi eski değişkeni görüyor mu."""
    import fool_constants

    monkeypatch.delenv("FOOL_HOME", raising=False)
    monkeypatch.setenv("FOOL_HOME", r"C:\eski\fool-home")
    assert str(fool_constants._hermes_home_from_env()) == r"C:\eski\fool-home"
