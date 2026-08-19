"""Arkadaşınla konuşmak, ona terminalini vermek değil.

Ölçülen durum
-------------
Notch'un sesli turu, masaüstü sohbet panelinin OTURUMUNU paylaşıyor
(``$activeSessionId``). O oturum ``desktop`` kapsamında kuruluyor ve ölçtüm
(``tui_gateway.server._load_enabled_toolsets``, FOOL_DESKTOP=1):

    21 takım -- bfl, browser, clarify, code_execution, computer_use, cronjob,
    delegation, desktop_ui, file, image_gen, kanban, memory, project,
    session_search, skills, spotify, terminal, todo, tts, vision, web

Yani "hey, hava nasıl?" diyen sesli arkadaş, ``terminal_run``,
``computer_use``, ``execute_code`` ve ``delegate_task``a sahip. Kullanıcı
mikrofona konuşurken makinesinin tamamını açık tutuyor ve bunu hiçbir yerde
görmüyor.

İki ayrı sorun, tek kök:

1. **Yetki.** Sohbet için gereken araçlar ile iş yapmak için gereken araçlar
   aynı değil. Sesli sohbette yanlış anlaşılan bir cümlenin bedeli
   ``terminal_run`` olmamalı.
2. **Bağlam.** Sesli sohbet, ajanın üzerinde çalıştığı oturumun bağlamına
   karışıyor; iki farklı iş tek geçmişte birikiyor.

Bu modül KAPSAMI tanımlıyor. Kapsam bir oturum özelliği, tur özelliği değil:
tur başına araç değiştirmek ajanı yeniden kurmak demek ve donmuş sistem
promptu + araç şemaları üzerine kurulu prompt önbelleğini her turda çöpe
atardı (bkz. ``gateway/run.py`` ajan önbelleği).
"""

from __future__ import annotations

#: Uzak sesli arkadaş kapsamı (WhatsApp, Telegram, notch...).
COMPANION = "companion"

#: Masaüstündeki Friend penceresi.
#:
#: ``companion``dan TEK farkı hafıza. Uzak bir kullanıcıya sahibinin geçmiş
#: sohbetlerini açmak sızıntı; kendi makinesinde kendi penceresinde AÇMAMAK
#: ise arkadaşı hafızasız bırakmak -- her seferinde kendini yeniden anlatmak
#: zorunda kalıyorsun. Bu pencere yerel ve sahibinin, o yüzden hafıza ORTAK:
#: Friend ile ajan aynı ``MEMORY.md`` / ``USER.md`` dosyalarını görüyor.
FRIEND = "friend"

#: Sahibinin iş yaptığı kapsam (masaüstü sohbet paneli, TUI, CLI).
AGENT_SCOPES = frozenset({"cli", "desktop", "tui"})

#: Sesli sohbetin araçları.
#:
#: Ölçüt: "bu araç yanlış çağrılırsa bedeli ne?" Sohbette yanlış anlaşılma
#: sık ve normal; bedeli boşa giden bir tur olmalı, silinmiş bir dosya değil.
#:
#:   clarify      -- "ne demek istedin?" sorabilmek
#:   image_gen    -- görsel üretmek
#:   output_file  -- rapor/PDF üretmek (yalnızca yazan, okuma yetkisi yok)
#:   tts / vision -- konuşmak, gösterileni görmek
#:   web          -- bir şeye bakmak
#:
#: DIŞARIDA bırakılanlar ve sebepleri:
#:   terminal / file / code_execution / computer_use -- makinenin kendisi
#:   memory / session_search -- sahibinin geçmiş sohbetleri
#:   delegation  -- alt ajan kısıtlamayı dolanır
#:   cronjob     -- kalıcı zamanlanmış iş bırakır
#:   browser     -- oturum açılmış hesaplar
COMPANION_TOOLSETS = (
    "clarify",
    "image_gen",
    "output_file",
    "tts",
    "vision",
    "web",
)

#: Notch'un ``prompt.submit`` ile gönderdiği yüzey ipucu. Bugün sunucu
#: tarafında hiçbir şey okumuyor -- bu modülün var olma sebeplerinden biri.
COMPANION_SURFACES = frozenset({"companion", "hud", "notch"})

#: Friend penceresinin araçları: uzak arkadaşınkiler + HAFIZA.
#:
#: ``memory`` burada var, ``companion``da yok ve fark bilinçli: orada
#: kullanıcı uzakta ve tanınmıyor, burada makinenin sahibi kendi
#: penceresinde. ``session_search`` yine DIŞARIDA -- geçmiş sohbetleri
#: taramak hatırlamaktan farklı bir şey ve sohbet için gerekmiyor.
FRIEND_TOOLSETS = (
    "clarify",
    "image_gen",
    "memory",
    "output_file",
    "tts",
    "vision",
    "web",
)


def is_companion_surface(surface: object) -> bool:
    """Bu yüzey sesli arkadaş mı?"""
    if not isinstance(surface, str):
        return False
    return surface.strip().lower() in COMPANION_SURFACES


def scope_toolsets(scope: object) -> list[str] | None:
    """Bu kapsamın araç takımları.

    ``None`` = "kapsama özel bir kısıtlama yok, normal çözümlemeye devam et".
    Bilinmeyen bir kapsamı kısıtlamak, tanımadığımız bir yüzeyi sessizce
    kırmak olurdu.

    ``jarvis`` bilerek ``None`` döner: Jarvis kipi sahibinin TAM yüzeyini
    alıyor (kullanıcının açık tercihi). Kısıtlama orada değil, tool-calling
    sınavında -- bkz. ``fool/voice_modes.py`` ve ``fool/agent_authority.py``.
    """
    key = scope.strip().lower() if isinstance(scope, str) else ""
    if key == COMPANION:
        return list(COMPANION_TOOLSETS)
    if key == FRIEND:
        return list(FRIEND_TOOLSETS)
    return None
