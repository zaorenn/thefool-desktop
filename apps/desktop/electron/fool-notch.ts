/**
 * Ses notch'unun pencere geometrisi ve URL'i.
 *
 * Neden ayrı bir dosya
 * --------------------
 * Electron'a bağımlı olmayan parça burada durur ki birim testi yazılabilsin —
 * `hud-url.ts` ile aynı bölünme ve aynı gerekçe: aşağıdaki sözleşme bozulana
 * kadar görünmez.
 *
 * Neden pencere HEP büyük
 * -----------------------
 * Notch açılıp kapanırken OS penceresini büyütüp küçültmek akıcı bir animasyon
 * vermiyor: Windows'ta her `setBounds` çağrısı bir kare atlatıyor ve saydam bir
 * çerçevesiz pencerede kenarlar titriyor. Bunun yerine pencere HER ZAMAN
 * genişlemiş ölçüde duruyor; notch onun içinde çiziliyor ve animasyon tamamen
 * CSS/motion tarafında oluyor. Pencerenin geri kalanı saydam ve fareyi
 * geçiriyor, yani kullanıcı için görünmez.
 */

import { pathToFileURL } from 'node:url'

export interface NotchBounds {
  height: number
  width: number
  x: number
  y: number
}

export interface DisplayArea {
  height: number
  width: number
  x: number
  y: number
}

/** Notch'un kapalı haldeki genişliği (hap biçimi). */
export const NOTCH_COLLAPSED_WIDTH = 168

/** Kapalı haldeki yükseklik — macOS notch'una yakın, ekranın üst kenarına yapışık. */
export const NOTCH_COLLAPSED_HEIGHT = 32

/**
 * Pencerenin ölçüsü: notch'un açılabileceği EN BÜYÜK hal artı gölge payı.
 *
 * Animasyon bu kutunun içinde olup bittiği için pencere hiç yeniden
 * boyutlanmıyor.
 */
export const NOTCH_WINDOW_WIDTH = 460
export const NOTCH_WINDOW_HEIGHT = 220

/**
 * Notch penceresinin yerleşimi: ekranın ÜST kenarına yapışık, yatayda ortalı.
 *
 * ``workArea`` değil ``bounds`` kullanılıyor: notch tam da ekranın fiziksel üst
 * kenarına oturmalı. workArea üstte bir görev çubuğu varsa aşağı kayar ve
 * notch havada asılı kalır — macOS'taki çentik hissi tamamen kaybolur.
 */
export function notchBounds(displayBounds: DisplayArea): NotchBounds {
  const width = NOTCH_WINDOW_WIDTH
  const height = NOTCH_WINDOW_HEIGHT

  return {
    height,
    width,
    x: Math.round(displayBounds.x + (displayBounds.width - width) / 2),
    y: displayBounds.y
  }
}

/**
 * Notch renderer'ının URL'i.
 *
 * ``hud-url.ts`` ile AYNI sözleşme: ``?win=notch`` ve isteğe bağlı ``profile=``
 * '#' işaretinden ÖNCE gelmek zorunda, yoksa HashRouter onları rotanın parçası
 * sanıp yutuyor.
 */
export function buildNotchWindowUrl({
  devServer,
  profile,
  rendererIndexPath
}: { devServer?: null | string; profile?: null | string; rendererIndexPath?: string } = {}): string {
  const profileKey = typeof profile === 'string' ? profile.trim() : ''
  const query = `?win=notch${profileKey ? `&profile=${encodeURIComponent(profileKey)}` : ''}`

  if (devServer) {
    const base = devServer.endsWith('/') ? devServer.slice(0, -1) : devServer

    return `${base}/${query}#/`
  }

  return `${pathToFileURL(rendererIndexPath!).toString()}${query}#/`
}
