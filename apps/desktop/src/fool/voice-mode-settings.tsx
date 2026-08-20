/**
 * İki sesli kip paneli: arkadaş ve Jarvis.
 *
 * Neden ayrı paneller
 * -------------------
 * İki kipin gereksinimleri çelişiyor ve tek panelde göstermek ikisini de
 * belirsizleştiriyordu. Ayıran şey ARAÇ KÜMESİ: Jarvis makineye dokunuyor,
 * arkadaş dokunmuyor.
 *
 * Ayıran şey SES DEĞİL. Bir süre her kip kendi sesini seçebiliyordu ve
 * ölçülen sonucu şuydu: ``tts.provider=styletts2`` (panelin gösterdiği,
 * cümle başına 0,56 sn) dururken ``voice.modes.friend.provider=kyutai``
 * (gerçekten koşan, 11 sn). Kullanıcı panelde bir şey seçip bambaşka bir
 * sesi duyuyordu. Tek hakikat: Text to speech bölümündeki seçim.
 *
 * Jarvis makineye dokunuyor ve panel bunu SÖYLÜYOR. Sesli bir yüzeye terminal
 * vermek bilinçli bir karar olmalı, keşfedilen bir sürpriz değil.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { useStore } from '@nanostores/react'

import { ListRow, Pill, SettingsContent, SettingsSection } from '@/app/settings/primitives'
import { Button } from '@/components/ui/button'
import { triggerHaptic } from '@/lib/haptics'
import { Mic, Volume2, Zap } from '@/lib/icons'

import { $voiceMode, VOICE_MODES, type VoiceModeId, voiceModeInfo } from './voice-mode'

function ModePanel({ mode }: { mode: VoiceModeId }) {
  const active = useStore($voiceMode)
  const info = VOICE_MODES[mode]
  const isActive = active === mode

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
  return (
    <SettingsContent>
      <SettingsSection icon={Volume2} title="Voice modes">
        <ListRow
          description={`Two ways to talk. The notch opens in whichever is active — currently ${voiceModeInfo($voiceMode.get()).label}.`}
          title="Pick how the notch behaves"
        />
      </SettingsSection>

      {(['companion', 'jarvis'] as const).map(mode => (
        <ModePanel key={mode} mode={mode} />
      ))}
    </SettingsContent>
  )
}
