/**
 * Bir cevabı YALNIZCA bir yüzey seslendirir -- pencereler arası dahil.
 *
 * Ölçülen hata
 * ------------
 * Çentik ayrı bir ``BrowserWindow``. Sahiplik hakemi (``fool/voice-owner.ts``)
 * düz bir ``atom`` üzerinde duruyordu, yani ``claimVoice('notch')`` yalnızca
 * çentiğin kendi kopyasına yazıyor ve ana penceredeki ``canSpeak('composer')``
 * her zaman ``true`` dönüyordu. İki yüzey de aynı ``$messages`` tikinde
 * uyanıyor, ikisi de konuşuyordu: kullanıcı aynı cümleyi İKİ KEZ duyuyordu.
 *
 * Ana süreçte çözülen, yarışsız bir hakem ZATEN vardı
 * (``store/ambient.ts::ownsAmbientCue`` -> ``electron/event-dedupe.ts``).
 * Besteci onu kullanıyordu; eksik olan çentiğin katılmasıydı.
 *
 * Sınav KAYNAĞI okuyor: davranışı taklit etmek, kancanın gerçekte hangi yolu
 * çağırdığını değil taklidin ne yaptığını sınamak olurdu.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const NOTCH = readFileSync(join(import.meta.dirname, 'use-notch-voice.ts'), 'utf8')

const COMPOSER = readFileSync(
  join(import.meta.dirname, '../../app/chat/composer/hooks/use-auto-speak-replies.ts'),
  'utf8'
)

describe('centik ANA SUREC hakemine katiliyor', () => {
  it('akisi acmadan once talep ediyor', () => {
    expect(NOTCH.includes('ownsAmbientCue')).toBe(true)
    // Talep, akisin ACILMASINDAN once gelmeli -- sonra gelseydi iki sentez
    // birden baslar, biri iptal edilirdi.
    expect(NOTCH.indexOf('ownsAmbientCue')).toBeLessThan(NOTCH.indexOf('startSpeechStream('))
  })

  it('besteci ile AYNI anahtar uzayini kullaniyor', () => {
    // Ayri anahtar yazmak, iki yuzeyin birbirini hic gormemesi olurdu.
    expect(/ownsAmbientCue\(`speak:\$\{/.test(NOTCH)).toBe(true)
    expect(/ownsAmbientCue\(`speak:\$\{/.test(COMPOSER)).toBe(true)
  })

  it('talep reddedilirse akis HIC acilmiyor', () => {
    expect(/if \(!owns\) \{[\s\S]{0,400}?return null/.test(NOTCH)).toBe(true)
  })

  it('reddedilen cevap icin tekrar tekrar talep etmiyor', () => {
    // Reddedilince ``streamRef`` bosaliyor; muhafiz olmasa efekt her token'da
    // ayni yolu bastan denerdi.
    expect(NOTCH.includes('declinedRef')).toBe(true)
    expect(NOTCH.includes('declinedRef.current.has(pending.id)')).toBe(true)
  })

  it('mesaj kimligi VERILIYOR', () => {
    // ``claimSpeech(undefined)`` her zaman ``true`` doner: kimlik verilmeden
    // pencere ICI tekillestirme de baypas ediliyordu.
    expect(NOTCH.includes('messageId: claimId')).toBe(true)
  })
})

describe('sahiplik hakemi kendi KAPSAMINI dogru anlatiyor', () => {
  const OWNER = readFileSync(join(import.meta.dirname, '../voice-owner.ts'), 'utf8')

  it('pencereler arasi guvenceyi USTLENMIYOR', () => {
    // Dosya bir zamanlar tasiyamadigi seyi vaat ediyordu.
    expect(OWNER.includes('ownsAmbientCue')).toBe(true)
    expect(OWNER.includes('PENCEREYE ÖZEL')).toBe(true)
  })

  it('olu friend katmani KALKTI', () => {
    // Friend penceresi kaldirildi; geride centikten YUKSEK oncelikli, hic
    // talep edilmeyen bir katman kalmisti.
    expect(OWNER.includes("'friend'")).toBe(false)
    expect(OWNER.includes('friend: 3')).toBe(false)
  })
})
