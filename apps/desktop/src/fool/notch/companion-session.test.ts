import { describe, expect, it, vi } from 'vitest'

import {
  COMPANION_SOURCE,
  createCompanionSessionState,
  ensureCompanionSession,
  forgetCompanionSession
} from './companion-session'

describe('arkadas oturumu', () => {
  it('kaynagi companion olarak aciyor', async () => {
    // Ag gecidi bu kaynagi gorunce kisitli kapsami uyguluyor
    // (fool/session_scope.py). Olculdu: desktop 21 takim / 8 tehlikeli,
    // companion 6 takim / 0 tehlikeli.
    const create = vi.fn().mockResolvedValue({ session_id: 's1' })

    await ensureCompanionSession(createCompanionSessionState(), { create })

    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0][0]).toMatchObject({ source: COMPANION_SOURCE })
  })

  it('kimligi hatirliyor -- ikinci cagri yeni oturum ACMIYOR', async () => {
    const create = vi.fn().mockResolvedValue({ session_id: 's1' })
    const state = createCompanionSessionState()

    await ensureCompanionSession(state, { create })
    const second = await ensureCompanionSession(state, { create })

    expect(create).toHaveBeenCalledOnce()
    expect(second).toBe('s1')
  })

  it('ayni anda gelen iki cagri TEK oturum aciyor', async () => {
    // ``session.create`` saniyeler surebiliyor (sunucuda ajan + MCP kurulumu)
    // ve kullanici o sirada konusmaya baslarsa ikinci cagri gelir. Iki oturum
    // acmak, ikinci cumlenin birincinin baglamini gormemesi demekti.
    let release: (value: { session_id: string }) => void = () => undefined

    const create = vi.fn().mockReturnValue(
      new Promise<{ session_id: string }>(resolve => {
        release = resolve
      })
    )

    const state = createCompanionSessionState()

    const first = ensureCompanionSession(state, { create })
    const second = ensureCompanionSession(state, { create })

    release({ session_id: 's1' })

    expect(await first).toBe('s1')
    expect(await second).toBe('s1')
    expect(create).toHaveBeenCalledOnce()
  })

  it('acilamazsa null donuyor, PATLAMIYOR', async () => {
    // Sesli sohbetin HIC calismamasi, kisitlanmamis calismasindan daha kotu
    // bir sonuc: cagiran taraf eski davranisa dusuyor.
    const create = vi.fn().mockRejectedValue(new Error('gateway down'))

    const result = await ensureCompanionSession(createCompanionSessionState(), { create })

    expect(result).toBeNull()
  })

  it('basarisizliktan sonra yeniden denenebiliyor', async () => {
    const state = createCompanionSessionState()
    const failing = vi.fn().mockRejectedValue(new Error('down'))

    await ensureCompanionSession(state, { create: failing })

    const working = vi.fn().mockResolvedValue({ session_id: 's2' })

    expect(await ensureCompanionSession(state, { create: working })).toBe('s2')
  })

  it('kimlik donmezse null', async () => {
    const create = vi.fn().mockResolvedValue({})

    expect(await ensureCompanionSession(createCompanionSessionState(), { create })).toBeNull()
  })

  it('unutulunca yeniden aciliyor', async () => {
    const create = vi.fn().mockResolvedValue({ session_id: 's1' })
    const state = createCompanionSessionState()

    await ensureCompanionSession(state, { create })
    forgetCompanionSession(state)
    await ensureCompanionSession(state, { create })

    expect(create).toHaveBeenCalledTimes(2)
  })
})
