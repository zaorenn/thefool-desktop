/**
 * Sesli yüzey, sahibinin ÇALIŞAN oturumuna asla dokunmamalı.
 *
 * İki ayrı sızıntı ölçüldü ve ikisi de aynı kalıptaydı: arkadaş oturumu
 * yoksa ``$activeSessionId``e -- yani masaüstü sohbet paneline -- düşmek.
 *
 *   1. ``resolveSessionId``  ->  sesli istem sahibinin oturumuna gidiyordu.
 *      O oturum ``desktop`` kapsamında: 21 takım, 73 araç, içinde
 *      ``terminal``, ``computer_use``, ``execute_code``, ``delegate_task``.
 *      Yani ``fool/session_scope.py``nin var olma sebebi sessizce geri
 *      alınıyordu -- hata yok, yalnızca sesli arkadaşın birden terminali var.
 *
 *   2. ``haltTurn``  ->  bas-konuşa basmak kullanıcının sohbet panelinde
 *      SÜREN işini kesiyordu. Buradaki yorum bunu açıkça yasaklıyordu ve kod
 *      tam onu yapıyordu; yorum ile kod ayrışmıştı.
 *
 * Bu sınavlar kaynağı okuyor: davranışı taklit etmek, dosyanın gerçekten ne
 * yaptığını değil taklidin ne yaptığını sınamak olurdu.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(join(import.meta.dirname, 'use-notch-voice.ts'), 'utf8')

const FRIEND = readFileSync(
  join(import.meta.dirname, '../friend/use-friend-voice.ts'),
  'utf8'
)

/** Yorumlar hariç GERÇEK kod. */
function code(source: string): string {
  return source
    .split('\n')
    .filter(line => {
      const trimmed = line.trimStart()

      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')
    })
    .join('\n')
}

describe('sesli oturum sahibinin oturumuna DUSMUYOR', () => {
  it('notch hicbir yerde paylasilan oturuma dusmuyor', () => {
    expect(
      code(SOURCE).includes('$activeSessionId'),
      'notch sesli yolu $activeSessionId kullaniyor: sahibinin CALISAN oturumu'
    ).toBe(false)
  })

  it('Friend penceresi de dusmuyor', () => {
    expect(code(FRIEND).includes('$activeSessionId')).toBe(false)
  })

  /**
   * Sessizce yutmak, kullanıcının konuşup hiçbir şey olmadığını görmesi
   * olurdu -- deposunda tam olarak bu vardı: sıfır mesajlı oturumlar.
   */
  it('oturum acilamazsa IKI yuzey de kullaniciya SOYLUYOR', () => {
    for (const [label, source] of [
      ['notch', SOURCE],
      ['friend', FRIEND]
    ] as const) {
      expect(/setError\(/.test(code(source)), `${label} hatayi bildirmiyor`).toBe(true)
    }
  })
})

describe('oturum kritik yoldan CIKARILDI', () => {
  /**
   * Ölçülen hata: oturum çözümü ``submitAudio`` içinde, transkripsiyon
   * bittikten SONRA bekleniyordu. Kullanıcı konuşmayı bitiriyor, metni
   * ekranda görüyor, sonra ``session.resume`` turu (sunucuda ajan + MCP
   * kurulumu) için saniyelerce bekliyordu -- "sesim algılandıktan sonra
   * birkaç saniye boş geçiyor".
   *
   * Konuşma zaten saniyeler sürüyor; oturum o sürenin İÇİNDE açılıyor.
   */
  it('notch dinleme baslarken oturumu aciyor', () => {
    expect(code(SOURCE).includes('prewarmRef.current()')).toBe(true)
  })

  it('Friend dinleme baslarken oturumu aciyor', () => {
    const listen = code(FRIEND).slice(code(FRIEND).indexOf('const listen = useCallback'))

    expect(listen.slice(0, 900).includes('resolveSessionId()')).toBe(true)
  })
})
