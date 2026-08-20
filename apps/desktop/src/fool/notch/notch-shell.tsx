/**
 * macOS tarzı ses notch'u.
 *
 * Biçim
 * -----
 * Ekranın üst kenarına YAPIŞIK, yatayda ortalı, yalnızca ALT köşeleri yuvarlak
 * bir kabuk — ekrana oyulmuş bir çentik gibi. Üst köşeler bilerek düz: yuvarlak
 * olsalardı çentik değil, havada duran bir hap gibi görünürdü.
 *
 * Pencere HİÇ yeniden boyutlanmıyor
 * ---------------------------------
 * Açılıp kapanırken OS penceresini büyütmek Windows'ta kare atlatıyor ve saydam
 * çerçevesiz pencerede kenarlar titriyor. Pencere her zaman en büyük ölçüde
 * duruyor (bkz. ``electron/fool-notch.ts``); animasyon tamamen burada, yay
 * fiziğiyle oluyor. Pencerenin geri kalanı saydam ve fareyi geçiriyor.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { useStore } from '@nanostores/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import { onGatewayEvent } from '@/contrib/events'
import { Mic } from '@/lib/icons'

import { voiceApi } from '../voice-api'
import { $voiceMode } from '../voice-mode'

import {
  MAX_IDLE_ROUNDS,
  nextIdleRounds,
  shouldRearmListening
} from './hands-free'
import { $listenMode, listenModeHint, toggleListenMode } from './listen-mode'
import { formatPttCode } from './ptt-binding'
import { $pttCode } from './ptt-store'
import {
  createPushToTalkState,
  onBlur as ptOnBlur,
  onKeyDown as ptOnKeyDown,
  onKeyUp as ptOnKeyUp
} from './push-to-talk'
import { type NotchStatus, useNotchVoice } from './use-notch-voice'

const COLLAPSED_WIDTH = 104
const COLLAPSED_HEIGHT = 22
const EXPANDED_WIDTH = 300
const EXPANDED_HEIGHT = 92

/** Tur bittikten sonra yazının ekranda kalma süresi. */
const LINGER_MS = 6000

/** Yay: hafif taşan ama salınmayan bir açılış. macOS'un çentik hissi bu. */
const SPRING = { damping: 26, mass: 0.9, stiffness: 380, type: 'spring' } as const

// Kullaniciya gorunen metinler Ingilizce -- uygulamanin varsayilan dili.
// (Yorumlar Turkce; bu ayrim depo kurali.)
const LABEL: Record<NotchStatus, string> = {
  idle: 'Listening — just talk',
  listening: 'Listening…',
  speaking: 'Replying',
  thinking: 'Thinking…',
  transcribing: 'Transcribing…'
}

/** Eller serbest kip kendini susturdugunda gosterilen satir. */
const pausedLabel = (key: string) => `Paused — press ${key} or say the wake word`

/**
 * Canlı dalga formu.
 *
 * Çubuk sayısı sabit ve seviye SAĞDAN sola kaydırılıyor: yeni ses hep aynı
 * kenardan giriyor, böylece konuşmanın akış yönü gözle takip edilebiliyor.
 * Rastgele animasyon değil — gerçekten mikrofondan gelen seviyeyi çiziyor.
 */
function Waveform({ active, level }: { active: boolean; level: number }) {
  const [bars, setBars] = useState<number[]>(() => Array.from({ length: 28 }, () => 0))
  const levelRef = useRef(level)

  levelRef.current = level

  useEffect(() => {
    if (!active) {
      setBars(previous => previous.map(() => 0))

      return
    }

    // 24 fps yeterli: daha hızlısı gözle ayırt edilmiyor ama her karede bir
    // React render'ı demek.
    const timer = setInterval(() => {
      setBars(previous => [...previous.slice(1), Math.min(1, levelRef.current)])
    }, 42)

    return () => clearInterval(timer)
  }, [active])

  return (
    <div className="flex h-8 items-center justify-center gap-[3px]">
      {bars.map((value, index) => (
        <motion.span
          animate={{
            // Taban 3px: sessizlikte de ince bir çizgi kalsın, çubuklar
            // tamamen kaybolup arayüz "bozulmuş" gibi görünmesin.
            height: 3 + value * 26
          }}
          className="w-[3px] rounded-full bg-(--theme-primary)"
          // Kayan pencere sabit uzunlukta ve cubugun KIMLIGI konumu:
          // 3. cubuk her zaman 3. cubuk. Icerige gore anahtar vermek
          // her karede tum listeyi yeniden monte ederdi.
          key={`bar-${index}`}
          transition={{ damping: 20, stiffness: 500, type: 'spring' }}
        />
      ))}
    </div>
  )
}

export function NotchShell() {
  // Uygulamanin global govde arkaplani bu pencerede de boyaniyor: notch'un
  // kendisi solsa bile arkasinda 460x220'lik opak bir dikdortgen kaliyordu
  // ("kocaman siyah kisim"). Pencere zaten saydam; govdeyi de saydam yapmak
  // gerekiyor ve bu YALNIZCA notch penceresinde olmali, o yuzden global
  // stylesheet yerine burada.
  useEffect(() => {
    const root = document.documentElement
    const { body } = document
    const previous = [root.style.background, body.style.background] as const

    root.style.background = 'transparent'
    body.style.background = 'transparent'

    return () => {
      root.style.background = previous[0]
      body.style.background = previous[1]
    }
  }, [])

  const voice = useNotchVoice()
  const [hovered, setHovered] = useState(false)
  // Oturum acik mi? Sag Ctrl yalnizca acikken dinliyor.
  const [sessionActive, setSessionActive] = useState(false)
  // Hangi kisayolun kayitli oldugu makineye gore degisiyor (aday
  // merdiveni), o yuzden SABIT yazmak yerine ana surece soruluyor.
  const [shortcut, setShortcut] = useState<null | string>(null)

  useEffect(() => {
    void window.hermesDesktop?.notch?.shortcut?.().then(r => setShortcut(r?.shortcut ?? null))
  }, [])
  const shellRef = useRef<HTMLDivElement | null>(null)

  // Fare uzerine gelince centik TAMAMEN kayboluyor ve masaustunu birakiyor.
  //
  // Neden `pointerenter` degil de pencere duzeyinde konum: notch penceresi
  // `setIgnoreMouseEvents(true, { forward: true })` ile calisiyor -- tiklamalar
  // altta kalana gidiyor, renderer yalnizca ILETILEN hareket olaylarini
  // goruyor. O kipte enter/leave guvenilir atesle(n)miyor; konumu olcmek
  // ise her zaman dogru.
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const box = shellRef.current?.getBoundingClientRect()

      if (!box) {
        return
      }

      // Kucuk bir pay: centigin hemen kenarinda titremesin.
      const pad = 8

      const inside =
        event.clientX >= box.left - pad &&
        event.clientX <= box.right + pad &&
        event.clientY <= box.bottom + pad

      setHovered(inside)
    }

    window.addEventListener('mousemove', onMove)

    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  // Wake word de kisayolla AYNI seyi yapiyor: oturumu acar.
  //
  // Kullanicinin istedigi buydu ve mantikli: "hey fool" demek ile Ctrl+Alt+V
  // basmak ayni niyet -- konusmaya baslamak. Ikisini farkli davranislara
  // baglamak, hangisini kullandigina gore farkli bir uygulama demek olurdu.
  useEffect(
    () =>
      onGatewayEvent('wake.detected', () => {
        setSessionActive(true)
        void window.hermesDesktop?.notch?.open?.()
      }),
    []
  )

  // Oturum acikken centik ODAGI KORUMALI.
  //
  // Bildirilen kiriklik tam buydu: ilk istem gonderildikten sonra sag Ctrl
  // artik algilanmiyordu. Sebebi centigin odagi kaybetmesi -- odaklanmamis
  // bir pencere hicbir tus olayi almaz, yani bas-konus sessizce oluyordu.
  //
  // Tur bittiginde (durum 'idle'e dondugunde) odak geri aliniyor. Suren bir
  // tur sirasinda dokunulmuyor: kullanici o esnada baska bir uygulamada
  // calisiyor olabilir ve odagi calmak sinir bozucu olurdu.
  useEffect(() => {
    if (!sessionActive || voice.status !== 'idle') {
      return
    }

    const timer = setTimeout(() => {
      void window.hermesDesktop?.notch?.open?.()
    }, 150)

    return () => clearTimeout(timer)
  }, [sessionActive, voice.status])

  // Tur bittikten SONRA da bir süre açık kal.
  //
  // Neden: durum `idle`'a döndüğü anda daraltmak, kullanıcının az önce ne
  // söylediğini ekrandan siliyordu — yanlış anlaşılmayı fark etme şansı
  // kalmıyordu. Konuşma bitti diye kanıtı da kaldırmak yanlış.
  const [lingering, setLingering] = useState(false)

  useEffect(() => {
    if (voice.status !== 'idle') {
      setLingering(true)

      return
    }

    if (!voice.transcript) {
      setLingering(false)

      return
    }

    const timer = setTimeout(() => setLingering(false), LINGER_MS)

    return () => clearTimeout(timer)
  }, [voice.status, voice.transcript])

  const expanded = voice.status !== 'idle' || lingering

  // Oturum açılınca konuşma tanımayı ISIT.
  //
  // Ölçüldü (12,18 sn gerçek konuşma, Whisper large-v3-turbo float16):
  // ısıtmasız ilk transkripsiyon 6,94 sn, ısıtılmış 0,66 sn. O altı saniye
  // modelin VRAM'e yüklenmesi ve kullanıcı ilk cümlesini söylerken arka
  // planda ödenebiliyor.
  //
  // Boşta-boşaltma paylaşılan kartta 300 sn olduğu için (fool/gpu_budget.py)
  // maliyet her uzun aradan sonra geri geliyordu; oturumu her açışta ısıtmak
  // tam o durumu kapsıyor.
  //
  // Hata YUTULUYOR: ısıtma bir iyileştirme, bir gereklilik değil. Ağ geçidi
  // henüz ayakta değilse oturum yine açılmalı.
  useEffect(() => {
    if (!sessionActive) {
      return
    }

    void voiceApi.warmVoice().catch(() => undefined)
  }, [sessionActive])

  // Eller serbest tur alma: oturum açıkken tur biter bitmez mikrofon
  // kendiliğinden açılıyor. Kullanıcı hiçbir şeye dokunmadan cevap veriyor —
  // bas-konuş telsiz gibiydi, bu konuşma gibi.
  //
  // Sağ Ctrl yine çalışıyor ve o kayıt BAS-KONUŞ kuralıyla işliyor: gürültülü
  // ortamda kullanıcı kaydın sınırını kendi çizmek isteyebilir.
  const [idleRounds, setIdleRounds] = useState(0)

  // Kullanıcı konuştuysa sayaç sıfırlanır; birikmiş sayaç onu bir sonraki
  // sessizlikte erken susturmamalı.
  useEffect(() => {
    if (voice.heardSpeech) {
      setIdleRounds(0)
    }
  }, [voice.heardSpeech])

  // Oturum her açıldığında sayaç sıfırdan başlıyor: kullanıcı az önce
  // kısayola bastı, orada olduğu kesin.
  useEffect(() => {
    if (sessionActive) {
      setIdleRounds(0)
    }
  }, [sessionActive])

  const rearm = shouldRearmListening({
    capturing: voice.capturing,
    idleRounds,
    mode: 'hands-free',
    sessionActive,
    status: voice.status
  })

  useEffect(() => {
    if (!rearm) {
      return
    }

    // Kısa bir gecikme: oynatma kuyruğunun gerçekten boşalması için. Aynı
    // karede açmak hoparlörün son hecesini mikrofona yakalatıyordu.
    const timer = setTimeout(() => {
      voice.begin('auto')
      // Bu turda konuşma duyulmazsa kayıt boşta zaman aşımıyla kapanacak;
      // sayaç şimdiden artıyor ve ``heardSpeech`` gelirse sıfırlanıyor.
      setIdleRounds(previous => nextIdleRounds(previous, false))
    }, 250)

    return () => clearTimeout(timer)
    // ``voice`` her render'da yeni bir nesne; bağımlılığa almak efekti her
    // render'da yeniden kurar ve mikrofonu açıp kapatıp durur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rearm])

  // Kip kendini susturduysa kullanıcıya SÖYLE. Sessizce durmak, notch açık
  // dururken hiçbir şeyin çalışmadığı izlenimi veriyordu.
  const paused = sessionActive && voice.status === 'idle' && idleRounds >= MAX_IDLE_ROUNDS

  // Bas-konuş durumu bir ref'te: klavye olayları render döngüsünün dışında
  // geliyor ve state kullanmak her tuş olayında bir render daha demek olurdu.
  const ptt = useRef(createPushToTalkState())
  // Sag Ctrl her makinede yok: bazi dizustulerde fiziksel olarak bulunmuyor,
  // bazi kullanicilar onu IME degistirmeye baglamis. O makinelerde bas-konus
  // hic calismiyordu ve sebebi gorunmuyordu.
  const pttCode = useStore($pttCode)
  // Dinleme kipi Friend penceresiyle ORTAK: iki yuzey ayni mikrofonu
  // kullaniyor ve kipi ayri tutmak kullaniciya iki ayri hakikat sunardi.
  const listenMode = useStore($listenMode)

  useEffect(() => {
    const onDown = (event: KeyboardEvent) => {
      const action = ptOnKeyDown(ptt.current, event, Date.now(), pttCode)

      if (action?.type === 'start' && sessionActive) {
        // Tuşun varsayılan davranışını yutuyoruz ki basılı tutuş başka bir
        // kısayolu tetiklemesin.
        event.preventDefault()
        voice.begin()
      }
    }

    const onUp = (event: KeyboardEvent) => {
      const action = ptOnKeyUp(ptt.current, event, Date.now(), pttCode)

      if (action?.type === 'commit') {
        voice.commit()
      } else if (action?.type === 'cancel') {
        voice.cancel()
      }
    }

    // Odak kaybı bırakma sayılıyor: tuş hâlâ basılı olsa bile ``keyup`` artık
    // bize gelmeyecek, o olay odağı alan uygulamaya gider. Basılı saymaya devam
    // etmek mikrofonu sonsuza kadar açık bırakırdı.
    //
    // OTURUMU kapatmiyor: kullanici centige degil, calistigi uygulamaya
    // bakiyor olabilir. Oturum yalnizca kisayolla kapanir.
    const onWindowBlur = () => {
      if (ptOnBlur(ptt.current)) {
        voice.cancel()
      }
    }

    // Global kisayol (notch ODAKTA DEGILKEN): tek dokunus dinlemeyi acar,
    // ikinci dokunus gonderir. Basili tutus burada kullanilamaz -- Electron'un
    // globalShortcut'i tus birakmayi bildirmiyor.
    // Ctrl+Alt+V bir OTURUM aciyor/kapatiyor -- tek seferlik dinleme degil.
    //
    // Onceki davranis su kirikligi uretiyordu: kisayol bir kez dinlemeyi
    // aciyor, ilk istem gonderildikten sonra centik odagi kaybediyor ve sag
    // Ctrl artik ALGILANMIYOR (odaklanmamis bir pencere tus olayi almaz).
    // Kullanici centigi acik gorup konusmaya calisiyor, hicbir sey olmuyor.
    //
    // Dogru model: kisayol oturumu ACAR, oturum boyunca sag Ctrl calisir,
    // ayni kisayol oturumu KAPATIR.
    const stopListenRequest = window.hermesDesktop?.notch?.onListenRequest?.(request => {
      // Kisayol yalnizca centigi acmiyor, ARKADAS turunu de basliyor.
      // Kip oturum ACILIRKEN yaziliyor: arac kumesi ajan kurulurken donuyor,
      // tur icinde degistirilemez (bkz. fool/voice-mode.ts).
      if (request?.mode === 'friend') {
        $voiceMode.set('companion')
      }

      setSessionActive(previous => {
        if (previous) {
          // Kapatiliyor: suren bir kayit varsa atilir ve ARKADAS OTURUMU
          // unutulur -- bir sonraki acilis temiz bir oturum alsin.
          voice.cancel()
          voice.endSession()
          window.hermesDesktop?.notch?.close?.()

          return false
        }

        // Oturum aciliyor: centigi one getir ve ODAGI al. Odak olmadan sag
        // Ctrl hicbir zaman ulasmaz.
        void window.hermesDesktop?.notch?.open?.()

        return true
      })
    })

    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onWindowBlur)

    return () => {
      stopListenRequest?.()
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onWindowBlur)
    }
    // ``pttCode`` bagimliliga giriyor: kullanici tusu yeniden bagladiginda
    // dinleyiciler ESKI koda bakmaya devam ederdi -- yani ayar kaydediliyor
    // ama hicbir sey degismiyor gibi gorunurdu.
  }, [pttCode, sessionActive, voice])

  return (
    <div className="flex h-screen w-screen justify-center bg-transparent" data-fool-notch>
      <motion.div
        animate={{
          height: expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT,
          // Genişlik pencereye göre KIRPILMAZ: kullanıcının yakınlaştırma
          // ayarı 110% iken pencere 460 fiziksel piksel ama yalnızca 418 CSS
          // pikseli; sabit 420 px istemek çentiği kenardan kesiyordu.
          opacity: hovered ? 0 : expanded ? 1 : 0.72,
          width: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH
        }}
        // Üst köşeler DÜZ, alt köşeler yuvarlak — ekrana oyulmuş çentik.
        //
        // Renkler TEMADAN geliyor, sabit siyah değil: uygulamanın vurgu rengi
        // değiştiğinde çentik de onunla değişmeli, yoksa ekranın tepesinde
        // temaya ait olmayan bir kara leke kalıyor.
        className="max-w-full overflow-hidden rounded-b-[18px] border-x border-b border-white/10 text-(--ui-text-primary) shadow-[0_8px_28px_rgba(0,0,0,0.28)] backdrop-blur-2xl backdrop-saturate-150"
        initial={false}
        // Fare üzerine gelince TAMAMEN görünmez: çentik ekranın en üstünde
        // duruyor ve oradaki sekmeleri/menüleri kapatmamalı. Görünmezken
        // fareyi de geçiriyor (pointer-events), yani altındaki şeye tıklanır.
        ref={shellRef}
        // Buzlu cam: SAF SIYAH degil. Arkaplan yariya kadar saydam ve
        // dinlerken vurgu rengiyle hafifce tonlaniyor, boylece centik
        // ekranin bir parcasi gibi duruyor -- uzerine yapistirilmis bir
        // kutu gibi degil.
        style={{
          background:
            voice.status === 'listening'
              ? 'color-mix(in srgb, var(--theme-primary) 18%, rgb(0 0 0 / 0.45))'
              : 'rgb(0 0 0 / 0.42)',
          pointerEvents: 'none'
        }}
        transition={hovered ? { duration: 0.18 } : SPRING}
      >
        <AnimatePresence initial={false} mode="wait">
          {expanded ? (
            <motion.div
              animate={{ opacity: 1 }}
              className="flex h-full flex-col items-center justify-center gap-1 px-5"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              key="expanded"
              transition={{ duration: 0.12 }}
            >
              <Waveform active={voice.status === 'listening'} level={voice.level} />

              <div className="flex items-center gap-2">
                <div className="text-[0.7rem] font-medium tracking-wide text-(--ui-text-tertiary)">
                  {voice.status === 'idle' && paused
                    ? pausedLabel(formatPttCode(pttCode))
                    : LABEL[voice.status]}
                </div>

                {/* Bas-konus anahtari. Ayarlara gitmeden buradan
                    degistirilebiliyor: gurultulu bir ortamda mikrofonun
                    surekli acik olmasi konusmayi bozuyor ve o an panele
                    gitmek akisi kesiyordu.

                    ``pointerEvents`` ACIKCA geri veriliyor: bu kutunun ust
                    katmani tiklamalari gecirmiyor (centik tikla-gec olsun
                    diye) ve dugme onsuz olu kalirdi. */}
                <button
                  className={`rounded-full px-2 py-0.5 text-[0.6rem] font-medium transition-colors ${
                    listenMode === 'push-to-talk'
                      ? 'bg-(--theme-primary) text-white'
                      : 'bg-white/10 text-(--ui-text-tertiary) hover:bg-white/20'
                  }`}
                  onClick={() => toggleListenMode()}
                  style={{ pointerEvents: 'auto' }}
                  title={listenModeHint(listenMode, formatPttCode(pttCode))}
                  type="button"
                >
                  PTT
                </button>
              </div>

              {/* Yazıya dökülen metin: kullanıcı ne anlaşıldığını GÖRMELİ.
                  Görmezse yanlış anlaşılmayı ancak cevaptan fark eder. */}
              {voice.transcript && voice.status !== 'listening' && (
                <div className="line-clamp-2 max-w-full text-center text-[0.78rem] text-(--ui-text-primary)">
                  {voice.transcript}
                </div>
              )}

              {voice.error && (
                <div className="line-clamp-1 text-[0.7rem] text-(--theme-warm)">{voice.error}</div>
              )}
            </motion.div>
          ) : (
            <motion.div
              animate={{ opacity: 1 }}
              className="flex h-full items-center justify-center gap-2 px-4"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              key="collapsed"
              transition={{ duration: 0.12 }}
            >
              {/* Kapali halde METIN YOK. Kisayolu surekli yazmak centigi
                  genisletiyor ve ekranin tepesinde gereksiz yer kapliyordu;
                  kullanici onu zaten bir kez ogreniyor. Kisayol yalnizca
                  uzerine gelindiginde ipucu olarak duruyor. */}
              <Mic className="size-3 text-(--theme-primary)" />
              <span className="h-1 w-1 rounded-full bg-(--theme-primary)/60" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
