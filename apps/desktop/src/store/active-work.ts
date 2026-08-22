/**
 * Mirror of "which chats are mid-turn" to the main process.
 *
 * The renderer is the only side that knows a turn is in flight, and the main
 * process is the only side that can intercept a quit. This module bridges the
 * two: it publishes a small summary on every membership change, and
 * `electron/quit-guard.ts` turns that into the confirmation dialog.
 *
 * Imported for its side effect from `main.tsx`, alongside `store/translucency`.
 */

import { computed } from 'nanostores'

import type { HermesActiveWork } from '@/global'
import { $sessions } from '@/store/session'
import { $workingSessionIds } from '@/store/session-states'

import { whenMainWindow } from './main-window-only'

const $activeWork = computed([$workingSessionIds, $sessions], (workingIds, sessions): HermesActiveWork => {
  const titleById = new Map(sessions.map(session => [session.id, session.title?.trim() ?? '']))

  return {
    count: workingIds.length,
    titles: workingIds.map(id => titleById.get(id) ?? '').filter(Boolean)
  }
})

// FOOL-SEAM: voice-session-bridge
//
// Centik AYRI bir pencere ve kendi ``$activeSessionId``i hic dolmuyor. Ses
// oraya ``null`` gonderiyordu ve ag gecidi mesaji kendi sectigi bir oturuma
// dusuruyordu -- kullanicinin gordugu "mesajlar once bots kisminda cikiyor".
//
// Bu modul zaten ana pencerede yan etki olarak yukleniyor (``main.tsx``), yani
// koprunun dogal yeri burasi.
if (typeof window !== 'undefined') {
  whenMainWindow(() => {
    // YALNIZCA ana pencere yayinliyor.
    //
    // Centik AYNI bundle'i yukluyor (``?win=notch``), yani bu modul orada da
    // kosuyor. Guard olmadan centik kendi BOS ``$activeSessionId``ini
    // paylasilan atoma yaziyor ve ana pencerenin degerini EZIYOR -- kopru
    // kendi kendini bozuyordu. Sonucu kullanicinin gordugu sey: ses yine
    // yanlis oturuma gidiyor ve cevap bot panelinde cikiyor.
    void import('@/store/session').then(({ $activeSessionId }) =>
      import('@/fool/notch/active-session').then(({ $voiceSessionId }) =>
        $activeSessionId.subscribe(id => $voiceSessionId.set(id ?? ''))
      )
    )
  })
}

if (typeof window !== 'undefined') {
  // FOOL-SEAM: main-window-only-publisher
  //
  // YALNIZCA ana pencere yayinliyor.
  //
  // Centik AYNI bundle'i yukluyor (``?win=notch``) ve bu modul orada da
  // kosuyor. Centikte ``$sessions`` bos, yani o da ``count: 0`` yayinliyor ve
  // ana pencerenin ozetini EZIYOR -- son yazan kazaniyor. Bedeli iki yerde:
  // cikis muhafizi suren bir turu gormuyor, ve ``electron/stream-throttle.ts``
  // pencereleri akis ortasinda yeniden kisiyor.
  //
  // Ayni tuzak oturum koprusunde de yasandi (bkz. ``$voiceSessionId``): ses
  // yanlis oturuma gidip cevap bot panelinde cikiyordu.
  // `$sessions` republishes on unrelated churn (previews, heartbeats), so only
  // send when the summary itself moved — this crosses a process boundary.
  let lastSent = ''

  whenMainWindow(() =>
    $activeWork.subscribe(work => {

      const next = JSON.stringify(work)

      if (next === lastSent) {
        return
      }

      lastSent = next
      window.hermesDesktop?.setActiveWork?.(work)
    })
  )
}
