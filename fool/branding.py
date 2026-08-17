"""The Fool — marka kimliğinin TEK kaynağı (Python tarafı).

Bu modül Bölge A'dadır: upstream'de ``fool/`` diye bir paket yok, dolayısıyla
burada yazılan hiçbir şey ``git merge upstream/main`` sırasında çakışmaz.

Karşılığı renderer tarafında ``apps/desktop/src/fool/branding.ts``. İki dosya
elle senkron tutulur; ``tests/fool/test_branding.py`` ikisinin uyuşmadığı anda
kırmızı yanar.

Neden bir *dönüşüm*, neden düz bir sabit listesi değil
---------------------------------------------------
``brand_text()`` metinleri geçerken markalar. Upstream yarın "Hermes" içeren
yeni metinler eklerse onlar da otomatik olarak The Fool olur. Statik bir çeviri
tablosu her upstream sürümünde elle güncelleme isterdi; bu istemiyor.

Sözleşmeye dokunulmaz
---------------------
Regex'te ``_`` bir kelime karakteri olduğu için ``\\b`` sınırları iç sözleşmeyi
kendiliğinden korur::

    HERMES_HOME  -> eşleşmez   (env değişkeni sağlam kalır)
    hermes_cli   -> eşleşmez   (modül adı sağlam kalır)
    ~/.hermes    -> eşleşir    (kullanıcıya görünen yol; değişmesini istiyoruz)

@see docs/fool/SEAMS.md
@see docs/fool/ARCHITECTURE.md
"""

from __future__ import annotations

import re
from typing import Any, Final

# =============================================================================
# Marka sabitleri — branding.ts ile birebir aynı olmalı
# =============================================================================

#: Ürünün konuşma dilindeki adı.
NAME: Final[str] = "The Fool"
#: Açılış ekranındaki büyük harf logotype.
WORDMARK: Final[str] = "THE FOOL"
#: Masaüstü uygulamasının tam adı.
DESKTOP: Final[str] = "The Fool Desktop"
#: "Nous Research" yerine geçen üretici adı.
VENDOR: Final[str] = "Fool Labs"
#: Terminal komutu — pyproject ``[project.scripts]`` ile eşleşmeli.
CLI: Final[str] = "thefool"
#: Veri dizini adı — ``~/.thefool``.
HOME_DIR_NAME: Final[str] = ".thefool"
#: electron-builder appId.
APP_ID: Final[str] = "com.thefool.desktop"
#: Derin bağlantı şeması.
PROTOCOL: Final[str] = "thefool"

#: Kullanıcının kendi deposu — güncellemeler buradan gelir.
#: (Henüz yayınlanmadı; yerel çalışırken yalnızca bir yer tutucu.)
REPO_URL: Final[str] = "https://github.com/serhanogurlu/thefool-desktop"


# =============================================================================
# Metin dönüşümü
# =============================================================================

#: Sıra ÖNEMLİ: en uzun/en özel kalıp önce. Aksi halde "Hermes Desktop" daha
#: genel olan "Hermes" kuralına yenilir ve "The Fool Desktop" üretilemez.
_RULES: Final[tuple[tuple[re.Pattern[str], str], ...]] = (
    (re.compile(r"\bHERMES\s+DESKTOP\b"), DESKTOP.upper()),
    (re.compile(r"\bHERMES\s+AGENT\b"), WORDMARK),
    (re.compile(r"\bHermes\s+Desktop\b"), DESKTOP),
    (re.compile(r"\bHermes\s+Agent\b"), NAME),
    (re.compile(r"\bNous\s+Research\b"), VENDOR),
    (re.compile(r"\bNous\b"), VENDOR),
    (re.compile(r"\bHERMES\b"), WORDMARK),
    (re.compile(r"\bHermes\b"), NAME),
    (re.compile(r"\bhermes\b"), CLI),
)


def brand_text(text: str) -> str:
    """Tek bir metni markala."""
    out = text
    for pattern, replacement in _RULES:
        out = pattern.sub(replacement, out)
    return out


def brand_value(value: Any) -> Any:
    """İç içe yapıları (dict/list/tuple/str) özyinelemeli markalar.

    ``locales/*.yaml`` yüklendikten sonra buradan geçirilir; sonuçta 17 dilin
    tamamı tek noktadan markalanmış olur.
    """
    if isinstance(value, str):
        return brand_text(value)
    if isinstance(value, dict):
        return {k: brand_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [brand_value(v) for v in value]
    if isinstance(value, tuple):
        return tuple(brand_value(v) for v in value)
    return value
