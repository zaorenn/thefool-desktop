/**
 * Paylaşılan atomlar BAŞKA pencerenin yazdığını benimsiyor mu?
 *
 * Bu testler var çünkü hata sessizdi: değer diske yazılıyordu, ikinci pencere
 * yazmayı hiç duymuyordu ve her iki taraftaki yorum da duyduğunu söylüyordu.
 * Ölçülen hâli: depo ``KeyQ``, notch penceresindeki atom ``ControlRight``.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

/** Başka bir pencere bu anahtarı yazdı: tarayıcının BİZE yolladığı olay. */
function writeFromAnotherWindow(key: string, newValue: null | string): void {
  if (newValue === null) {
    window.localStorage.removeItem(key)
  } else {
    window.localStorage.setItem(key, newValue)
  }

  window.dispatchEvent(new StorageEvent('storage', { key, newValue, storageArea: window.localStorage }))
}

describe('pencereler arasi paylasilan atom', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('bas-konus baglamasi diger pencereden geliyor', async () => {
    const { $pttCode } = await import('./notch/ptt-store')

    writeFromAnotherWindow('fool.desktop.notch.pushToTalkCode', 'KeyQ')

    expect($pttCode.get()).toBe('KeyQ')
  })

  it('dinleme kipi diger pencereden geliyor', async () => {
    const { $listenMode } = await import('./notch/listen-mode')

    writeFromAnotherWindow('fool.desktop.voice.listen-mode', 'push-to-talk')

    expect($listenMode.get()).toBe('push-to-talk')
  })

  it('anahtar SILINDIYSE varsayilana donuyor', async () => {
    const { $pttCode } = await import('./notch/ptt-store')

    $pttCode.set('KeyQ')
    writeFromAnotherWindow('fool.desktop.notch.pushToTalkCode', null)

    expect($pttCode.get()).toBe('ControlRight')
  })

  it('ILGISIZ anahtar atomu kimildatmiyor', async () => {
    const { $pttCode } = await import('./notch/ptt-store')

    $pttCode.set('KeyQ')
    writeFromAnotherWindow('bambaska.bir.anahtar', 'KeyZ')

    expect($pttCode.get()).toBe('KeyQ')
  })
})

/**
 * Asıl koruma: notch penceresinden OKUNAN her kalıcı fool atomu paylaşılmalı.
 *
 * Yukarıdaki testler üç atomu tek tek sınıyor. Dördüncüsü eklenip
 * ``persistentAtom`` ile yazılırsa hiçbiri kırılmaz -- ilk hata da böyle
 * girmişti. Bu test kaynağı okuyor.
 */
describe('notch penceresindeki atomlar paylasilan kaynaktan', () => {
  const HERE = import.meta.dirname
  const NOTCH_FILES = ['notch/notch-shell.tsx', 'notch/use-notch-voice.ts']

  it('notch hicbir yerde ciplak persistentAtom kullanmiyor', () => {
    for (const relative of NOTCH_FILES) {
      const source = readFileSync(join(HERE, relative), 'utf8')
      const stores = [...source.matchAll(/from '(\.[^']*)'/g)].map(match => match[1])

      for (const store of stores) {
        const path = join(HERE, 'notch', `${store}.ts`)
        let storeSource: string

        try {
          storeSource = readFileSync(path, 'utf8')
        } catch {
          continue
        }

        expect(
          /persistentAtom\s*[<(]/.test(storeSource),
          `${store} kalici degeri persistentAtom ile tutuyor: notch penceresine ulasmaz`
        ).toBe(false)
      }
    }
  })
})
