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

describe('kip degisimi', () => {
  it('istenen kapsamla aciyor', async () => {
    const create = vi.fn().mockResolvedValue({ session_id: 's1' })

    await ensureCompanionSession(createCompanionSessionState(), {
      create,
      source: 'desktop'
    })

    expect(create.mock.calls[0][0]).toMatchObject({ source: 'desktop' })
  })

  it('kip degisince YENI oturum aciyor', async () => {
    // Kapsam ajan kurulurken dondu: arkadas oturumunda terminal yok, Jarvis
    // oturumunda kisit yok. Eskisini kullanmaya devam etmek, kullanicinin
    // sectigi kipi sessizce yok saymakti.
    const create = vi
      .fn()
      .mockResolvedValueOnce({ session_id: 'friend' })
      .mockResolvedValueOnce({ session_id: 'jarvis' })

    const state = createCompanionSessionState()

    await ensureCompanionSession(state, { create, source: 'companion' })
    const second = await ensureCompanionSession(state, { create, source: 'desktop' })

    expect(create).toHaveBeenCalledTimes(2)
    expect(second).toBe('jarvis')
  })

  it('ayni kipte oturumu YENIDEN kullaniyor', async () => {
    const create = vi.fn().mockResolvedValue({ session_id: 's1' })
    const state = createCompanionSessionState()

    await ensureCompanionSession(state, { create, source: 'desktop' })
    await ensureCompanionSession(state, { create, source: 'desktop' })

    expect(create).toHaveBeenCalledOnce()
  })

  it('kaynak verilmezse arkadas kapsami', async () => {
    const create = vi.fn().mockResolvedValue({ session_id: 's1' })

    await ensureCompanionSession(createCompanionSessionState(), { create })

    expect(create.mock.calls[0][0]).toMatchObject({ source: COMPANION_SOURCE })
  })
})

/**
 * SÜRDÜRME — ölçülen hatanın kendisi.
 *
 * Oturum kimliği ``useRef`` içindeydi ve ``stop()`` her çağrıldığında
 * siliniyordu; ``stop()`` ise mikrofonla ilgili HER şeyde çağrılıyor. Yani
 * sessize almak arkadaşın hafızasını siliyordu. Kullanıcının ``state.db``sinde
 * ölçüldü:
 *
 *     cli       33 oturum, ortalama 24,6 mesaj
 *     desktop    8 oturum, ortalama 28,3 mesaj
 *     friend    14 oturum, ortalama  4,6 mesaj   <- altı kat parçalı
 *
 * 14 Friend oturumunun 7'si tek turluk, 2'si SIFIR mesajlı.
 */
describe('oturum surdurme', () => {
  const store = (initial: Record<string, string> = {}) => {
    const data = { ...initial }

    return {
      data,
      read: (source: string) => data[source] ?? '',
      write: (source: string, id: string) => {
        if (id) {
          data[source] = id
        } else {
          delete data[source]
        }
      }
    }
  }

  it('SAKLANAN oturumu surduruyor -- yeni acmiyor', async () => {
    const shelf = store({ friend: 'oturum-1' })
    const create = vi.fn()

    const id = await ensureCompanionSession(createCompanionSessionState(), {
      create,
      resume: async () => true,
      source: 'friend',
      store: shelf
    })

    expect(id).toBe('oturum-1')
    expect(create).not.toHaveBeenCalled()
  })

  it('acilan oturumu SAKLIYOR', async () => {
    const shelf = store()

    await ensureCompanionSession(createCompanionSessionState(), {
      create: async () => ({ session_id: 'yeni-1' }),
      source: 'friend',
      store: shelf
    })

    expect(shelf.data.friend).toBe('yeni-1')
  })

  /**
   * ``state.db`` budanmış ya da uygulama verisi sıfırlanmış olabilir. Var
   * olmayan bir kimliğe göndermek, kullanıcının konuşup HİÇ cevap alamaması
   * olurdu -- deposunda sıfır mesajlı iki oturum tam olarak buna benziyor.
   */
  it('oturum ARTIK YOKSA kaydi birakip temiz bir tane aciyor', async () => {
    const shelf = store({ friend: 'olu-oturum' })
    const create = vi.fn(async () => ({ session_id: 'yeni-2' }))

    const id = await ensureCompanionSession(createCompanionSessionState(), {
      create,
      resume: async () => false,
      source: 'friend',
      store: shelf
    })

    expect(id).toBe('yeni-2')
    expect(create).toHaveBeenCalledTimes(1)
    expect(shelf.data.friend).toBe('yeni-2')
  })

  it('kapsamlar AYRI kimlik surduruyor', async () => {
    const shelf = store({ desktop: 'jarvis-1', friend: 'arkadas-1' })

    const asFriend = await ensureCompanionSession(createCompanionSessionState(), {
      create: async () => ({ session_id: 'olmamali' }),
      resume: async () => true,
      source: 'friend',
      store: shelf
    })

    const asJarvis = await ensureCompanionSession(createCompanionSessionState(), {
      create: async () => ({ session_id: 'olmamali' }),
      resume: async () => true,
      source: 'desktop',
      store: shelf
    })

    expect(asFriend).toBe('arkadas-1')
    expect(asJarvis).toBe('jarvis-1')
  })

  it('kip degisimi DIGER kapsamin kimligini SILMIYOR', async () => {
    const shelf = store({ friend: 'arkadas-1' })
    const state = createCompanionSessionState()

    await ensureCompanionSession(state, {
      create: async () => ({ session_id: 'x' }),
      resume: async () => true,
      source: 'friend',
      store: shelf
    })

    await ensureCompanionSession(state, {
      create: async () => ({ session_id: 'jarvis-yeni' }),
      resume: async () => true,
      source: 'desktop',
      store: shelf
    })

    // Jarvis'e gecmek arkadas sohbetini BITIRMEZ: geri donunce yerinde olmali.
    expect(shelf.data.friend).toBe('arkadas-1')
    expect(shelf.data.desktop).toBe('jarvis-yeni')
  })

  it('sohbeti bitirmek kaydi da siliyor', () => {
    const shelf = store({ friend: 'arkadas-1' })
    const state = createCompanionSessionState()

    state.id = 'arkadas-1'
    state.source = 'friend'

    forgetCompanionSession(state, shelf)

    expect(state.id).toBeNull()
    expect(shelf.data.friend).toBeUndefined()
  })

  it('depo YOKKEN eski davranis suruyor', async () => {
    const create = vi.fn(async () => ({ session_id: 'yeni-3' }))

    const id = await ensureCompanionSession(createCompanionSessionState(), {
      create,
      source: 'friend'
    })

    expect(id).toBe('yeni-3')
    expect(create).toHaveBeenCalledTimes(1)
  })
})

/**
 * Sürdürme İKİNCİ bir modeli yüklememeli.
 *
 * Oturumlar modele sabitleniyor (``sessions.model``). Kullanıcının deposunda
 * ölçüldü: 9 Friend oturumu ``qwen/qwen3.5-9b``, 7'si ``google/gemma-4-e4b``.
 * Eski bir oturumu sürdürmek onun modelini de geri getiriyor ve LM Studio
 * ikinci modeli yüklüyor -- aynı 16 GB kartta, seslendirme motorlarının
 * yanında. Kullanıcı bunu "arkada qwen yüklenmiş ama çağırmadım" diye
 * bildirdi; kalıcılığı ben eklediğim için regresyon da benimdi.
 */
describe('surdurme modeli DEGISTIRMIYOR', () => {
  it('AYNI modelin oturumu surduruluyor', async () => {
    const { friendSessionStoreFor, writeFriendSession } = await import('../friend/friend-session')

    writeFriendSession('friend', 'oturum-1', 'gemma')

    expect(friendSessionStoreFor('gemma').read('friend')).toBe('oturum-1')
  })

  it('BASKA modelin oturumu surdurulmuyor', async () => {
    const { friendSessionStoreFor, writeFriendSession } = await import('../friend/friend-session')

    writeFriendSession('friend', 'oturum-qwen', 'qwen')

    expect(friendSessionStoreFor('gemma').read('friend')).toBe('')
  })

  /** Ayırıcısı olmayan ESKİ kayıtların modeli bilinmiyor -- sürdürülemez. */
  it('modeli BILINMEYEN eski kayit surdurulmuyor', async () => {
    const { $friendSessions, friendSessionStoreFor } = await import('../friend/friend-session')

    $friendSessions.set({ friend: 'eski-kimlik-ayiricisiz' })

    expect(friendSessionStoreFor('gemma').read('friend')).toBe('')
  })

  it('model sorulmazsa kayit oldugu gibi okunuyor', async () => {
    const { readFriendSession, writeFriendSession } = await import('../friend/friend-session')

    writeFriendSession('friend', 'oturum-2', 'qwen')

    expect(readFriendSession('friend')).toBe('oturum-2')
  })
})
