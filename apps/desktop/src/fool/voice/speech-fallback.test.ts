/**
 * Akış kurulamazsa metin YİNE seslendirilmeli.
 *
 * Ölçülen hata: bu geri düşüş bir yüzeyde vardı, diğerinde yoktu ve sonucu
 * "duyuyor, yazıyor, ama konuşmuyor" oldu -- panel TALKING yazarken hiçbir
 * ses çıkmıyordu. Sessiz başarısızlığın ders kitabı hâli.
 *
 * Friend penceresi kaldırıldı (kullanıcının kararı); geriye tek sesli yüzey
 * olarak notch kaldı, sözleşme onun üstünde duruyor.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const NOTCH = readFileSync(
  join(import.meta.dirname, '..', 'notch', 'use-notch-voice.ts'),
  'utf8'
)

describe('seslendirme geri dusus sozlesmesi', () => {
  it('akis KURULAMAZSA metni yine seslendiriyor', () => {
    expect(NOTCH).toContain('playSpeechText')
  })

  it('akis SES URETMEDEN kapanirsa metni seslendiriyor', () => {
    // ``done`` -> 'fallback' = hic ses cikmadi; cagiran konusmali.
    expect(NOTCH).toContain("outcome === 'fallback'")
  })

  it('once AKIS deneniyor -- tek seferlik yol geri dusus', () => {
    const streamAt = NOTCH.indexOf('startSpeechStream')
    const fallbackAt = NOTCH.indexOf("outcome === 'fallback'")

    expect(streamAt).toBeGreaterThan(-1)
    expect(fallbackAt).toBeGreaterThan(streamAt)
  })
})
