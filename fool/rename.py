"""Deterministik tam yeniden adlandırma — backend + frontend.

Neden bir ARAÇ, neden tek seferlik bul-değiştir değil
-----------------------------------------------------
Tam rebrand yapıldığında upstream birleştirmesi normalde ölür: ``hermes_cli``
adını ``thefool_cli`` yaparsan upstream'in aynı dosyalara dokunan her commit'i
çatışır. Ölçtük — bir aylık upstream değişikliği **2.776 dosyada** çakışıyor.

Bu araç o duvarı aşmak için var. Yeniden adlandırma tek seferlik bir olay değil,
**yeniden çalıştırılabilir bir dönüşüm**. Upstream birleştirme akışı::

    git fetch upstream
    git checkout -b upstream-renamed upstream/main
    python -m fool.rename --apply          # upstream'in KOPYASINI dönüştür
    git commit -am "rename upstream snapshot"
    git checkout main
    git merge upstream-renamed

Upstream deposuna hiç dokunulmuyor — kendi ağacımızda bir kopyasını
dönüştürüyoruz. Merge artık ikisi de yeniden adlandırılmış olan iki ağaç
arasında yapılıyor, yani çatışmalar yalnızca GERÇEK içerik farklarında çıkıyor.

İki özellik bunun çalışması için şart:

**Deterministik** — aynı girdi her zaman aynı çıktıyı verir. Aksi halde iki
taraf ayrışır ve merge anlamsızlaşır.

**Idempotent** — zaten dönüştürülmüş bir ağaca tekrar uygulanması hiçbir şeyi
değiştirmez. Bu sayede araç güvenle tekrar tekrar çalıştırılabilir.

Kullanım::

    python -m fool.rename              # kuru çalışma (varsayılan)
    python -m fool.rename --apply      # yaz
    python -m fool.rename --verify     # idempotent mi, sözleşme sağlam mı
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


# =============================================================================
# Yeniden adlandırma tablosu
# =============================================================================
#
# Sıra ÖNEMLİ: uzun adlar önce gelmeli. ``hermes_state_common`` ,
# ``hermes_state``den önce eşleşmezse ortaya ``thefool_state_common`` yerine
# ``thefool_state_common`` çıkmaz — ``hermes_state`` kuralı önce vurur ve
# geri kalanı bozar.

#: Python modül / paket adları.
MODULE_RENAMES: tuple[tuple[str, str], ...] = (
    ("hermes_state_portability", "thefool_state_portability"),
    ("hermes_state_common", "thefool_state_common"),
    ("hermes_state_schema", "thefool_state_schema"),
    ("hermes_state_search", "thefool_state_search"),
    ("hermes_bootstrap", "thefool_bootstrap"),
    ("hermes_constants", "thefool_constants"),
    ("hermes_logging", "thefool_logging"),
    ("hermes_state", "thefool_state"),
    ("hermes_time", "thefool_time"),
    ("hermes_cli", "thefool_cli"),
)

#: npm scope.
NPM_RENAMES: tuple[tuple[str, str], ...] = (
    ("@hermes/", "@thefool/"),
)

#: Ortam değişkeni öneki. Geriye dönük uyumluluk ``fool/compat.py``de —
#: THEFOOL_* birincil, HERMES_* okunmaya devam eder.
ENV_PREFIX: tuple[str, str] = ("HERMES_", "THEFOOL_")

#: DOKUNULMAYACAKLAR — bunlar dış dünyaya bağlı, değişirlerse bir şey kırılır.
#:
#: ``hermes-agent``  upstream deposunun adı; atıf ve merge yolu için gerekli.
#:                   Ayrıca bir beceri kimliği (``skill_view(name=…)``).
#: ``.hermes``       kullanıcıların mevcut veri dizini; göç yolu ayrı ele alınır.
PROTECTED: tuple[re.Pattern[str], ...] = (
    re.compile(r"NousResearch/hermes-agent"),
    re.compile(r"github\.com/nousresearch"),
    re.compile(r"hermes-agent(?:-[a-z-]+)?"),   # beceri/paket kimlikleri
)

#: Dönüştürülecek dosya uzantıları.
TEXT_SUFFIXES: frozenset[str] = frozenset({
    ".py", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yaml", ".yml",
    ".toml", ".md", ".html", ".css", ".sh", ".ps1", ".txt", ".cfg", ".ini",
    ".nix", ".lock", ".example",
})

#: Hiç girilmeyecek dizinler.
SKIP_DIRS: frozenset[str] = frozenset({
    ".git", "node_modules", "dist", "release", "build", "__pycache__",
    ".venv", "venv", ".mypy_cache", ".pytest_cache", ".ruff_cache",
})


@dataclass
class Plan:
    """Bir çalıştırmanın planı."""
    content_edits: dict[Path, int] = field(default_factory=dict)
    path_renames: list[tuple[Path, Path]] = field(default_factory=list)

    @property
    def total_edits(self) -> int:
        return sum(self.content_edits.values())


# =============================================================================
# Dönüşüm
# =============================================================================

def _protect(text: str) -> tuple[str, list[str]]:
    """Korunacak parçaları yer tutucuyla değiştir, sonra geri koyulacak."""
    stash: list[str] = []

    def grab(m: re.Match[str]) -> str:
        stash.append(m.group(0))
        return f"\x00FOOLPROTECT{len(stash) - 1}\x00"

    for pattern in PROTECTED:
        text = pattern.sub(grab, text)
    return text, stash


def _unprotect(text: str, stash: list[str]) -> str:
    for i, original in enumerate(stash):
        text = text.replace(f"\x00FOOLPROTECT{i}\x00", original)
    return text


def transform(text: str) -> str:
    """Bir metnin tamamını dönüştür. Deterministik ve idempotent."""
    text, stash = _protect(text)

    for old, new in MODULE_RENAMES:
        text = re.sub(rf"\b{re.escape(old)}\b", new, text)

    for old, new in NPM_RENAMES:
        text = text.replace(old, new)

    old_env, new_env = ENV_PREFIX
    text = re.sub(rf"\b{re.escape(old_env)}([A-Z0-9_]+)", rf"{new_env}\1", text)

    return _unprotect(text, stash)


def transform_path_name(name: str) -> str:
    """Tek bir yol bileşenini (dosya veya dizin adı) dönüştür."""
    for old, new in MODULE_RENAMES:
        if name == old or name.startswith(old + "."):
            return new + name[len(old):]
    return name


def transform_relpath(rel: Path) -> Path:
    """Yolun HER bileşenini dönüştür.

    Yalnızca dosya adına bakmak yetmez: asıl yeniden adlandırma ``hermes_cli/``
    DİZİNİ. ``git ls-files`` dosya döndürdüğü için dizin adı ancak yolun
    bileşenleri tek tek dönüştürülürse yakalanır.
    """
    return Path(*[transform_path_name(part) for part in rel.parts])


# =============================================================================
# Ağaç gezme
# =============================================================================

def _iter_files(root: Path) -> list[Path]:
    proc = subprocess.run(
        ["git", "ls-files"], cwd=root, capture_output=True, text=True
    )
    files = []
    for line in proc.stdout.splitlines():
        rel = line.strip()
        if not rel:
            continue
        parts = Path(rel).parts
        if any(p in SKIP_DIRS for p in parts):
            continue
        files.append(root / rel)
    return files


def build_plan(root: Path = REPO_ROOT) -> Plan:
    plan = Plan()

    for path in _iter_files(root):
        if path.suffix.lower() not in TEXT_SUFFIXES and path.suffix != "":
            continue
        try:
            original = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        updated = transform(original)
        if updated != original:
            changed = sum(1 for a, b in zip(original.splitlines(), updated.splitlines()) if a != b)
            plan.content_edits[path] = max(changed, 1)

        rel = path.relative_to(root)
        new_rel = transform_relpath(rel)
        if new_rel != rel:
            plan.path_renames.append((path, root / new_rel))

    return plan


def apply_plan(plan: Plan, root: Path = REPO_ROOT) -> None:
    for path in plan.content_edits:
        text = path.read_text(encoding="utf-8")
        path.write_text(transform(text), encoding="utf-8")

    for old_path, new_path in plan.path_renames:
        new_path.parent.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(
            ["git", "mv", str(old_path.relative_to(root)), str(new_path.relative_to(root))],
            cwd=root, capture_output=True, text=True,
        )
        if result.returncode != 0:
            # git mv, hedef dizin git'in bilmedigi bir yerdeyse takilabilir;
            # duz tasima + index guncellemesi ayni sonucu verir.
            old_path.replace(new_path)
            subprocess.run(["git", "add", "-A", str(new_path.relative_to(root))],
                           cwd=root, capture_output=True, text=True)


# =============================================================================
# Doğrulama
# =============================================================================

def verify_idempotent() -> list[str]:
    """İkinci geçişin hiçbir şey değiştirmediğini kanıtla.

    Idempotent olmazsa upstream birleştirme akışı çöker: iki taraf farklı
    sayıda dönüşüm geçirmiş olur ve merge anlamsız çatışmalar üretir.
    """
    problems: list[str] = []
    samples = [
        "from hermes_cli.main import main",
        "import hermes_constants",
        "HERMES_HOME=/tmp",
        "os.environ['HERMES_API_TIMEOUT']",
        "@hermes/plugin-sdk",
        "hermes_state_common.load()",
    ]
    for sample in samples:
        once = transform(sample)
        twice = transform(once)
        if once != twice:
            problems.append(f"idempotent degil: {sample!r} -> {once!r} -> {twice!r}")
    return problems


def verify_protected() -> list[str]:
    """Korunan değerlerin dönüşümden geçmediğini kanıtla."""
    problems: list[str] = []
    samples = [
        "https://github.com/NousResearch/hermes-agent.git",
        "skill_view(name='hermes-agent')",
        "hermes-agent-skill-authoring",
    ]
    for sample in samples:
        if transform(sample) != sample:
            problems.append(f"korunmali ama degisti: {sample!r} -> {transform(sample)!r}")
    return problems


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="thefool-rename",
        description="Backend + frontend tam yeniden adlandirma (deterministik, idempotent).",
    )
    ap.add_argument("--apply", action="store_true", help="degisiklikleri yaz")
    ap.add_argument("--verify", action="store_true", help="yalnizca kendi kendini dogrula")
    ap.add_argument("--root", default=str(REPO_ROOT), help="donusturulecek agac")
    args = ap.parse_args(argv)

    if args.verify:
        problems = verify_idempotent() + verify_protected()
        if problems:
            print("DOGRULAMA BASARISIZ:")
            for p in problems:
                print("  -", p)
            return 1
        print("Dogrulama tamam: donusum deterministik, idempotent ve korunanlara dokunmuyor.")
        return 0

    root = Path(args.root).resolve()
    plan = build_plan(root)

    print(f"Icerik degisikligi : {len(plan.content_edits)} dosya, ~{plan.total_edits} satir")
    print(f"Yol degisimi       : {len(plan.path_renames)}")

    # Dizin tasimalarini ozetle -- 967 satirin tamamini basmak yerine
    # "hangi dizin nereye gidiyor" bilgisi cok daha okunur.
    dir_moves: dict[str, int] = {}
    file_moves: list[tuple[str, str]] = []
    for old_path, new_path in plan.path_renames:
        old_rel = old_path.relative_to(root)
        new_rel = new_path.relative_to(root)
        if old_rel.parent != new_rel.parent:
            key = f"{old_rel.parts[0]}/  ->  {new_rel.parts[0]}/"
            dir_moves[key] = dir_moves.get(key, 0) + 1
        else:
            file_moves.append((str(old_rel), str(new_rel)))

    for key, count in sorted(dir_moves.items(), key=lambda kv: -kv[1]):
        print(f"    {key}   ({count} dosya)")
    for old_rel, new_rel in file_moves[:15]:
        print(f"    {old_rel}  ->  {new_rel}")
    if len(file_moves) > 15:
        print(f"    ... +{len(file_moves) - 15} dosya")

    if not args.apply:
        print("\nKuru calisma. Yazmak icin: --apply")
        return 0

    apply_plan(plan, root)
    print("\nUygulandi.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
