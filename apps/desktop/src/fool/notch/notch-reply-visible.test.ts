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
    // Onkosul. Bu koparsa asagidaki cizim testlerinin dayanagi kalmaz.
    expect(HOOK).toContain('reply: string')
    expect(HOOK).toContain('setReply')
  })

  it('cevap KONUSULDUKCA guncelleniyor', () => {
    // Tur bitince tek seferde yazmak, uzun bir cevabin tamamlanmasini
    // beklemek demekti -- kullanici konusma surerken ekranda hicbir sey
    // gormezdi.
    //
    // Artik CUMLE bazinda da degil, cumlenin DUYULMUS kismi kadar: kullanici
    // "alt yazi gecer gibi ... parca parca gozukmeli" dedi ve oran sesin
    // kendi saatinden geliyor (bkz. ``subtitle.ts``).
    expect(HOOK).toContain('onSentenceProgress: (sentence, ratio) =>')
    expect(HOOK).toContain('setReply(spokenSubtitle(sentence, ratio))')
  })

  it('TEK satir cizilyor, ikisi birden DEGIL', () => {
    // Istenen sira birebir su: konusma bitince gonderilen metin; model cevap
    // vermeye baslayinca onun cevabi; bitince kullanici yeni bir sey soyleyene
    // kadar oyle kalmasi.
    //
    // Once ikisi AYNI ANDA ciziliyordu ve centik iki satirlik bir kayit
    // defterine donuyordu.
    expect(SHELL).toContain('voice.reply || voice.transcript')
    // Ayri ayri cizen eski hali geri gelirse burasi duser.
    expect(SHELL).not.toContain('{voice.transcript}')
  })

  it('CEVAP varsa cevap kazaniyor', () => {
    // ``reply`` yeni turda temizleniyor, yani sira kendiliginden dogru
    // isliyor: gonderilen metin gorunur, cevap akmaya baslayinca yerini alir.
    expect(HOOK).toContain("setReply('')")
    expect(SHELL).toContain('speaking={Boolean(voice.reply)}')
  })

  it('KONUSAN ayirt ediliyor', () => {
    // Ikisi de ayni renkte ve hizada olsaydi, kullanici kendi cumlesini
    // modelinkiyle karistirirdi.
    const text = SHELL.slice(SHELL.indexOf('function NotchText'))

    expect(text.slice(0, 900)).toContain('--ui-text-primary')
    expect(text.slice(0, 900)).toContain('--ui-text-secondary')
    expect(text.slice(0, 900)).toContain('text-left')
    expect(text.slice(0, 900)).toContain('text-center')
  })

  it('uzun cevap AKIYOR, kesilmiyor', () => {
    // ``line-clamp`` kesiyordu ve model konusurken metnin gerisi hic
    // gorunmuyordu. Centigin buyuyerek ekrani kaplamasi ise tam da kacinilan
    // sey -- ikisinin ortasi: serit sabit, metin icinde akiyor.
    const text = SHELL.slice(SHELL.indexOf('function NotchText'))

    expect(text.slice(0, 900)).toContain('overflow-y-auto')
    expect(text.slice(0, 900)).toMatch(/max-h-\d+/)
    // Dibe kaydirma: yeni gelen cumle gorunsun.
    expect(text.slice(0, 900)).toContain('scrollTop = ref.current.scrollHeight')
  })

  it('SOYLENECEK bir sey yokken satir cizilmiyor', () => {
    // Kosulsuz cizmek, her turun basinda bos bir seride yer acardi.
    expect(SHELL).toContain('{(voice.reply || (voice.transcript')
  })
})
