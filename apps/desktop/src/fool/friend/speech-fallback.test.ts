/**
 * "Duyuyor, yazıyor, ama konuşmuyor" hatasının testi.
 *
 * Friend paneli ekranda TALKING yazıyordu ve hiçbir ses çıkmıyordu.
 * Sebep: ``startSpeechStream`` akış kuramazsa ya da hiç ses üretmeden
 * kapanırsa ``done`` sözü ``'fallback'`` ile çözülüyor ve ÇAĞIRAN tarafın
 * metni ``playSpeechText`` ile kendisi seslendirmesi gerekiyor. Notch bunu
 * yapıyordu, Friend'e koymayı atlamıştım.
 *
 * Sessiz başarısızlığın ders kitabı hali: her katman "başarılı" dönüyor,
 * kullanıcı hiçbir şey duymuyor.
 *
 * Bu testler kaynak metni okuyor. Ölçtüğümüz şey davranış değil SÖZLEŞMEYE
 * UYULDUĞU: iki yüzey de aynı geri düşüşü kurmak zorunda ve biri unutursa
 * sessizce susuyor.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const FRIEND = readFileSync(join(ROOT, 'friend', 'use-friend-voice.ts'), 'utf8')
const NOTCH = readFileSync(join(ROOT, 'notch', 'use-notch-voice.ts'), 'utf8')

describe('seslendirme geri dusus sozlesmesi', () => {
  it('Friend akis KURULAMAZSA metni yine seslendiriyor', () => {
    expect(FRIEND).toContain('if (!session)')
    expect(FRIEND).toContain('playSpeechText')
  })

  it('Friend akis SES URETMEDEN kapanirsa metni seslendiriyor', () => {
    // ``done`` -> 'fallback' = hic ses cikmadi; cagiran konusmali.
    expect(FRIEND).toContain("outcome === 'fallback'")
  })

  it('notch ile Friend AYNI geri dususe sahip', () => {
    // Biri unutursa o yuzey sessizce susuyor -- olculdu.
    for (const source of [FRIEND, NOTCH]) {
      expect(source).toContain("outcome === 'fallback'")
      expect(source).toContain('playSpeechText')
    }
  })

  it('geri dusus AYNI metni konusuyor, yenisini degil', () => {
    // Akis sirasinda metin buyumeye devam ediyor; geri dusus o ANDAKI
    // metni konusmali, yoksa yarim cumle duyulur.
    expect(FRIEND).toContain('const spoken = pending')
    expect(FRIEND).toContain('spoken.text')
  })
})

describe('bas-konus', () => {
  it('bas-konusta sessizlik saptayicisi VERILMIYOR', () => {
    // Saptayici kullanici hala basili tutarken kaydi kapatirdi --
    // cumlenin ortasinda kesilen bir kayit.
    const hold = FRIEND.slice(FRIEND.indexOf('const beginHold'), FRIEND.indexOf('const endHold'))

    expect(hold).toContain('mic.start()')
    expect(hold).not.toContain('HANDS_FREE_VAD')
  })

  it('eller serbest kipte saptayici VERILIYOR', () => {
    const listen = FRIEND.slice(FRIEND.indexOf('const listen ='), FRIEND.indexOf('listenRef.current = listen'))

    expect(listen).toContain('HANDS_FREE_VAD')
    expect(listen).toContain('onSilence')
  })

  it('birakma kaydi GONDERIYOR', () => {
    const hold = FRIEND.slice(FRIEND.indexOf('const endHold'))

    expect(hold.slice(0, 600)).toContain('mic.stop()')
    expect(hold.slice(0, 600)).toContain('submitAudio')
  })
})
