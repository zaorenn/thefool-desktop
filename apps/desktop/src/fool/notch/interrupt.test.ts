import { describe, expect, it, vi } from 'vitest'

import { interruptThenSubmit, shouldInterruptTurn } from './interrupt'

describe('durdurma penceresi', () => {
  it('dusunme ve konusma sirasinda durduruyor', () => {
    expect(shouldInterruptTurn('thinking')).toBe(true)
    expect(shouldInterruptTurn('speaking')).toBe(true)
  })

  it('bosta, dinlerken ve yaziya dokerken durdurmuyor', () => {
    expect(shouldInterruptTurn('idle')).toBe(false)
    expect(shouldInterruptTurn('listening')).toBe(false)
    expect(shouldInterruptTurn('transcribing')).toBe(false)
  })
})

describe('durdur-sonra-gonder sirasi', () => {
  it('gonderim durdurma cozulmeden baslamiyor', async () => {
    // Ters sirada calistirmak yeni istemi MESGUL bir oturuma yollamakti.
    const order: string[] = []
    // Kapanis icinde atanan bir ``let``i TypeScript ``never``e daraltiyor
    // (atama akis analizinde gorunmuyor), o yuzden bir nesne alaninda
    // tutuluyor.
    const gate: { release: () => void } = { release: () => undefined }

    const pending = interruptThenSubmit({
      interrupt: () =>
        new Promise<void>(resolve => {
          order.push('interrupt:start')

          gate.release = () => {
            order.push('interrupt:done')
            resolve()
          }
        }),
      submit: () => {
        order.push('submit')
      }
    })

    // Durdurma hala askida: gonderim BASLAMAMIS olmali.
    await Promise.resolve()

    expect(order).toEqual(['interrupt:start'])

    gate.release()
    await pending

    expect(order).toEqual(['interrupt:start', 'interrupt:done', 'submit'])
  })

  it('durdurma dusse bile cumle yine de gonderiliyor', async () => {
    // Kullanicinin soyledigi cumle elimizde. Ag hatasini yutup onu cope
    // atmak, araya girmenin kendisinden daha kotu bir sonuc.
    const submit = vi.fn()
    const onInterruptError = vi.fn()

    await interruptThenSubmit({
      interrupt: () => Promise.reject(new Error('gateway down')),
      onInterruptError,
      submit
    })

    expect(submit).toHaveBeenCalledOnce()
    expect(onInterruptError).toHaveBeenCalledOnce()
    expect(onInterruptError.mock.calls[0][0]).toBeInstanceOf(Error)
  })

  it('senkron firlatan durdurma da akisi kesmiyor', async () => {
    const submit = vi.fn()

    await interruptThenSubmit({
      interrupt: () => {
        throw new Error('boom')
      },
      submit
    })

    expect(submit).toHaveBeenCalledOnce()
  })

  it('gonderim hatasi YUTULMUYOR', async () => {
    // Gonderim gercekten basarisizsa cagiran taraf bunu gormeli --
    // kullanici cevap beklerken sessizce hicbir sey olmamasi kabul edilemez.
    await expect(
      interruptThenSubmit({
        interrupt: () => undefined,
        submit: () => Promise.reject(new Error('submit failed'))
      })
    ).rejects.toThrow('submit failed')
  })
})
