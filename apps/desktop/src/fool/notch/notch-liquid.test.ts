/**
 * Çentiğin sıvı açılışı/kapanışı ve üst kenar dalgaları.
 *
 * Kullanıcının tarifi:
 *
 *   "notch açılırken o top sıvı bir animasyonmuş gibi ekranın ortasına gelsin,
 *    sonra sanki yerçekimi onu yukarı çekiyormuş gibi çeksin ve sanki su
 *    sıçraması gibi notchu oluştursun, sonra kaybolsun o kırmızı top."
 *
 *   "notch kapanırken top notchu sıvı gibi dönerek içine çeksin ve ekranın
 *    üstünden yukarı çekerek kaybolsun."
 *
 *   "notch dinlerken ... notchtan çıkan dalgalar ... konuşma algılandığında
 *    dalgalar tekrardan notcha geri çekilsin."
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { LIQUID_CLOSE_MS, LIQUID_OPEN_MS } from './notch-liquid'

const read = (name: string) => readFileSync(join(__dirname, name), 'utf8')

const LIQUID = read('notch-liquid.tsx')
const SHELL = read('notch-shell.tsx')

describe('surekli duran top KALDIRILDI', () => {
  it('top artik bir DURUM gostergesi degil', () => {
    // Kullanicinin bildirdigi: "notchun hemen altinda surekli duran o yuvarlak
    // top cok dikkat dagitici."
    expect(SHELL).not.toContain('<NotchPet')
    expect(SHELL).toContain('<NotchLiquid phase={liquidPhase} />')
  })

  it('bosta HICBIR SEY cizilmiyor', () => {
    expect(LIQUID).toContain("if (phase === 'idle') {")
    expect(LIQUID).toContain('return null')
  })
})

describe('acilis: dus, yukari cekil, sicra', () => {
  it('once ASAGI iniyor', () => {
    // Ekranin ortasina dogru: pozitif ``translate3d`` y.
    expect(LIQUID).toContain('translate3d(0, 96px, 0)')
  })

  it('sonra YUKARI cekiliyor', () => {
    // Yercekimi tersine: y kuculerek sifira gidiyor.
    expect(LIQUID).toContain('translate3d(0, 22px, 0)')
    expect(LIQUID).toContain('translate3d(0, -2px, 0)')
  })

  it('SICRAMA ile bitiyor', () => {
    // Yatayda yayilip dikeyde eziliyor -- su sicramasi.
    expect(LIQUID).toContain('scale(1.9, 0.46)')
    expect(LIQUID).toContain('scale(2.6, 0.2)')
  })

  it('ve KAYBOLUYOR', () => {
    const open = LIQUID.slice(LIQUID.indexOf('@keyframes fool-liquid-open'))

    expect(open.slice(0, open.indexOf('}\n\n'))).toContain('opacity: 0;')
  })
})

describe('kapanis: donerek ic, yukari kaybol', () => {
  it('DONEREK topluyor', () => {
    expect(LIQUID).toContain('rotate(120deg)')
  })

  it('ust kenardan YUKARI kayboluyor', () => {
    expect(LIQUID).toContain('translate3d(0, -80px, 0)')
  })
})

describe('gecis KENDILIGINDEN sonuyor', () => {
  it('sureler tanimli ve makul', () => {
    // Sonmezse top ekranda asili kalirdi -- kaldirilan davranisin ta kendisi.
    expect(LIQUID_OPEN_MS).toBeGreaterThan(300)
    expect(LIQUID_OPEN_MS).toBeLessThan(1_500)
    expect(LIQUID_CLOSE_MS).toBeGreaterThan(200)
    expect(LIQUID_CLOSE_MS).toBeLessThan(1_500)
  })

  it('sure dolunca ``idle``a donuyor', () => {
    expect(LIQUID).toContain("setPhase('idle')")
  })
})

describe('ust kenar dalgalari', () => {
  it('yalnizca DINLERKEN cikiyor', () => {
    expect(SHELL).toContain("voice.status === 'listening' && !voice.heardSpeech")
  })

  it('konusma algilaninca GERI CEKILIYOR', () => {
    // Kullanicinin istedigi: "konusma algilandiginda dalgalar tekrardan notcha
    // geri cekilsin."
    expect(LIQUID).toContain("transform: active ? undefined : 'scaleX(0)'")
    expect(LIQUID).toContain('transition: active')
  })

  it('INCE: bir piksel yuksekliginde', () => {
    // "ince dalgalar" -- kalin bir serit ekranin tepesini kapatirdi.
    expect(LIQUID).toContain('h-px')
  })

  it('CENTIKTEN cikiyor: ortadan disa dogru', () => {
    expect(LIQUID).toContain('scaleX(0.04)')
    expect(LIQUID).toContain('scaleX(1)')
  })
})

describe('genisleme YALNIZCA alt yaziyla', () => {
  it('dinlerken KUCUK kaliyor', () => {
    // Kullanicinin karari: "listening sirasinda notch bu ufak halde kalmali
    // ... sadece alt yazidan alt yaziya genislemeli." Dinlerken genis serit
    // acmak ekranin tepesini bos yere kapatiyordu.
    expect(SHELL).toContain('height: subtitleMode ? SUBTITLE_HEIGHT : COLLAPSED_HEIGHT')
    expect(SHELL).toContain('width: subtitleMode ? subtitleWidth : COLLAPSED_WIDTH')
  })

  it('ETKINKEN mikrofon simgesi YOK', () => {
    // "mikrofon butonu gitmeli" -- geriye seviyeye gore nefes alan tek bir
    // canli nokta kaliyor.
    expect(SHELL).toContain('{!expanded && <Mic')
  })

  it('kalin orta hal KALDIRILDI', () => {
    // 22 piksellik bir kutuya sigmayan dalga formu + durum + dugme yigini.
    expect(SHELL).not.toContain('<Waveform')
    expect(SHELL).not.toContain('<NotchText')
  })
})
