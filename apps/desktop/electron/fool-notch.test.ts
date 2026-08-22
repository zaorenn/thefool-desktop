/**
 * Notch geometrisi ve URL sözleşmesinin testleri.
 *
 * ``hud-url.test.ts`` ile aynı gerekçe: bu sözleşmeler bozulana kadar görünmez.
 * Yanlış bir sorgu dizesi pencereyi sessizce ANA uygulama olarak açar — notch
 * yerine tam bir sohbet penceresi ekranın üstüne yapışır.
 */

import { describe, expect, it } from 'vitest'

import { buildNotchWindowUrl, NOTCH_WINDOW_HEIGHT, NOTCH_WINDOW_WIDTH, notchBounds } from './fool-notch'

describe('notchBounds', () => {
  it('ekranın üst kenarına yapışır', () => {
    // Havada asılı bir çentik, çentik değildir.
    const bounds = notchBounds({ height: 1080, width: 1920, x: 0, y: 0 })

    expect(bounds.y).toBe(0)
  })

  it('yatayda ortalar', () => {
    const bounds = notchBounds({ height: 1080, width: 1920, x: 0, y: 0 })

    expect(bounds.x).toBe(Math.round((1920 - NOTCH_WINDOW_WIDTH) / 2))
    expect(bounds.width).toBe(NOTCH_WINDOW_WIDTH)
    expect(bounds.height).toBe(NOTCH_WINDOW_HEIGHT)
  })

  it('ikinci ekranın kendi başlangıcına göre ortalar', () => {
    // Soldaki ekranın x'i negatif olabiliyor; mutlak koordinat kullanmak
    // notch'u yanlış monitöre koyardı.
    const bounds = notchBounds({ height: 1080, width: 1920, x: -1920, y: 0 })

    expect(bounds.x).toBe(Math.round(-1920 + (1920 - NOTCH_WINDOW_WIDTH) / 2))
  })

  it('dikey ofseti olan ekranın üstüne oturur', () => {
    const bounds = notchBounds({ height: 1440, width: 2560, x: 0, y: -1440 })

    expect(bounds.y).toBe(-1440)
  })
})

describe('buildNotchWindowUrl', () => {
  it("dev sunucuda ?win=notch'u '#' ÖNCESİNE koyar", () => {
    // Sorgu '#' sonrasına düşerse HashRouter onu rotanın parçası sanar ve
    // pencere kendini notch olarak tanımaz.
    const url = buildNotchWindowUrl({ devServer: 'http://127.0.0.1:5174' })

    expect(url).toBe('http://127.0.0.1:5174/?win=notch#/')
    expect(url.indexOf('win=notch')).toBeLessThan(url.indexOf('#'))
  })

  it('dev sunucunun sondaki eğik çizgisini iki katına çıkarmaz', () => {
    expect(buildNotchWindowUrl({ devServer: 'http://127.0.0.1:5174/' })).toBe('http://127.0.0.1:5174/?win=notch#/')
  })

  it('profili sorgu dizesinde taşır', () => {
    const url = buildNotchWindowUrl({ devServer: 'http://x', profile: 'iş' })

    expect(url).toContain(`profile=${encodeURIComponent('iş')}`)
    expect(url.indexOf('profile=')).toBeLessThan(url.indexOf('#'))
  })

  it('boş profil eklemez', () => {
    expect(buildNotchWindowUrl({ devServer: 'http://x', profile: '   ' })).toBe('http://x/?win=notch#/')
  })

  it('paketlenmiş yapıda file:// URL üretir', () => {
    const url = buildNotchWindowUrl({ rendererIndexPath: 'C:/app/dist/index.html' })

    expect(url.startsWith('file:///')).toBe(true)
    expect(url).toContain('?win=notch#/')
  })
})
