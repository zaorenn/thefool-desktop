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

    THEFOOL_HOME  -> eşleşmez   (env değişkeni sağlam kalır)
    thefool_cli   -> eşleşmez   (modül adı sağlam kalır)
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
#: Ajanın KENDİNİ tanıttığı ad. Sistem promptuna giren kimlik budur; kullanıcı
#: "hangi uygulamayı kullanıyorum?" diye sorduğunda bu cevabı verir.
#: Ürün adı "The Fool", ajanın adı "Fool Agent" — upstream'deki
#: "Hermes" / "Hermes Agent" ayrımının karşılığı.
AGENT: Final[str] = "Fool Agent"
#: "Nous Research" yerine geçen üretici adı.
VENDOR: Final[str] = "Fool Labs"
#: Terminal komutu — pyproject ``[project.scripts]`` ile eşleşmeli.
CLI: Final[str] = "fool"
#: Veri dizini adı — ``~/.thefool``.
HOME_DIR_NAME: Final[str] = ".fool"
#: electron-builder appId.
APP_ID: Final[str] = "com.fool.desktop"
#: Derin bağlantı şeması.
PROTOCOL: Final[str] = "fool"

#: Kullanıcının kendi deposu — güncellemeler buradan gelir.
#: (Henüz yayınlanmadı; yerel çalışırken yalnızca bir yer tutucu.)
REPO_URL: Final[str] = "https://github.com/zaorenn/thefool-desktop"


# =============================================================================
# Metin dönüşümü
# =============================================================================

#: Sıra ÖNEMLİ: en uzun/en özel kalıp önce. Aksi halde "Hermes Desktop" daha
#: genel olan "Hermes" kuralına yenilir ve "The Fool Desktop" üretilemez.
_RULES: Final[tuple[tuple[re.Pattern[str], str], ...]] = (
    (re.compile(r"\bHERMES\s+DESKTOP\b"), DESKTOP.upper()),
    (re.compile(r"\bHERMES\s+AGENT\b"), AGENT.upper()),
    (re.compile(r"\bHermes\s+Desktop\b"), DESKTOP),
    # "Hermes Agent" -> "Fool Agent": ajanin tam adi. Acilis logotype'i bu
    # kuraldan GECMEZ, dogrudan WORDMARK sabitinden geliyor.
    (re.compile(r"\bHermes\s+Agent\b"), AGENT),
    (re.compile(r"\bNous\s+Research\b"), VENDOR),
    (re.compile(r"\bNous\b"), VENDOR),
    (re.compile(r"\bHERMES\b"), WORDMARK),
    (re.compile(r"\bHermes\b"), NAME),
    (re.compile(r"\bhermes\b"), CLI),
)


#: Ad "The" içerdiği için ham değiştirme yer yer bozuk İngilizce üretir:
#:   "Restore a Hermes backup"      -> "Restore a The Fool backup"     ✗
#:   "Open the safe Hermes console" -> "Open the safe The Fool console" ✗
#:
#: Çözüm: bir artikel (a/an/the/your) zaten varsa "The" düşer ve ad sıradan bir
#: özel isim gibi davranır ("a Fool backup", "the safe Fool console"). Tek başına
#: geçtiğinde tam ad korunur ("The Fool couldn't start").
#:
#: Araya en fazla BİR sıfat girebilir. Pencere bilinçli olarak dar:
#:   "the safe The Fool console"          -> yakalanır, düzeltilir   ✓
#:   "a standing goal The Fool works on"  -> yakalanmaz, tam ad kalır ✓
#: İki kelimelik pencere ikincisini de yanlışlıkla yakalayıp "goal Fool works
#: on" üretiyordu — artikel oradaki isme ("goal") aitti, ürüne değil.
_ARTICLE_FIX: Final[tuple[tuple[re.Pattern[str], str], ...]] = (
    (
        re.compile(
            r"\b(a|an|the|your|my|its|their)\s+((?:\w+\s+){0,1}?)The\s+Fool\b",
            re.IGNORECASE,
        ),
        r"\1 \2Fool",
    ),
    # "The The Fool" gibi çift artikel birikmelerini sadeleştir.
    (re.compile(r"\bThe\s+The\s+Fool\b"), "The Fool"),
)


def brand_text(text: str) -> str:
    """Tek bir metni markala."""
    out = text
    for pattern, replacement in _RULES:
        out = pattern.sub(replacement, out)
    for pattern, replacement in _ARTICLE_FIX:
        out = pattern.sub(replacement, out)
    return out


#: Beceri dizini satırı — iki biçim:
#:     ``  <kategori>: <açıklama>``
#:     ``    - <ad>: <açıklama>``
#: Baştaki ad, ``skill_view(name='…')`` ile ÇAĞRILAN bir tanımlayıcı —
#: markalanırsa ajan var olmayan bir beceriyi çağırır. Bu yüzden yalnızca ilk
#: ``: ``den sonrası dönüştürülür.
_SKILL_LINE = re.compile(r"^(\s*(?:-\s+)?[A-Za-z0-9._-]+:\s*)(.*)$")


def brand_skill_index(text: str) -> str:
    """Beceri dizinindeki açıklamaları markala, adlara dokunma.

    Sistem promptundaki beceri dizini, modelin "hangi uygulamadayım?" sorusuna
    verdiği cevabın en güçlü sinyallerinden biri: içinde
    ``hermes-agent: ... orchestrate Hermes Agent.`` gibi satırlar geçiyor.
    Açıklamaları markalamak kimliği düzeltir; adları markalamak ise çağrıyı
    bozar. İkisi ayrı ele alınır.
    """
    out = []
    for line in text.split("\n"):
        m = _SKILL_LINE.match(line)
        if m:
            head, desc = m.group(1), m.group(2)
            out.append(head + brand_text(desc))
        else:
            # Kalıba uymayan satırlara HİÇ dokunma. Serbest metin
            # ``skill_view(name='hermes-agent')`` gibi çağrılabilir
            # tanımlayıcılar taşıyabilir; onları bozmaktansa markasız bırakmak
            # yeğdir.
            out.append(line)
    return "\n".join(out)


def brand_tool_schemas(tools: Any) -> Any:
    """Araç şemalarındaki ``description`` alanlarını markala.

    Araç şemaları sistem promptundan ayrı olarak modele gider; içlerinde
    "Hermes" geçen onlarca açıklama var. Model "hangi uygulamadayım?" sorusuna
    cevap verirken bunları da okuyor.

    Dokunulan: yalnızca ``description`` (üst seviye ve iç içe parametreler).
    Dokunulmayan: ``name``, parametre anahtarları, ``enum`` değerleri,
    ``type`` — bunlar çağrı sözleşmesi. Markalanırlarsa model var olmayan bir
    aracı çağırır.
    """

    def walk(node: Any, *, in_properties: bool = False) -> Any:
        if isinstance(node, dict):
            out: dict[str, Any] = {}
            for key, val in node.items():
                if key == "description" and isinstance(val, str):
                    out[key] = brand_text(val)
                elif key in ("name", "enum", "type", "required", "const"):
                    # Sözleşme: olduğu gibi geçer.
                    out[key] = val
                elif key == "properties" and isinstance(val, dict):
                    # Anahtarlar parametre ADLARI — yalnızca değerlere in.
                    out[key] = {k: walk(v, in_properties=True) for k, v in val.items()}
                else:
                    out[key] = walk(val, in_properties=in_properties)
            return out
        if isinstance(node, list):
            return [walk(v, in_properties=in_properties) for v in node]
        return node

    return walk(tools)


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
