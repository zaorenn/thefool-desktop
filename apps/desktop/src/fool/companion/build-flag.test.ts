/**
 * Eşlik kipi yayınlanan pakete GİRMEMELİ.
 *
 * İstenen: "kurulumda ya da publish sürümlerinde asla olmamalı, bu kısım
 * sadece bu bilgisayara özel kalmalı."
 *
 * Çalışma zamanı kapısı yetmiyordu: kapalı bir şey açılabilir. Karar derleme
 * zamanında veriliyor ve buradaki testler takasın yerinde durduğunu tutuyor --
 * ``vite.config.ts``ten bir satır silinirse özellik sessizce pakete geri girer.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { COMPANION_BUILD } from './build-flag'
import { COMPANION_BUILD as PUBLISHED } from './build-flag.noop'

const VITE_CONFIG = readFileSync(join(__dirname, '..', '..', '..', 'vite.config.ts'), 'utf8')

describe('eslik kipi yapi bayragi', () => {
  it('yerel calistirmada ACIK', () => {
    expect(COMPANION_BUILD).toBe(true)
  })

  it('yayinlanan yapida KAPALI', () => {
    expect(PUBLISHED).toBe(false)
  })

  it('takas MODUL duzeyinde, bayrak duzeyinde DEGIL', () => {
    // Olculen hata: yalnizca sabit takas edilince bilesenin govdesi pakette
    // kaliyordu -- ozellik calismiyor ama metinleri (``Not met yet``,
    // ``thing unresolved``) paketin icinde aranabiliyordu. "Calismiyor" ile
    // "yok" ayni sey degil.
    expect(VITE_CONFIG).toContain("'@/fool/relationship-bar': companionModule(")
    expect(VITE_CONFIG).toContain("'@/fool/use-persona-greeting': companionModule(")
  })

  it('takas yalnizca gelistirmede ve ACIKCA istendiginde gercek dosyayi veriyor', () => {
    // ``command === 'serve'`` gelistirme; ``VITE_COMPANION=1`` bilerek istenen
    // yapi. Baska hicbir yol eslik kipini pakete sokmamali.
    expect(VITE_CONFIG).toContain("command === 'serve' || env.VITE_COMPANION === '1'")
    expect(VITE_CONFIG).toContain(".noop'")
  })

  it('iki dosya AYNI adi disa aciyor', () => {
    // Ad ayrisirsa takas sessizce ``undefined`` verir ve ozellik her yapida
    // kapali kalir -- yanlis yone dusen ama fark edilmeyen bir hata.
    const real = readFileSync(join(__dirname, 'build-flag.ts'), 'utf8')
    const noop = readFileSync(join(__dirname, 'build-flag.noop.ts'), 'utf8')

    expect(real).toContain('export const COMPANION_BUILD')
    expect(noop).toContain('export const COMPANION_BUILD')
  })
})
