/**
 * İki sesli kip paneli: arkadaş ve Jarvis.
 *
 * Neden ayrı paneller
 * -------------------
 * İki kipin gereksinimleri çelişiyor ve tek panelde göstermek ikisini de
 * belirsizleştiriyordu. Ayrı bölümler somut bir şey de sağlıyor: her kip
 * KENDİ sesini seçebiliyor. Arkadaş için sıcak ve ifadeli bir ses, Jarvis
 * için kısa ve net bir ses istemek doğal; ikisini aynı sese bağlamak
 * ikisini de zayıflatıyor.
 *
 * Jarvis makineye dokunuyor ve panel bunu SÖYLÜYOR. Sesli bir yüzeye terminal
 * vermek bilinçli bir karar olmalı, keşfedilen bir sürpriz değil.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'

import { ListRow, Pill, SettingsContent, SettingsSection } from '@/app/settings/primitives'
import { Button } from '@/components/ui/button'
import { triggerHaptic } from '@/lib/haptics'
import { Mic, Volume2, Zap } from '@/lib/icons'
import { notifyError } from '@/store/notifications'

import { voiceApi, type VoiceCatalog } from './voice-api'
import { $voiceMode, VOICE_MODES, type VoiceModeId, voiceModeInfo } from './voice-mode'

/** Bu kipin sesi -- kaydedilmemişse genel ayar kullanılıyor. */
const MODE_PROVIDER_KEY = (mode: VoiceModeId) => `voice.modes.${mode}.provider`

function ModePanel({
  catalog,
  mode,
  onProvider,
  provider
}: {
  catalog: VoiceCatalog | null
  mode: VoiceModeId
  onProvider: (mode: VoiceModeId, provider: string) => void
  provider: string
}) {
  const active = useStore($voiceMode)
  const info = VOICE_MODES[mode]
  const isActive = active === mode

  const tts = (catalog?.items ?? []).filter(item => item.kind === 'tts' && item.installed)

  return (
    <SettingsSection
      icon={mode === 'jarvis' ? Zap : Mic}
      meta={isActive ? 'active' : undefined}
      title={info.label}
    >
      <ListRow
        action={
          <Button
            disabled={isActive}
            onClick={() => {
              triggerHaptic()
              $voiceMode.set(mode)
            }}
            size="sm"
            variant={isActive ? 'ghost' : 'outline'}
          >
            {isActive ? 'Active' : 'Use this mode'}
          </Button>
        }
        description={info.summary}
        title={isActive ? `${info.label} — in use` : info.label}
      />

      {/* Jarvis makineye dokunuyor ve bunu SOYLEMEK gerekiyor. Sesli bir
          yuzeye terminal vermek bilincli bir karar olmali. */}
      {info.touchesMachine && (
        <ListRow
          action={<Pill>voice + terminal</Pill>}
          description="Anything you say in this mode can run commands, read and write files, and drive the browser. Voice is easy to mishear — Jarvis asks before anything destructive, but the surface is real."
          title="This mode can act on your machine"
        />
      )}

      {/* Kip basina AYRI ses secici KALDIRILDI.
          Olculdu: tts.provider=styletts2 (panelin gosterdigi) iken
          voice.modes.friend.provider=kyutai (gercekten kosan) -- kullanici
          panelde bir sey secip bambaska bir sesi duyuyordu ve gecikmenin
          (0,56 sn yerine 11 sn) sebebini hicbir yerden goremiyordu.
          Tek hakikat: Text to speech bolumundeki secim. */}
      <ListRow
        description="Every mode speaks with the engine you picked under Text to speech — one voice, one place to change it."
        title="Voice"
      />
    </SettingsSection>
  )
}

export function VoiceModeSettings() {
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null)
  const [providers, setProviders] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const [data, saved] = await Promise.all([voiceApi.catalog(), voiceApi.modeProviders()])

        if (!cancelled) {
          setCatalog(data)
          setProviders(saved.providers ?? {})
        }
      } catch (error) {
        if (!cancelled) {
          notifyError(error, 'Could not load voice modes')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const onProvider = useCallback(async (mode: VoiceModeId, provider: string) => {
    // Iyimser guncelleme: select'in bir tur eski deger gostermesi, kullaniciya
    // secimi "tutmadi" gibi gorunuyordu.
    setProviders(previous => ({ ...previous, [mode]: provider }))

    try {
      await voiceApi.setModeProvider(mode, provider)
    } catch (error) {
      notifyError(error, 'Could not save the voice for this mode')
    }
  }, [])

  return (
    <SettingsContent>
      <SettingsSection icon={Volume2} title="Voice modes">
        <ListRow
          description={`Two ways to talk. The notch opens in whichever is active — currently ${voiceModeInfo($voiceMode.get()).label}.`}
          title="Pick how the notch behaves"
        />
      </SettingsSection>

      {(['companion', 'jarvis'] as const).map(mode => (
        <ModePanel
          catalog={catalog}
          key={mode}
          mode={mode}
          onProvider={(id, provider) => void onProvider(id, provider)}
          provider={providers[mode] ?? ''}
        />
      ))}
    </SettingsContent>
  )
}

export { MODE_PROVIDER_KEY }
