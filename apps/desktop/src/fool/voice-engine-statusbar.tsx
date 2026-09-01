/**
 * TTS/STT motor değiştirici — alt durum çubuğunda, HER KİPTE.
 *
 * Neden burada
 * ------------
 * Kullanıcının isteği: "stt ve tts seçimleri de evrensel olsun, hem cowork hem
 * chatte." Yani bu bir Chat kipi özelliği DEĞİL, uygulamanın genel bir
 * anahtarı. Alt çubuk zaten bu tür hızlı anahtarların yeri (model, onay kipi),
 * o yüzden yeni bir bölge açmıyor.
 *
 * Neden yalnızca KURULU motorlar
 * ------------------------------
 * Kullanıcının açık kuralı: "kurulu olmayan bir motor seçilebilir olmamalı."
 * Arka uç zaten reddediyor (``voice_models.select`` kurulu değilse hata
 * veriyor), ama seçilebilir gösterip hata vermek kullanıcıyı çalışmayan bir
 * yola sokmak olurdu. Kurulum hâlâ ses panelinden yapılıyor -- burası bir
 * DEĞİŞTİRİCİ, bir kurulum yüzeyi değil.
 *
 * Katalog TEMBEL yükleniyor: menü açılana kadar hiçbir istek gitmiyor. Katalog
 * çağrısı dokuz motorun CUDA sondasını çalıştırıyor (ölçüldü: ilk açılışta
 * ~6 sn) ve onu her uygulama açılışında koşturmak, kullanılmayan bir rozet
 * uğruna herkesi bekletmek olurdu.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { useCallback, useEffect, useState } from 'react'

import type { StatusbarItem } from '@/app/shell/statusbar-controls'
import { notifyError } from '@/store/notifications'

import { voiceApi, type VoiceCatalog } from './voice-api'

/** Menüde gösterilecek tek satır. */
interface EngineRow {
  id: string
  label: string
  active: boolean
  usable: boolean
}

function rows(catalog: null | VoiceCatalog, kind: 'stt' | 'tts'): EngineRow[] {
  return (catalog?.items ?? [])
    .filter(item => item.kind === kind)
    .map(item => ({
      active: item.active,
      id: item.id,
      label: item.label,
      // ``usable`` = kurulu VE gerçekten çalışıyor. ``installed`` tek başına
      // yetmiyor: paket yerinde ama içe aktarılamıyorsa seçim sessizce
      // çalışmayan bir motora geçmek olurdu.
      usable: item.usable
    }))
}

export function useVoiceEngineStatusbarItem(): StatusbarItem {
  const [catalog, setCatalog] = useState<null | VoiceCatalog>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open || catalog) {
      return
    }

    let alive = true

    voiceApi
      .catalog()
      .then(next => {
        if (alive) {
          setCatalog(next)
        }
      })
      .catch(() => {
        // Sessiz: ses arka ucu yoksa rozet "—" gösteriyor ve panel yine
        // açılabiliyor. Bir rozet uğruna durum çubuğunu hata mesajıyla
        // doldurmak yanlış olurdu.
      })

    return () => {
      alive = false
    }
  }, [catalog, open])

  const choose = useCallback(async (entryId: string) => {
    try {
      await voiceApi.select(entryId)
      setCatalog(await voiceApi.catalog())
    } catch (error) {
      notifyError(error, 'Could not switch voice engine')
    }
  }, [])

  const tts = rows(catalog, 'tts')
  const stt = rows(catalog, 'stt')
  const activeTts = tts.find(row => row.active)
  const activeStt = stt.find(row => row.active)

  // Basliklar da birer satir ama SECILEMEZ: menu ilkelinin ayri bir baslik
  // turu yok ve ikisini ayirmak icin ayri bir menu bileseni yazmak, tek bir
  // rozet ugruna ikinci bir menu yolu acmak olurdu.
  const section = (title: string, list: EngineRow[]) =>
    list.length === 0
      ? []
      : [
          { disabled: true, id: `${title}-header`, label: title },
          ...list.map(row => ({
            // KURULU DEGILSE secilemiyor -- kullanicinin kurali. Arka uc zaten
            // reddediyor, ama secilebilir gosterip hata vermek kullaniciyi
            // calismayan bir yola sokmak olurdu.
            disabled: !row.usable,
            id: row.id,
            label: `${row.active ? '· ' : '   '}${row.label}${row.usable ? '' : ' — not installed'}`,
            onSelect: () => void choose(row.id)
          }))
        ]

  return {
    id: 'voice-engines',
    label: 'Voice',
    detail: catalog ? `${activeTts?.label ?? '—'} · ${activeStt?.label ?? '—'}` : '—',
    menuAlign: 'end',
    menuItems: [...section('Speaks with', tts), ...section('Listens with', stt)],
    onSelect: () => setOpen(true),
    title: 'Text-to-speech and speech-to-text engines',
    variant: 'text'
  } as StatusbarItem
}
