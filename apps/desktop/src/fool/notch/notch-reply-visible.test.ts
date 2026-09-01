/**
 * Çentik modelin CEVABINI da yazmalı.
 *
 * Ölçülen boşluk: ``use-notch-voice`` ``reply``i baştan beri tutuyordu, arayüze
 * veriyordu (``NotchVoice.reply``) ve model konuştukça cümle cümle
 * güncelliyordu (``onSentence: sentence => setReply(sentence)``). Ama
 * ``notch-shell.tsx`` onu HİÇ çizmiyordu: çentik senin ne dediğini gösterip
 * modelin ne cevapladığını hiç göstermiyordu.
 *
 * Sessiz değil, KULLANILAMAZ bir boşluk. Ses kaçtığı anda (gürültü, kulaklık
 * çıkmış, ses kapalı, hoparlör başka cihazda) turdan geriye hiçbir şey
 * kalmıyor -- kullanıcı modelin cevap verip vermediğini bile bilemiyor. Bir
 * sesli arayüzün metni, duyulmayan her cevabın tek kaydıdır.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(join(__dirname, name), 'utf8')

const SHELL = read('notch-shell.tsx')
const HOOK = read('use-notch-voice.ts')

describe('centik modelin cevabini gosteriyor', () => {
  it('kanca cevabi TUTUYOR ve disari veriyor', () => {
    // Onkosul. Bu koparsa asagidaki cizim testinin dayanagi kalmaz.
    expect(HOOK).toContain('reply: string')
    expect(HOOK).toContain('setReply')
  })

  it('cevap KONUSULDUKCA guncelleniyor', () => {
    // Tur bitince tek seferde yazmak, uzun bir cevabin tamamlanmasini
    // beklemek demekti -- kullanici konusma surerken ekranda hicbir sey
    // gormezdi.
    expect(HOOK).toContain('onSentence: sentence => setReply(sentence)')
  })

  it('arayuz cevabi CIZIYOR', () => {
    // Regresyonun kendisi: burasi eskiden hicbir yerde ``voice.reply``
    // gecmiyordu.
    expect(SHELL).toContain('{voice.reply}')
  })

  it('KONUSAN ayirt ediliyor', () => {
    // Ikisi de ayni renkte ve ayni hizada olsaydi, iki satir tek bir paragraf
    // gibi okunur ve kullanici kendi cumlesini modelinkiyle karistirirdi.
    const transcript = SHELL.slice(SHELL.indexOf('{voice.transcript}') - 400, SHELL.indexOf('{voice.transcript}'))
    const reply = SHELL.slice(SHELL.indexOf('{voice.reply}') - 300, SHELL.indexOf('{voice.reply}'))

    expect(transcript).toContain('--ui-text-secondary')
    expect(reply).toContain('--ui-text-primary')
    expect(transcript).toContain('text-center')
    expect(reply).toContain('text-left')
  })

  it('cevap centigi BUYUTMUYOR', () => {
    // Centik bir pencere degil, bir serit. Sinirsiz metin onu ekrani kaplayan
    // bir panele cevirirdi -- tam da kacinilan sey. Uzun cevaplar zaten sesli
    // geliyor ve tamami ana pencerede.
    const reply = SHELL.slice(SHELL.indexOf('{voice.reply}') - 300, SHELL.indexOf('{voice.reply}'))

    expect(reply).toMatch(/line-clamp-\d/)
  })

  it('cevap YOKKEN bos satir cizilmiyor', () => {
    // Kosulsuz cizmek, her turun basinda bos bir seride yer acardi.
    expect(SHELL).toContain('{voice.reply && (')
  })
})
