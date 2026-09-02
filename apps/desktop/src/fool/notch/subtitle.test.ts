/**
 * Çentikteki alt yazı: konuşulanın DUYULMUŞ kısmı.
 *
 * Kullanıcının isteği: "modelin söyledikleri eş zamanlı, alt yazı geçer gibi
 * ... parça parça gözükmeli, hem az yer kaplar hem de modelin neyi
 * seslendirdiği görülür."
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SUBTITLE_TAIL_WORDS, subtitleTail, subtitleUpTo } from './subtitle'

const read = (...parts: string[]) => readFileSync(join(__dirname, ...parts), 'utf8')

describe('duyulan kadari acilir', () => {
  it('oran 0 iken ILK kelime gorunur', () => {
    // ``floor`` ile cumlenin basinda bos bir serit kaliyordu; kullanici
    // konusma baslamis ama ekran bos gorurdu.
    expect(subtitleUpTo('bir iki uc dort', 0.01)).toBe('bir')
  })

  it('oran 1 iken cumlenin TAMAMI', () => {
    expect(subtitleUpTo('bir iki uc dort', 1)).toBe('bir iki uc dort')
  })

  it('ortada KELIME sinirinda kesiyor', () => {
    // Karakter karakter acmak "merhab" gibi yarim kelimeler uretirdi.
    const shown = subtitleUpTo('bir iki uc dort', 0.5)

    expect(shown).toBe('bir iki')
    expect(shown.endsWith(' ')).toBe(false)
  })

  it('sinirlarin disindaki oranlar KIRPILIYOR', () => {
    // Oran 0'a kirpiliyor ve 0'da hicbir kelime acilmiyor -- serit BOS.
    // Centik yeni cumleye gecerken tam da bunu kullaniyor: onceki cumle
    // ekranda asili kalmasin diye once ``0`` ile temizliyor.
    expect(subtitleUpTo('bir iki', -5)).toBe('')
    expect(subtitleUpTo('bir iki', 0)).toBe('')
    expect(subtitleUpTo('bir iki', 9)).toBe('bir iki')
  })

  it('bos cumle bos kaliyor', () => {
    expect(subtitleUpTo('   ', 0.5)).toBe('')
  })
})

describe('serit SABIT kaliyor', () => {
  it('kisa metin oldugu gibi', () => {
    expect(subtitleTail('bir iki uc')).toBe('bir iki uc')
  })

  it('uzun metnin KUYRUGU gosteriliyor', () => {
    const words = Array.from({ length: SUBTITLE_TAIL_WORDS + 10 }, (_, index) => `k${index}`)
    const tail = subtitleTail(words.join(' '))

    // Son kelime her zaman gorunur -- konusulan yer orasi.
    expect(tail.endsWith(`k${SUBTITLE_TAIL_WORDS + 9}`)).toBe(true)
    expect(tail.split(/\s+/).length).toBeLessThanOrEqual(SUBTITLE_TAIL_WORDS + 1)
  })

  it('kesildigini SOYLUYOR', () => {
    // Elips olmadan cumle ortasindan basliyormus gibi okunurdu.
    const words = Array.from({ length: SUBTITLE_TAIL_WORDS + 10 }, (_, index) => `k${index}`)

    expect(subtitleTail(words.join(' ')).startsWith('…')).toBe(true)
  })
})

describe('dikisler', () => {
  const HOOK = read('use-notch-voice.ts')
  const PLAYBACK = read('..', '..', 'lib', 'voice-playback.ts')

  it('oran SESIN saatinden geliyor', () => {
    // Bir zamanlayiciyla kelime saymak surüklenirdi: ses hizlanmiyor ama
    // cumleler arasina ag gecikmesi bosluk koyuyor ve tahmin oradan kayardi.
    expect(PLAYBACK).toContain('context.currentTime - active.startAt')
    expect(PLAYBACK).toContain('onSentenceProgress')
  })

  it('cumlenin sesi UZADIKCA bitis noktasi da uzuyor', () => {
    // Bir cumlenin sesi birden cok cerceveyle gelebiliyor; ilk parcanin
    // uzunlugunu cumlenin tamami saymak, alt yaziyi erken bitirirdi.
    expect(PLAYBACK).toContain('spoken.endsAt = startAt + buffer.duration')
  })

  it('akis bitince dongu BIRAKILIYOR', () => {
    // Donen bir kare dongusu hicbir sey gostermeden pil yakardi.
    expect(PLAYBACK).toContain('window.cancelAnimationFrame(progressFrame)')
  })

  it('centik alt yaziyi KULLANIYOR', () => {
    expect(HOOK).toContain('spokenSubtitle(sentence, ratio)')
    // Yeni cumle sifirdan aciliyor: onceki cumle ekranda asili kalmamali.
    expect(HOOK).toContain('spokenSubtitle(sentence, 0)')
  })
})
