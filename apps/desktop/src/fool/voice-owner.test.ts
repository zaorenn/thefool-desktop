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
