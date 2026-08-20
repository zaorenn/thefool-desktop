/**
 * Oturum seçicinin davranışı.
 *
 * Sınanan asıl şey görünüm değil: seçilen oturumun KAPSAMI kipi belirliyor.
 * Araçlı bir oturumu "Friend" diye göstermek, kullanıcıya makineye
 * dokunamayacağını söylemek olurdu.
 */

import { describe, expect, it } from 'vitest'

import {
  modeForSession,
  resumableSessions,
  sessionLabel,
  type SessionSummary,
  touchesMachine
} from './session-picker'

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: '20260820_012426_d59623',
    message_count: 6,
    preview: '',
    source: 'friend',
    started_at: 0,
    title: '',
    ...overrides
  }
}

describe('modeForSession', () => {
  it('aracsiz kaynaklar arkadas kipi', () => {
    expect(modeForSession(session({ source: 'friend' }))).toBe('friend')
    expect(modeForSession(session({ source: 'companion' }))).toBe('friend')
  })

  /**
   * YON onemli: araçlı bir oturumu arkadaş sanmak, kullanıcıya makineye
   * dokunamayacağını söylemek olur. Tanımadığımız kaynak da Jarvis.
   */
  it('aracli ve TANINMAYAN kaynaklar Jarvis', () => {
    for (const source of ['desktop', 'cli', 'tui', 'bilinmeyen', '']) {
      expect(modeForSession(session({ source })), source).toBe('jarvis')
    }
  })

  it('bosluk ve buyuk harf yaniltmiyor', () => {
    expect(modeForSession(session({ source: '  FRIEND ' }))).toBe('friend')
  })

  it('makineye dokunma kip ile AYNI cevabi veriyor', () => {
    expect(touchesMachine(session({ source: 'desktop' }))).toBe(true)
    expect(touchesMachine(session({ source: 'friend' }))).toBe(false)
  })
})

describe('sessionLabel', () => {
  it('baslik varsa onu kullaniyor', () => {
    expect(sessionLabel(session({ title: 'Kahve sohbeti' }))).toBe('Kahve sohbeti')
  })

  it('baslik yoksa onizlemeye dusuyor', () => {
    expect(sessionLabel(session({ preview: 'hava nasil' }))).toBe('hava nasil')
  })

  it('uzun onizlemeyi kisaltiyor', () => {
    const label = sessionLabel(session({ preview: 'a'.repeat(200) }))

    expect(label.length).toBeLessThanOrEqual(60)
    expect(label.endsWith('…')).toBe(true)
  })

  it('cok satirli onizleme TEK satira iniyor', () => {
    expect(sessionLabel(session({ preview: 'ilk\n\n  ikinci' }))).toBe('ilk ikinci')
  })

  /** Bos bir satir, kullanicinin hangi sohbeti sectigini bilememesi demek. */
  it('hicbiri yoksa kimlige dusuyor -- ASLA bos degil', () => {
    expect(sessionLabel(session({ preview: '   ', title: '' }))).toBe('20260820_012426_d59623')
  })
})

describe('resumableSessions', () => {
  /**
   * Kullanıcının deposunda SIFIR mesajlı iki Friend oturumu vardı: açılmış,
   * hiç cevap alınmamış. Bunları "devam ettir" diye sunmak boş bir sohbet
   * sunmak olurdu.
   */
  it('bos oturumlari eliyor', () => {
    const list = resumableSessions([
      session({ id: 'a', message_count: 0 }),
      session({ id: 'b', message_count: 6 })
    ])

    expect(list.map(item => item.id)).toEqual(['b'])
  })

  it('sunucunun SIRASINI korumuyor degil -- oldugu gibi birakiyor', () => {
    const list = resumableSessions([
      session({ id: 'once', message_count: 1 }),
      session({ id: 'sonra', message_count: 9 })
    ])

    expect(list.map(item => item.id)).toEqual(['once', 'sonra'])
  })

  it('listeyi sinirliyor', () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      session({ id: `s${index}`, message_count: 3 })
    )

    expect(resumableSessions(many).length).toBe(12)
    expect(resumableSessions(many, 3).length).toBe(3)
  })

  it('bos giris bos cikis', () => {
    expect(resumableSessions([])).toEqual([])
  })
})
