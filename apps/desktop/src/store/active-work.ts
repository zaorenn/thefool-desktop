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
  void import('@/store/session').then(({ $activeSessionId }) =>
    import('@/fool/notch/active-session').then(({ $voiceSessionId }) =>
      $activeSessionId.subscribe(id => $voiceSessionId.set(id ?? ''))
    )
  )
}

if (typeof window !== 'undefined') {
  // `$sessions` republishes on unrelated churn (previews, heartbeats), so only
  // send when the summary itself moved — this crosses a process boundary.
  let lastSent = ''

  $activeWork.subscribe(work => {
    const next = JSON.stringify(work)

    if (next === lastSent) {
      return
    }

    lastSent = next
    window.hermesDesktop?.setActiveWork?.(work)
  })
}
