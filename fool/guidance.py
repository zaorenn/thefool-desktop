"""Sistem promptuna eklenen The Fool davranış kuralları.

Neden
-----
Kullanıcı "şu şarkıyı aç" dedi. Ajan şunu yaptı: otomasyon tarayıcısını açtı,
sayfanın tamamının anlık görüntüsünü aldı, kaydırdı, oynat'a bastı, sonra
**durmadı** — çalan şarkıyı durdurup computer use isteyip bambaşka bir şarkı
açtı. Basit bir istek için ~40.000 token harcandı ve kullanıcı açılan tarayıcıyı
kapatamadı bile, çünkü o pencere otomasyona ait.

Üç ayrı yanlış davranış var ve üçü de aynı kökten:

1. **Yanlış araç.** "Bunu aç" isteği otomasyon değil, kabuk komutu. Sistemin
   varsayılan tarayıcısı zaten kullanıcının tarayıcısı — orada açılırsa
   kullanıcı kontrol edebilir (kapatabilir, duraklatabilir, sekme yönetebilir).
   Otomasyon tarayıcısı kullanıcının denetiminde DEĞİL.
2. **Gereksiz okuma.** YouTube gibi sayfaların DOM anlık görüntüsü on binlerce
   token. Sadece bir bağlantı açmak için sayfayı okumaya gerek yok.
3. **Bitince durmamak.** Görev tamamlandıktan sonra devam etmek, tamamlanmış
   işi bozuyor.

Bu blok yalnızca DAVRANIŞ anlatır; araç eklemez, şema büyütmez.
"""

from __future__ import annotations

from typing import Final

#: "Bunu aç / oynat" niyetleri için doğru yol.
OPEN_IN_DEFAULT_BROWSER_GUIDANCE: Final[str] = (
    "OPENING LINKS, VIDEOS, AND MUSIC\n"
    "When the user asks you to open, play, or watch something at a URL "
    "(a song, video, article, or any link), open it in THEIR DEFAULT BROWSER "
    "with a single shell command and then STOP:\n"
    "  Windows: terminal -> cmd /c start \"\" \"<url>\"\n"
    "  macOS:   terminal -> open \"<url>\"\n"
    "  Linux:   terminal -> xdg-open \"<url>\"\n"
    "\n"
    "This is the right tool because the default browser is the user's own "
    "browser: they can pause it, close the tab, and manage it normally. The "
    "browser_* tools drive a SEPARATE automation window the user does not "
    "control and often cannot close.\n"
    "\n"
    "For these requests specifically:\n"
    "- Do NOT take a page snapshot. A media page's DOM is tens of thousands of "
    "tokens and you do not need it to open a link.\n"
    "- Do NOT use browser_* tools, and never escalate to computer_use.\n"
    "- Many sites autoplay; if the user wants playback and the site supports "
    "it, append the site's own autoplay parameter rather than clicking.\n"
    "- After the command succeeds, the task is DONE. Say so in one line and "
    "stop. Do not scroll, re-check, or open anything else.\n"
    "\n"
    "Use the browser_* tools only when the task genuinely needs page content "
    "or interaction the user asked for — extracting data, filling a form, "
    "clicking through a flow. Not for simply opening or playing a link."
)


def blocks() -> tuple[str, ...]:
    """Sistem promptuna eklenecek The Fool rehber blokları."""
    return (OPEN_IN_DEFAULT_BROWSER_GUIDANCE,)
