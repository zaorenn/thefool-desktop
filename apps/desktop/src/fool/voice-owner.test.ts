import { beforeEach, describe, expect, it } from 'vitest'

import { $voiceOwner, canSpeak, claimVoice, releaseVoice } from './voice-owner'

beforeEach(() => $voiceOwner.set(null))

describe('sahiplik', () => {
  it('bos alani ilk talep eden aliyor', () => {
    expect(claimVoice('composer')).toBe(true)
    expect($voiceOwner.get()).toBe('composer')
  })

  it('ayni yuzey tekrar talep edebiliyor', () => {
    claimVoice('friend')

    expect(claimVoice('friend')).toBe(true)
  })

  it('FRIEND composer\'i devraliyor', () => {
    // Kullanici Friend'i ACARAK konusmayi secti ve ekranda ona bakiyor.
    claimVoice('composer')

    expect(claimVoice('friend')).toBe(true)
    expect($voiceOwner.get()).toBe('friend')
  })

  it('composer FRIEND\'i devralmiyor', () => {
    // Iki yuzey birden konusursa her biri digerini iptal ediyor ve HIC ses
    // cikmiyor -- olculen hata tam bu.
    claimVoice('friend')

    expect(claimVoice('composer')).toBe(false)
    expect($voiceOwner.get()).toBe('friend')
  })

  it('notch composer ile friend arasinda', () => {
    claimVoice('composer')
    expect(claimVoice('notch')).toBe(true)

    expect(claimVoice('friend')).toBe(true)
    expect(claimVoice('notch')).toBe(false)
  })
})

describe('birakma', () => {
  it('sahip birakinca alan bosaliyor', () => {
    claimVoice('friend')
    releaseVoice('friend')

    expect($voiceOwner.get()).toBeNull()
  })

  it('sahip OLMAYAN birakamiyor', () => {
    // Yoksa kapanan bir panel, konusan baska bir yuzeyin sahipligini
    // silerdi.
    claimVoice('friend')
    releaseVoice('composer')

    expect($voiceOwner.get()).toBe('friend')
  })

  it('biraktiktan sonra dusuk oncelikli de alabiliyor', () => {
    claimVoice('friend')
    releaseVoice('friend')

    expect(claimVoice('composer')).toBe(true)
  })
})

describe('konusabilir mi', () => {
  it('sahip yoksa herkes konusabiliyor', () => {
    // Sahiplik seslendirmeyi engellemek icin degil, CAKISMAYI engellemek
    // icin var.
    for (const surface of ['composer', 'friend', 'notch'] as const) {
      expect(canSpeak(surface)).toBe(true)
    }
  })

  it('sahip olan konusabiliyor', () => {
    claimVoice('friend')

    expect(canSpeak('friend')).toBe(true)
  })

  it('sahip olmayan SESSIZ kaliyor', () => {
    claimVoice('friend')

    expect(canSpeak('composer')).toBe(false)
    expect(canSpeak('notch')).toBe(false)
  })
})

/**
 * HER seslendiren yüzey sahipliği sormalı.
 *
 * Ölçülen hata (kullanıcının günlüğü, 2026-08-21 18:15): aynı cümle İKİ KEZ
 * sentezleniyordu.
 *
 *   fool-speak-stream-nl_653jl.wav        Friend'in akış yolu
 *   cache/audio/tts_20260821_181550.wav   sohbet panelinin tek-seferlik yolu
 *
 * Sonucu bu dosyanın başlığında zaten yazıyordu: "Preparing audio sonsuza
 * kadar duruyor, hiç ses çıkmıyor ve iki sentez işi birden makineyi
 * kastırıyor." Mekanizma bunun için yazılmıştı; ``use-auto-speak-replies``
 * onu çağırmayı atlamıştı.
 *
 * Bu sınav kaynağı okuyor: yeni bir seslendiren yüzey eklenip kapıyı
 * sormazsa burada kırılır.
 */
describe('seslendiren HER yuzey sahiplik soruyor', () => {
  const SPEAKERS = [
    ['sohbet paneli otomatik okuma', '../app/chat/composer/hooks/use-auto-speak-replies.ts'],
    ['sohbet paneli sesli tur', '../app/chat/composer/hooks/use-voice-conversation.ts'],
    ['Friend penceresi', './friend/use-friend-voice.ts'],
    ['notch', './notch/use-notch-voice.ts']
  ] as const

  it('hepsi canSpeak ya da claimVoice cagiriyor', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')

    for (const [label, relative] of SPEAKERS) {
      const source = readFileSync(join(import.meta.dirname, relative), 'utf8')

      expect(
        /canSpeak\(|claimVoice\(/.test(source),
        `${label} ses sahipligini hic sormuyor -- ayni cevabi ikinci kez seslendirebilir`
      ).toBe(true)
    }
  })

  it('otomatik okuma OZELLIKLE canSpeak soruyor', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')

    const source = readFileSync(
      join(import.meta.dirname, '../app/chat/composer/hooks/use-auto-speak-replies.ts'),
      'utf8'
    )

    // Otomatik: kullanici bir sey tiklamiyor, yani sessizce cakisiyor.
    expect(source.includes("canSpeak('composer')")).toBe(true)
  })
})
