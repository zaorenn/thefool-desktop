/**
 * Friend penceresi — oturup konuşmak için.
 *
 * Neden notch yetmiyor
 * --------------------
 * Notch küçük ve geçici: başka bir uygulamada çalışırken bir şey sormak için.
 * Bu ise sohbetin KENDİSİ için — kullanıcı buraya bakarak konuşuyor. İkisini
 * tek yüzeyde birleştirmek, notch'u büyütüp odağı çalmak demekti.
 *
 * Ne farklı
 * ---------
 * * Araç yok. Kapsam ``friend`` (bkz. ``fool/session_scope.py``): terminal,
 *   dosya, kod yok. Sohbette yanlış anlaşılma sık ve normal; bedeli boşa
 *   giden bir tur olmalı.
 * * Hafıza ORTAK. Friend ile ajan aynı ``MEMORY.md`` / ``USER.md``
 *   dosyalarını görüyor. Ayırmak arkadaşı hafızasız bırakırdı -- her
 *   seferinde kendini yeniden anlatmak zorunda kalırdın.
 * * Küre GERÇEK mikrofon seviyesini takip ediyor. Rastgele animasyon ilk
 *   bakışta aynı görünüyor ama kullanıcı sustuğunda da oynamaya devam ediyor
 *   ve his anında bozuluyor: "beni duymuyor, sadece oynuyor".
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Mic, MicOff } from '@/lib/icons'
import { playSpeechText } from '@/lib/voice-playback'
import { notifyError } from '@/store/notifications'
import { $voicePlayback } from '@/store/voice-playback'

import { $listenMode } from '../notch/listen-mode'
import { voiceApi, type VoiceCatalog, type VoiceItem } from '../voice-api'

import { $friendMode, FRIEND_MODES, friendModeInfo } from './friend-mode'
import {
  greetingFor,
  needsWaking,
  stageLine,
  WAKING_LINE,
  type WarmReply,
  warmupCaption,
  warmupSettled
} from './greeting'
import { Orb } from './orb'
import type { OrbPhase } from './orb-motion'
import {
  applyAccent,
  canChangeVoice,
  persistAccent,
  persona,
  PERSONAS,
  readAccent,
  voiceForPersona
} from './persona'
import { sessionLabel, type SessionSummary, touchesMachine } from './session-picker'
import { useFriendVoice } from './use-friend-voice'
import { isChoosableVoiceId, selectedVoiceId, voiceOptions } from './voice-choice'
import { isWarming, warmingLabel } from './warming'

/** Windows'ta ``option`` renkleri ``select``ten MIRAS ALINMIYOR; acikca
 *  veriliyor, yoksa koyu temada yazilar okunmuyor. */
const OPTION_STYLE = { background: '#1a1a1a', color: '#f0f0f0' } as const

/** Durum satırı — kullanıcıya görünen metin İngilizce (deponun kuralı). */
const PHASE_LABEL: Record<OrbPhase, string> = {
  idle: 'Tap to talk',
  listening: 'Listening',
  speaking: 'Talking',
  thinking: 'Thinking'
}

export function FriendView() {
  const mode = useStore($friendMode)
  const [muted, setMuted] = useState(false)
  // Dinleme kipi notch ile ORTAK depo: ikisi ayni mikrofonu kullaniyor ve
  // ayri tutmak kullaniciya iki ayri hakikat sunardi (sesin kendisinde tam
  // bu hata yasandi).
  const listenMode = useStore($listenMode)
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null)
  const [provider, setProvider] = useState('')
  const [speaker, setSpeaker] = useState('')

  // Hook'a ARTIK ses gecilmiyor. Bu pencere sentez saglayicisini SECMIYOR;
  // sunucu ``tts.provider``i okuyor. Gecirdigim surece iki kaynak vardi ve
  // ikisi ayrisabiliyordu: asagidaki ``provider`` bir React state'i, yalnizca
  // montajda dolduruluyor -- kullanici motoru Ayarlar'dan degistirdiginde
  // burasi ESKI adi tutuyordu ve tek-seferlik geri dusus yolu o eski motorla
  // konusuyordu (cumle-cumle akis yolu zaten hep geneli okuyordu). Ayni
  // pencere, ayni cevap, iki farkli ses.
  const voice = useFriendVoice(mode)

  const [holding, setHolding] = useState(false)

  // Sohbet secici. Sunucudan CAGRILDIGINDA cekiliyor: panel her acilista
  // oturum listesi istemek, hic acilmayacak bir menu icin her seferinde bir
  // ag turu odemek olurdu.
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [sessionsError, setSessionsError] = useState('')

  // Acilis dizisi: damlama -> (soguksa) uyanma cumlesi -> asamalar -> selam.
  // ``opening`` TRUE iken mikrofon ACILMIYOR: selamlama kendi mikrofonuna
  // kaydedilirdi ve ajan kendi "Hello"suna cevap verirdi.
  const [opening, setOpening] = useState(true)
  const [warmCaption, setWarmCaption] = useState('')

  // Persona: ses + vurgu rengi TEK secim.
  const [activePersona, setActivePersona] = useState(() => readAccent())
  const selectedRef = useRef<null | VoiceItem>(null)

  // Kayitli persona rengini ACILISTA uygula: renk kalici olmazsa kullanici
  // her acilista varsayilana donerdi.
  useEffect(() => {
    const entry = persona(activePersona)

    applyAccent(entry?.accent ?? '')

    return () => applyAccent('')
    // Yalnizca montajda: renk secim aninda zaten uygulaniyor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Katalogu sunucudan tazele ve GOSTERILEN secimi ona esitle.
   *
   * Gosterim tek yonlu: hakikat sunucuda (``tts.provider``), buradaki state
   * yalnizca onun kopyasi. Yazdiktan sonra da bu cagriliyor, yani basarisiz
   * bir yazimdan sonra acilir liste gercekten kayitli olan sese geri doner.
   */
  const refreshCatalog = useCallback(async () => {
    try {
      const data = await voiceApi.catalog()

      setCatalog(data)
      setProvider(selectedVoiceId(data))
    } catch {
      // Sessizce gec: ses secimi olmadan da pencere calisiyor. Bir katalog
      // hatasinin sohbeti engellemesi yanlis olurdu.
    }
  }, [])

  useEffect(() => {
    void refreshCatalog()

    // Pencere one gelince yeniden oku: motor Ayarlar'dan ya da ``fool config
    // set`` ile degismis olabilir ve bu pencerenin bunu GORMESI gerekiyor --
    // aksi halde panel bir sey gosterip baska bir ses duyuluyor, ki bu tam
    // olarak kullanicinin bildirdigi hata.
    window.addEventListener('focus', refreshCatalog)

    return () => window.removeEventListener('focus', refreshCatalog)
  }, [refreshCatalog])

  /** Ses secimi GENEL ayari degistiriyor, Friend'e ozel bir kopya DEGIL.
   *
   * Once kip basina ayri tutuyordum ve iki sorun uretti: (1) sohbet paneli
   * ile Friend farkli motor secince tek-motor kurali her turu
   * yukle-bosalt-yukle donguse ceviriyordu, (2) kullanici "Friend'in sesi
   * ile global ses ayni olmali" dedi -- hakli, iki yerde iki ses tutmak
   * kullaniciya iki ayri hakikat sunmak.
   */
  const chooseProvider = useCallback(async (next: string) => {
    if (!isChoosableVoiceId(next)) {
      return
    }

    setProvider(next)
    // Motor degisti: eski motorun ses tipi yenisinde yok.
    setSpeaker('')

    try {
      await voiceApi.select(next)
    } catch (error) {
      notifyError(error, 'Could not save the voice')
    } finally {
      // Basarida da hatada da sunucuya sor: iyimser gosterim yazim
      // tutmadiginda acilir listeyi yalanci birakiyordu.
      await refreshCatalog()
    }
  }, [refreshCatalog])

  const openSessions = useCallback(async () => {
    setSessionsOpen(previous => !previous)

    try {
      setSessions(await voice.listSessions())
      setSessionsError('')
    } catch (error) {
      setSessions([])
      setSessionsError(error instanceof Error ? error.message : 'Could not load conversations')
    }
  }, [voice])

  /** Motorun KENDI ses tipleri (Kokoro'nun yedi sesi gibi). */
  const chooseSpeaker = useCallback(
    async (entryId: string, next: string) => {
      setSpeaker(next)

      try {
        await voiceApi.setVoice(entryId, next)
      } catch (error) {
        notifyError(error, 'Could not save the speaker')
      } finally {
        // Sunucuya sor: iyimser gosterim yazim tutmadiginda acilir listeyi
        // yalanci birakiyordu (ayni gerekce ``chooseProvider``da da yazili).
        await refreshCatalog()
      }
    },
    [refreshCatalog]
  )

  /**
   * Persona seç: rengi ve sesi AYNI anda.
   *
   * Renk her zaman değişiyor; ses yalnızca motorun birden çok sesi varsa.
   * Tek sesli bir motorda sessizce yanlış bir ses seçmek, kullanıcının
   * gördüğü ile duyduğunun ayrışması olurdu -- bu kod tabanında zaten
   * yaşanmış bir hata.
   */
  const choosePersona = useCallback(
    async (id: string) => {
      const entry = persona(id)

      if (!entry) {
        return
      }

      setActivePersona(id)
      applyAccent(entry.accent)
      persistAccent(id)

      const engine = selectedRef.current

      if (!engine || !canChangeVoice(engine)) {
        return
      }

      const wanted = voiceForPersona(entry, engine.voices)

      if (!wanted || wanted === (engine.voice || '')) {
        return
      }

      setSpeaker(wanted)

      try {
        await voiceApi.setVoice(engine.id, wanted)
      } catch (error) {
        notifyError(error, `Could not switch to ${entry.label}`)
      }
    },
    []
  )

  /**
   * Aç, konuş, sonra dinle.
   *
   * Sıra ÖNEMLİ. Sesli bir yüzeyin ilk işi sesli olduğunu kanıtlamak, ama
   * selamlama mikrofon açıkken söylenirse kendi kaydına düşüyor ve ajan
   * kendi "Hello"suna cevap veriyor. Bu yüzden dinleme ``opening`` bitene
   * kadar bekliyor.
   *
   * Soğuk motorda ilk cümlenin KENDİSİ ısınma: ölçüldü, styletts2 soğuk
   * 22,5 sn / sıcak 0,52 sn. O cümle duyulduğu anda motor sıcak demek, yani
   * sonraki aşama satırları gerçekten hızlı akıyor.
   */
  useEffect(() => {
    let cancelled = false

    void (async () => {
      // Damlama otursun; hemen konusmak animasyonu yutuyordu.
      await new Promise(resolve => setTimeout(resolve, 780))

      let seen: WarmReply = {}

      try {
        seen = (await voiceApi.warmVoice()) as WarmReply
      } catch {
        // Isitma cagrilamadi: yine de selamla. Ilk cumle modeli kendi yukler.
      }

      if (cancelled) {
        return
      }

      setWarmCaption(warmupCaption(seen))

      // Motor soguksa ONCE uyanma cumlesi: bu cagri modeli yukluyor ve
      // duyuldugu anda motor sicak.
      if (needsWaking(seen)) {
        await playSpeechText(WAKING_LINE, { source: 'voice-conversation' }).catch(
          () => undefined
        )
      }

      // Asamalari izle; her SOGUKTAN SICAGA gecisi soyle.
      const deadline = Date.now() + 90_000

      while (!cancelled && !warmupSettled(seen) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 700))

        let next: WarmReply = seen

        try {
          next = (await voiceApi.warmVoice()) as WarmReply
        } catch {
          break
        }

        if (cancelled) {
          return
        }

        setWarmCaption(warmupCaption(next))

        for (const surface of ['tts', 'stt'] as const) {
          const line = stageLine(surface, seen, next)

          if (line) {
            await playSpeechText(line, { source: 'voice-conversation' }).catch(() => undefined)
          }
        }

        seen = next
      }

      if (cancelled) {
        return
      }

      setWarmCaption('')
      await playSpeechText(greetingFor(mode), { source: 'voice-conversation' }).catch(
        () => undefined
      )

      if (!cancelled) {
        setOpening(false)
      }
    })()

    return () => {
      cancelled = true
    }
    // Yalnizca MONTAJDA: kip degisimi pencereyi yeniden selamlatmamali.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = useCallback(() => {
    setMuted(previous => {
      const next = !previous

      if (next) {
        voice.stop()
      } else if (listenMode === 'hands-free') {
        voice.start()
      }

      return next
    })
  }, [listenMode, voice])

  // Kip degisince mikrofonu ona gore ayarla: eller serbest surekli dinliyor,
  // bas-konus yalnizca basiliyken.
  useEffect(() => {
    // Selamlama bitmeden mikrofon ACILMIYOR -- yoksa ajan kendi selamini
    // duyup ona cevap veriyor.
    if (muted || opening) {
      return
    }

    if (listenMode === 'hands-free') {
      voice.start()
    } else {
      voice.stop()
    }
    // ``voice`` her render'da yeni bir nesne; bagimliliga almak mikrofonu
    // acip kapatip dururdu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listenMode, muted, opening])

  // Modelleri PENCERE ACILIR ACILMAZ isit.
  //
  // Olculdu: kokoro soguk 24,17 sn / sicak 0,32 sn, styletts2 soguk
  // 67,21 sn / sicak 0,86 sn. Bu pencere isitmayi hic cagirmiyordu, yani
  // ilk cumlede soguk yuklemeyi kullanici bekliyordu -- ayarlardaki Listen
  // dugmesi 2,5 sn'de konusurken. Fark buydu.
  //
  // Hata YUTULUYOR: isitma bir iyilestirme, gereklilik degil. Basarisiz
  // olursa ilk cumle modeli kendisi yukler; kullaniciya bildirim gostermek
  // hicbir sey bozulmamisken telas yaratirdi.
  useEffect(() => {
    void voiceApi.warmVoice().catch(() => undefined)
  }, [provider])

  // Friend KONUSURKEN notch da acik kalsin.
  //
  // Kullanici istegi: notch ekranin ustunde durup durumu gosteriyor, boylece
  // Friend penceresinden ciksan bile konusmanin nerede oldugunu goruyorsun.
  // Notch SESSIZ kaliyor -- ses sahibi Friend (bkz. fool/voice-owner.ts);
  // notch yalnizca gosterge.
  //
  // Kosul MONTAJ DEGIL, GERCEK ETKINLIK. Once montajda aciyordum ve sonucu
  // sacmaydi: uygulama en son Friend sayfasindayken kapatilmissa, acilista
  // ana pencere daha "Connecting" derken notch uzerine biniyordu -- kullanici
  // uygulamanin notch icinde bir mini uygulama olarak basladigini goruyordu.
  // Sohbet baslamadan gosterecek bir durum da yok zaten.
  const talking = !muted && voice.phase !== 'idle'

  useEffect(() => {
    if (!talking) {
      return
    }

    void window.hermesDesktop?.notch?.open?.()

    return () => {
      void window.hermesDesktop?.notch?.close?.()
    }
  }, [talking])

  // Sayfa kapaninca mikrofonu MUTLAKA birak: acik kalan bir mikrofon
  // kullanicinin gormedigi en kotu durum.
  useEffect(() => {
    return () => voice.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hold = useCallback(() => {
    if (muted || listenMode !== 'push-to-talk') {
      return
    }

    setHolding(true)
    voice.beginHold()
  }, [listenMode, muted, voice])

  const release = useCallback(() => {
    if (!holding) {
      return
    }

    setHolding(false)
    voice.endHold()
  }, [holding, voice])

  // Model uyaniyor mu? Olculdu: soguk yukleme 4,67-40,52 sn ve o sure
  // boyunca ekranda "Talking" yazip HIC ses cikmiyordu -- kullanici icin
  // "bozuk"tan ayirt edilemez.
  const playback = useStore($voicePlayback)
  const [preparingSince, setPreparingSince] = useState<null | number>(null)
  const [warming, setWarming] = useState(false)

  useEffect(() => {
    if (playback.status !== 'preparing') {
      setPreparingSince(null)
      setWarming(false)

      return
    }

    const startedAt = preparingSince ?? Date.now()

    if (preparingSince === null) {
      setPreparingSince(startedAt)
    }

    const timer = setInterval(() => {
      setWarming(isWarming({ elapsedMs: Date.now() - startedAt, preparing: true }))
    }, 300)

    return () => clearInterval(timer)
  }, [playback.status, preparingSince])

  const tts = voiceOptions(catalog)

  // Secili motorun katalog kaydi -- ses tipleri ondan geliyor.
  const selected = provider ? tts.find(item => item.id === provider) : tts.find(item => item.active)

  // ``choosePersona`` bunu okuyor. Bagimliliga almak her katalog
  // tazelemesinde geri cagriyi yeniden kurardi.
  selectedRef.current = selected ?? null

  return (
    <div className="relative flex h-full flex-col px-6 pt-5 pb-6 [--ease:cubic-bezier(0.32,0.72,0,1)]">
      {/* ---- Üst şerit: kip ve sürdürülen sohbet ------------------------
          macOS segmented control: tek hairline kap, içinde kayan bir pill.
          İki ayrı düğme yerine tek bir kontrol -- seçimin nerede olduğu
          şeklin kendisinden okunuyor. */}
      <header className="flex items-center justify-between">
        <div className="relative flex rounded-full border border-(--stroke-nous)/70 p-0.5">
          {/* Kayan pill: düğmelerin ARKASINDA duruyor ve konumu seçime göre
              değişiyor. Rengi vurgu rengi, yani personayı da taşıyor. */}
          <span
            aria-hidden
            className="absolute top-0.5 bottom-0.5 left-0.5 rounded-full bg-(--theme-primary) transition-transform duration-200 ease-(--ease)"
            style={{
              transform: mode === 'jarvis' ? 'translateX(100%)' : 'translateX(0)',
              width: 'calc(50% - 2px)'
            }}
          />
          {(Object.keys(FRIEND_MODES) as (keyof typeof FRIEND_MODES)[]).map(option => (
            <button
              className={`relative z-10 w-24 rounded-full py-1 text-[0.7rem] font-medium transition-colors duration-200 ease-(--ease) ${
                mode === option ? 'text-white' : 'text-muted-foreground hover:text-(--text-primary)'
              }`}
              key={option}
              onClick={() => $friendMode.set(option)}
              title={FRIEND_MODES[option].summary}
              type="button"
            >
              {FRIEND_MODES[option].label}
            </button>
          ))}
        </div>

        {/* Sürdürülen sohbet. Eskiden görünmüyordu ve mikrofonu susturmak
            oturumu siliyordu -- kullanıcı yeni mi eski mi konuştuğunu
            bilemiyordu. */}
        <div className="relative">
          <button
            className="flex items-center gap-1.5 rounded-full border border-(--stroke-nous)/70 px-3 py-1 text-[0.68rem] text-muted-foreground transition-colors duration-200 ease-(--ease) hover:bg-(--surface-hover)"
            onClick={() => void openSessions()}
            type="button"
          >
            <span
              className={`size-1.5 rounded-full transition-colors duration-200 ${
                voice.sessionId ? 'bg-(--theme-primary)' : 'bg-(--stroke-nous)'
              }`}
            />
            {voice.sessionId ? 'Continuing' : 'New conversation'}
          </button>

          {sessionsOpen && (
            <>
              {/* Dışarı tıklayınca kapansın. Görünmez ama tıklanabilir. */}
              <button
                aria-label="Close"
                className="fixed inset-0 z-20 cursor-default"
                onClick={() => setSessionsOpen(false)}
                type="button"
              />
              <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-xl border border-(--stroke-nous)/70 bg-(--surface-1)/95 shadow-2xl backdrop-blur-xl">
                <div className="border-b border-(--stroke-nous)/50 px-3 py-2 text-[0.6rem] tracking-[0.14em] text-muted-foreground uppercase">
                  Continue a conversation
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {sessions.length === 0 && (
                    <p className="px-3 py-4 text-xs text-muted-foreground">
                      {sessionsError || 'Nothing to continue yet.'}
                    </p>
                  )}
                  {sessions.map(item => (
                    <button
                      className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors duration-150 hover:bg-(--surface-hover)"
                      key={item.id}
                      onClick={() => {
                        voice.adoptSession(item)
                        setSessionsOpen(false)
                      }}
                      type="button"
                    >
                      <span className="w-full truncate text-xs text-(--text-primary)">
                        {sessionLabel(item)}
                      </span>
                      <span className="flex items-center gap-1.5 text-[0.6rem] text-muted-foreground">
                        <span className="tabular-nums">{item.message_count} messages</span>
                        {/* Bu oturumu sürdürmek TERMİNAL vermek olabilir:
                            kapsam oturum kurulurken dondu. Sessizce yapmak,
                            kullanıcıya makineye dokunamayacağını söylemek
                            olurdu. */}
                        {touchesMachine(item) && (
                          <span className="text-(--theme-warm)">· can act on your machine</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
                {voice.sessionId && (
                  <button
                    className="w-full border-t border-(--stroke-nous)/50 px-3 py-2 text-left text-xs text-muted-foreground transition-colors duration-150 hover:bg-(--surface-hover)"
                    onClick={() => {
                      voice.newConversation()
                      setSessionsOpen(false)
                    }}
                    type="button"
                  >
                    Start a new conversation
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {/* ---- Merkez ---------------------------------------------------- */}
      <div className="flex flex-1 flex-col items-center justify-center gap-7">
        {/* Damlama BURADA DEGIL: bu sayfa zaten bir sekme, orb hicbir
            yerden damlamiyordu -- sadece sayfanin icinde beliriyordu.
            Masaustunde damlayan pet centikte (bkz. notch/notch-pet.tsx). */}
        <Orb level={voice.level} phase={voice.phase} />

        <div className="flex min-h-24 max-w-xl flex-col items-center gap-2.5 text-center">
          <span className="text-[0.6rem] tracking-[0.16em] text-muted-foreground uppercase">
            {muted ? 'Muted' : PHASE_LABEL[voice.phase]}
          </span>

          {/* Makineye erisim SESSIZ olmamali: sesli sohbette yanlis
              anlasilma sik ve normal, kullanici hangi kipte konustugunu
              gormeli. */}
          {friendModeInfo(mode).touchesMachine && (
            <span className="text-[0.62rem] text-(--theme-warm)">
              {friendModeInfo(mode).summary}
            </span>
          )}

          {/* Bekleme kacinilmaz (model diskten VRAM'e yuklenecek) ama
              GORUNMEZ olmasi degil. */}
          {warming && (
            <span className="text-[0.62rem] text-(--theme-warm)">
              {warmingLabel(selected?.label ?? provider)}
            </span>
          )}

          {/* Acilis isinmasi. 22 saniyelik SESSIZ bir bekleme "bozuldu" gibi
              gorunuyor; ne beklendigi ve ne kadar surecegi yaziyor. */}
          {warmCaption && (
            <span className="text-[0.62rem] text-muted-foreground">{warmCaption}</span>
          )}

          {/* Son soylenen ve son duyulan: kullanici yanlis anlasilmayi
              GORMELI. Sesli bir arayuzde bunu gostermemek, hatayi ancak
              cevap gelince fark etmek demek. */}
          {voice.transcript && (
            <p className="text-xl leading-snug text-balance text-(--text-primary)">
              {voice.transcript}
            </p>
          )}
          {voice.reply && (
            <p className="text-sm leading-relaxed text-balance text-muted-foreground">
              {voice.reply}
            </p>
          )}
          {voice.error && <p className="text-xs text-(--theme-warm)">{voice.error}</p>}
        </div>
      </div>

      {/* ---- Alt şerit: persona · mikrofon · giriş --------------------- */}
      <footer className="grid grid-cols-3 items-end">
        {/* Persona: ses ve renk TEK seçim. Kullanıcının isteği birebir
            buydu -- kızdan erkek sesine geçince vurgu da değişsin. */}
        <div className="flex flex-col gap-2">
          <span className="text-[0.58rem] tracking-[0.14em] text-muted-foreground uppercase">
            Voice
          </span>
          <div className="flex items-center gap-2">
            {PERSONAS.map(entry => (
              <button
                aria-label={entry.label}
                className={`size-4 rounded-full transition-all duration-200 ease-(--ease) ${
                  activePersona === entry.id
                    ? 'scale-110 ring-2 ring-(--theme-primary) ring-offset-2 ring-offset-(--surface-0)'
                    : 'opacity-55 hover:opacity-100'
                }`}
                key={entry.id}
                onClick={() => void choosePersona(entry.id)}
                style={{ background: entry.accent }}
                title={`${entry.label} — ${entry.summary}`}
                type="button"
              />
            ))}
          </div>
          {/* Motorun KENDI ses tipleri -- persona kisayoldu, bu ACIK secim.
              Yeniden tasarimda bu acilir listeyi dusurmusum ve sonucu:
              Kokoro'nun yedi sesi arasindan (kadin/erkek dahil) secim yapmanin
              paneldeki tek yolu dort persona noktasi kalmisti. */}
          {canChangeVoice(selected ?? null) ? (
            <select
              aria-label="Voice type"
              className="h-6 max-w-[11rem] rounded-full border border-(--stroke-nous)/70 bg-transparent px-2 text-[0.66rem] text-muted-foreground"
              onChange={event => void chooseSpeaker(selected!.id, event.target.value)}
              value={speaker || selected?.voice || selected?.voices[0]?.id || ''}
            >
              {(selected?.voices ?? []).map(entry => (
                <option key={entry.id} style={OPTION_STYLE} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          ) : selected?.clone_capable ? (
            /* KLONLAYAN motorda "tek sesi var" demek yaniltiyordu.
               Olculdu:
                 kokoro      7 hazir ses, klonlama YOK
                 chatterbox  hazir ses YOK, klonlama VAR
                 piper       1 ses, klonlama YOK
               Yani chatterbox'in ses bankasi yok cunku sesi SEN veriyorsun.
               Bunu bir kisit gibi gostermek, motorun asil ozelligini eksiklik
               gibi okutuyordu. */
            <span className="text-[0.58rem] text-muted-foreground">
              {selected.clone
                ? `Cloned voice: ${selected.clone.replace(/\.[^.]+$/, '')}`
                : 'Voice comes from a clip you upload — Settings › Voice'}
            </span>
          ) : (
            /* Gercekten tek sesli ve klonlamayan motor (Piper). Persona rengi
               degistirir, SESI degil -- sessizce yanlis bir ses secmek yerine
               bunu soylemek. */
            <span className="text-[0.58rem] text-muted-foreground">
              {selected?.label ?? 'This engine'} has one voice
            </span>
          )}
        </div>

        {/* Mikrofon dugmesi kipe gore FARKLI davraniyor: eller serbestte
            sustur/ac, bas-konusta basili tutulan tus. Tek dugmeye iki anlam
            yuklemek yerine davranisi kipe baglamak, kullanicinin ne
            yapacagini tahmin etmesini gerektirmiyor. */}
        <div className="flex justify-center">
          <button
            aria-label={
              listenMode === 'push-to-talk' ? 'Hold to talk' : muted ? 'Unmute' : 'Mute'
            }
            className={`flex size-14 items-center justify-center rounded-full border transition-all duration-200 ease-(--ease) ${
              holding
                ? 'scale-95 border-(--theme-primary) bg-(--theme-primary)/20'
                : muted
                  ? 'border-(--stroke-nous)/70 text-muted-foreground hover:bg-(--surface-hover)'
                  : 'border-(--theme-primary)/40 hover:border-(--theme-primary) hover:bg-(--surface-hover)'
            }`}
            onClick={listenMode === 'hands-free' ? toggle : undefined}
            onPointerCancel={release}
            onPointerDown={listenMode === 'push-to-talk' ? hold : undefined}
            onPointerLeave={release}
            onPointerUp={release}
            type="button"
          >
            {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </button>
        </div>

        {/* Giris kipi ve motor. Ayarlara gitmeden buradan degistirilebiliyor
            -- konusurken "sesi begenmedim" demek icin baska bir sayfaya
            gitmek akisi kesiyordu. */}
        <div className="flex flex-col items-end gap-2">
          <span className="text-[0.58rem] tracking-[0.14em] text-muted-foreground uppercase">
            Input
          </span>
          <div className="flex overflow-hidden rounded-full border border-(--stroke-nous)/70 text-[0.66rem]">
            {(['hands-free', 'push-to-talk'] as const).map(option => (
              <button
                className={`px-2.5 py-1 transition-colors duration-200 ease-(--ease) ${
                  listenMode === option
                    ? 'bg-(--theme-primary) text-white'
                    : 'text-muted-foreground hover:bg-(--surface-hover)'
                }`}
                key={option}
                onClick={() => $listenMode.set(option)}
                type="button"
              >
                {option === 'hands-free' ? 'Hands-free' : 'Push'}
              </button>
            ))}
          </div>

          {/* Bos secenek YOK: ``voice_models.select("")`` -> HTTP 400.
              "Default voice"u secmek bir hata bildirimi cikariyor, motoru
              degistirmiyor ve acilir listeyi yine de yeni degerde
              birakiyordu. */}
          <select
            aria-label="Engine"
            className="h-6 rounded-full border border-(--stroke-nous)/70 bg-transparent px-2 text-[0.66rem] text-muted-foreground"
            onChange={event => void chooseProvider(event.target.value)}
            value={provider}
          >
            {tts.map(item => (
              <option key={item.id} style={OPTION_STYLE} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </footer>
    </div>
  )
}
