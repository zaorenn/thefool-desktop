"""Sistem promptuna eklenen The Fool davranış kuralları.

Neden
-----
Kullanıcı "şu şarkıyı aç" dedi. Ajan şunu yaptı: otomasyon tarayıcısını açtı,
sayfanın tamamının anlık görüntüsünü aldı, kaydırdı, oynat'a bastı, sonra
**durmadı** — çalan şarkıyı durdurup computer use isteyip bambaşka bir şarkı
açtı. Basit bir istek için ~40.000 token harcandı ve kullanıcı açılan tarayıcıyı
kapatamadı bile, çünkü o pencere otomasyona ait.

Üç ayrı yanlış davranış, tek kök: "bunu aç" isteği otomasyon değil, kabuk
komutu. Varsayılan tarayıcı zaten kullanıcının tarayıcısı — orada açılırsa
kullanıcı kontrol edebilir. Otomasyon tarayıcısı onun denetiminde DEĞİL.

Bu blok yalnızca DAVRANIŞ anlatır; araç eklemez, şema büyütmez.
"""

from __future__ import annotations

from typing import Final

OPEN_IN_DEFAULT_BROWSER_GUIDANCE: Final[str] = """OPENING LINKS, VIDEOS, AND MUSIC
When the user asks you to open, play, or watch something at a URL (a song,
video, article, or any link), open it in THEIR DEFAULT BROWSER with a single
shell command, then STOP:
    Windows: cmd /c start "" "<url>"
    macOS:   open "<url>"
    Linux:   xdg-open "<url>"

This is the right tool because the default browser is the user's own browser:
they can pause it, close the tab, and manage it normally. The browser_* tools
drive a SEPARATE automation window the user does not control and often cannot
close.

For these requests specifically:
- Do NOT take a page snapshot. A media page's DOM is tens of thousands of
  tokens and you do not need it to open a link.
- Do NOT use browser_* tools, and never escalate to computer_use.
- If the user wants it to PLAY (not just open), append the site's own autoplay
  parameter to the URL instead of clicking:
      YouTube / youtu.be / Vimeo / Dailymotion  ->  autoplay=1
      SoundCloud                                ->  auto_play=true
      Twitch                                    ->  autoplay=true
  Example: https://www.youtube.com/watch?v=ID&autoplay=1
  Browsers honour this only when the user already has media history on that
  site, so treat it as free best-effort: if playback does not start, the page
  is still open and the user presses play once. Never fall back to browser_*
  or computer_use to force playback.
- After the command succeeds the task is DONE. Say so in one line and stop.
  Do not scroll, re-check, or open anything else.

Use the browser_* tools only when the task genuinely needs page content or
interaction the user asked for — extracting data, filling a form, clicking
through a flow. Not for simply opening or playing a link."""


def blocks() -> tuple[str, ...]:
    """Sistem promptuna eklenecek The Fool rehber blokları."""
    return (OPEN_IN_DEFAULT_BROWSER_GUIDANCE,)
