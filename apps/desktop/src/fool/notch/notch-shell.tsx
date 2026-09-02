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

import { NOTCH_INTERACTIVE_ATTR, useNotchClickThrough } from './click-through'
import {
  MAX_IDLE_ROUNDS,
  nextIdleRounds,
  shouldRearmListening
} from './hands-free'
import { $listenMode, listenModeHint, toggleListenMode } from './listen-mode'
import { NotchPet } from './notch-pet'
import { formatPttBindingLabel, parsePttBinding } from './ptt-binding'
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

/**
 * Çentiğin tek metin satırı.
 *
 * Model konuşurken metin BÜYÜYOR ve kutu sabit kalıyor: yeni gelen cümle
 * görünsün diye her yazımda dibe kaydırılıyor. Kaydırma yalnızca ``speaking``
 * iken: kullanıcının kendi cümlesi tek seferde geliyor, onu kaydırmak
 * gereksiz bir sıçrama olurdu.
 */
function NotchText({ speaking, text }: { speaking: boolean; text: string }) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (speaking && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight
    }
  }, [speaking, text])

  return (
    <div
      className={`max-h-16 w-full overflow-y-auto px-1 text-[0.78rem] leading-snug ${
        speaking ? 'text-left text-(--ui-text-primary)' : 'text-center text-(--ui-text-secondary)'
      }`}
      ref={ref}
    >
      {text}
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

  const [hovered, setHovered] = useState(false)
  // Oturum acik mi? Sag Ctrl yalnizca acikken dinliyor.
  const [sessionActive, setSessionActive] = useState(false)

  // Kullanici "dur" dedi.
  //
  // Sohbet kipiyle AYNI kanca secenegi ve ayni anlam: sozcuk bir tur olarak
  // gonderilmiyor, konusma bitiyor. Burada oturumu kapatmak sart -- eller
  // serbest kipte oturum acik kaldigi surece mikrofon her turdan sonra
  // kendini yeniden aciyor, yani "dur" demek hicbir seyi durdurmazdi.
  const voice = useNotchVoice({
    onStopWord: () => {
      setSessionActive(false)
      window.hermesDesktop?.notch?.close?.()
    }
  })

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


  // Dinleme kipi Friend penceresiyle ORTAK depo (bkz. ``listen-mode.ts``):
  // iki yuzey ayni mikrofonu kullaniyor ve ayri tutmak kullaniciya iki ayri
  // hakikat sunardi.
  const rearmListenMode = useStore($listenMode)


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

  // Kullanicinin SECTIGI kip.
  //
  // Burada ``'hands-free'`` SABIT yaziliydi, yani ``$listenMode`` hic
  // okunmuyordu: bas-konus secili olsa bile notch her turdan sonra mikrofonu
  // kendiliginden aciyordu. Kullanicinin "ctrl alt v modu sadece push to
  // talkta calissin" demesinin sebebi buydu -- secim vardi ama hicbir sey
  // yapmiyordu.
  //
  // Bas-konusta ``shouldRearmListening`` ``false`` donuyor ve mikrofonu
  // yalnizca TUS aciyor.
  const rearm = shouldRearmListening({
    capturing: voice.capturing,
    idleRounds,
    mode: rearmListenMode,
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

  // Ses tutamağı bir REF'te.
  //
  // Ölçülen hata: aşağıdaki tuş etkisi ``voice``a bağımlıydı ve ``voice`` her
  // render'da YENİ bir nesne (``useNotchVoice`` düz bir nesne döndürüyor).
  // Yani etki her render'da sökülüp yeniden kuruluyordu -- ve cevap akarken
  // ``setReply`` her token'da render tetikliyor, saniyede onlarca kez.
  //
  // Sökülen yalnızca yerel dinleyiciler değil: ``onPushToTalk`` da iptal edilip
  // yeniden abone oluyor. O boşluğa denk gelen bir tuş olayı KAYBOLUYOR --
  // yani sağ Ctrl ile araya girmenin en çok gerektiği anda, model konuşurken,
  // en kırılgan olduğu an.
  //
  // Ref render sırasında yazılıyor: geri çağrılar her zaman güncel tutamağı
  // görüyor ama etkinin kimliği sabit kalıyor.
  const voiceRef = useRef(voice)

  voiceRef.current = voice

  // Bas-konuş durumu bir ref'te: klavye olayları render döngüsünün dışında
  // geliyor ve state kullanmak her tuş olayında bir render daha demek olurdu.
  const ptt = useRef(createPushToTalkState())
  // Sag Ctrl her makinede yok: bazi dizustulerde fiziksel olarak bulunmuyor,
  // bazi kullanicilar onu IME degistirmeye baglamis. O makinelerde bas-konus
  // hic calismiyordu ve sebebi gorunmuyordu.
  const pttCode = useStore($pttCode)
  // Etiket AYRISTIRILARAK uretiliyor: ``pttCode`` artik ``Shift+ControlRight``
  // gibi bir kombo dizesi olabiliyor ve ham hali arayuz metni degil --
  // kullaniciya hangi tuslara basacagini soylemiyor.
  const pttLabel = formatPttBindingLabel(parsePttBinding(pttCode))

  // Tikla-gecir kapisi. Centik VARSAYILAN olarak gecirgen -- ekranin en ust
  // kenarinda duruyor ve oradaki sekmeleri, menuyu, pencere dugmelerini
  // yutmamali. Yalnizca imlec isaretli bir parcanin uzerindeyken katilasiyor.
  useNotchClickThrough()
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
        voiceRef.current.begin()
      }
    }

    const onUp = (event: KeyboardEvent) => {
      const action = ptOnKeyUp(ptt.current, event, Date.now(), pttCode)

      if (action?.type === 'commit') {
        voiceRef.current.commit()
      } else if (action?.type === 'cancel') {
        voiceRef.current.cancel()
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
        voiceRef.current.cancel()
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
    const handleListenRequest = (request?: null | { mode?: string }) => {

      // Kisayol yalnizca centigi acmiyor, ARKADAS turunu de basliyor.
      // Kip oturum ACILIRKEN yaziliyor: arac kumesi ajan kurulurken donuyor,
      // Kisayol SALT BAS-KONUS aciyor.
      //
      // Kullanicinin istegi birebir: "ctrl alt v sadece notchu aktif etsin
      // ve aktif olduktan sonra sadece sag ctrlye basili tutarken sesimizi
      // algilasin." Eller serbest kendiliginden dinlemeye gecerdi.
      //
      // Efekt DEGIL burada: niyet geldigi anda uygulaniyor. Efekt bir render
      // geriden gelir ve o karede eller serbest mikrofonu zaten acmis olur.
      $listenMode.set('push-to-talk')

      // UYANDIRMA: centik acilir, TTS onay verir, ses biter bitmez dinlenir ve
      // kullanici susunca (1,25 sn sessizlik) mesaj gider.
      //
      // Kip yine ``push-to-talk`` kaliyor -- bilincli. ``shouldRearmListening``
      // yalnizca eller serbest kipte mikrofonu yeniden aciyor; uyandirma turu
      // TEK SEFERLIK olmali (kullanicinin karari: "sonrasinda ya tekrar wake
      // word ya sag Ctrl"). Kipi cevirseydik tur biter bitmez mikrofon
      // kendiliginden acilir ve oda sessiz degilse yanlis tur baslardi.
      if (request?.mode === 'wake') {
        setSessionActive(true)
        void voiceRef.current.beginWakeTurn()

        return
      }

      setSessionActive(previous => {
        if (previous) {
          // Kapatiliyor: suren bir kayit varsa atilir ve ARKADAS OTURUMU
          // unutulur -- bir sonraki acilis temiz bir oturum alsin.
          voiceRef.current.cancel()
          voiceRef.current.endSession()
          window.hermesDesktop?.notch?.close?.()

          return false
        }

        // Oturum aciliyor: centigi one getir ve ODAGI al. Odak olmadan sag
        // Ctrl hicbir zaman ulasmaz.
        void window.hermesDesktop?.notch?.open?.()

        return true
      })
    }

    const stopListenRequest = window.hermesDesktop?.notch?.onListenRequest?.(handleListenRequest)

    // Montajda BEKLEYEN niyeti al.
    //
    // Yeni acilan bir pencerede ana surecin ``send``i buraya HIC ulasmiyor:
    // mesaj, renderer ``ipcRenderer.on`` cagirmadan once gidiyor ve dusuyor.
    // Kullanicinin gordugu buydu -- ilk Ctrl+Alt+V hicbir sey yapmiyor,
    // ikincisi aciyor. Ustune ac/kapa sayaci bir kayiyordu.
    void window.hermesDesktop?.notch?.takeListenRequest?.().then(pending => {
      if (pending) {
        handleListenRequest(pending)
      }
    })

    // BASKA penceremizden iletilen tus. Centik odakta olmasa da bas-konus
    // calisiyor -- odaklanmamis bir pencere hicbir tus olayi almiyor ve
    // "bir kez calisip oluyor" hatasi tam olarak buydu.
    const stopForwarded = window.hermesDesktop?.notch?.onPushToTalk?.(event => {
      // İletilen tuş GERÇEK bir ``KeyboardEvent`` DEĞİL: IPC'den düz bir
      // nesne olarak geliyor. ``onDown`` basılı tutuşun başka kısayolları
      // tetiklememesi için ``preventDefault()`` çağırıyor -- ve düz nesnede o
      // işlev yok.
      //
      // Ölçülen kırıklık (kullanıcının günlüğünden)::
      //
      //     [renderer console:notch] Uncaught Error:
      //     e.preventDefault is not a function
      //
      // İstisna ``preventDefault`` satırında atılıyor, yani hemen ardından
      // gelen ``voice.begin()`` HİÇ çalışmıyor: mikrofon açılmıyor ve çentik
      // ölü görünüyor. Kullanıcının bildirdiği "bir iki sağ Ctrl'den sonra
      // bir daha açılmıyor" tam olarak bu -- ilk cevap ana pencerede
      // çizilince odak oraya geçiyor ve tuş ARTIK iletilen yoldan geliyor.
      //
      // ``preventDefault`` burada no-op: iletilen olayın yutulacak bir
      // varsayılan davranışı zaten yok (bu pencere odakta değil, tuşu alan
      // pencere kendi tarafında hallediyor).
      //
      // ``code`` AYRISTIRILIYOR: ``pttCode`` artik ``Shift+ControlRight`` gibi
      // bir KOMBO dizesi olabiliyor ve onu oldugu gibi ``code`` diye vermek
      // hicbir olayla eslesmeyen bir tus uretirdi -- bas-konus odak disinda
      // sessizce olurdu. Degistiriciler GERCEK olaydan geliyor (ana surec
      // ilettiği icin), varsayimdan degil.
      const key = {
        altKey: event.altKey,
        code: parsePttBinding(pttCode).code,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        preventDefault: () => {},
        repeat: event.repeat,
        shiftKey: event.shiftKey
      } as unknown as KeyboardEvent

      if (event.type === 'down') {
        onDown(key)
      } else {
        onUp(key)
      }
    })

    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onWindowBlur)

    return () => {
      stopForwarded?.()
      stopListenRequest?.()
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onWindowBlur)
    }
    // ``pttCode`` bagimliliga giriyor: kullanici tusu yeniden bagladiginda
    // dinleyiciler ESKI koda bakmaya devam ederdi -- yani ayar kaydediliyor
    // ama hicbir sey degismiyor gibi gorunurdu.
    //
    // ``voice`` bagimlilikta DEGIL: her render'da yeni bir nesne ve etkiyi
    // surekli sokup takardi (gerekce ``voiceRef``in yaninda).
  }, [pttCode, sessionActive])

  return (
    <div className="flex h-screen w-screen flex-col items-center bg-transparent" data-fool-notch>
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
                    ? pausedLabel(pttLabel)
                    : LABEL[voice.status]}
                </div>

                {/* Bas-konus anahtari. Ayarlara gitmeden buradan
                    degistirilebiliyor: gurultulu bir ortamda mikrofonun
                    surekli acik olmasi konusmayi bozuyor ve o an panele
                    gitmek akisi kesiyordu.

                    IKI kapi birden aciliyor ve ikisi de sart:

                      * ``pointerEvents: 'auto'`` -- SAYFA katmani. Ust kutu
                        tiklamalari gecirmiyor (centik tikla-gec olsun diye).
                      * ``data-notch-interactive`` -- ISLETIM SISTEMI katmani.
                        Pencerenin kendisi tikla-gecir ve tiklama sayfaya HIC
                        ulasmiyor; bu isaret olmadan ``pointerEvents`` tek
                        basina hicbir sey yapmiyordu ve dugme OLUYDU. */}
                <button
                  className={`rounded-full px-2 py-0.5 text-[0.6rem] font-medium transition-colors ${
                    listenMode === 'push-to-talk'
                      ? 'bg-(--theme-primary) text-white'
                      : 'bg-white/10 text-(--ui-text-tertiary) hover:bg-white/20'
                  }`}
                  {...{ [NOTCH_INTERACTIVE_ATTR]: '' }}
                  onClick={() => toggleListenMode()}
                  style={{ pointerEvents: 'auto' }}
                  title={listenModeHint(listenMode, pttLabel)}
                  type="button"
                >
                  PTT
                </button>
              </div>

              {/* TEK SATIR, SIRAYLA -- ikisi birden DEĞİL.
                  İstenen sıra birebir şu: konuşma bitince gönderilen metin;
                  model cevap vermeye başlayınca onun cevabı; cevap uzunsa
                  model konuşurken aşağı akması; bitince kullanıcı yeni bir şey
                  söyleyene kadar öylece kalması.

                  Önce ikisi AYNI ANDA çiziliyordu ve çentik iki satırlık bir
                  kayıt defterine dönüyordu -- kullanıcının gördüğü karmaşa
                  buydu. Kural artık tek cümle: cevap varsa cevap, yoksa
                  söylenen.

                  ``reply`` yeni turda temizleniyor (``setReply('')``), yani
                  sıra kendiliğinden doğru işliyor: gönderilen metin görünür,
                  cevap akmaya başlayınca yerini alır, tur bitince orada kalır.

                  AKAN metin: sabit yükseklikli, kendi içinde kayan bir kutu.
                  ``line-clamp`` kesiyordu ve model konuşurken metnin gerisi
                  hiç görünmüyordu; çentiğin büyüyerek ekranı kaplaması ise tam
                  da kaçınılan şey. İkisinin ortası: şerit sabit kalıyor, metin
                  içinde akıyor. */}
              {(voice.reply || (voice.transcript && voice.status !== 'listening')) && (
                <NotchText speaking={Boolean(voice.reply)} text={voice.reply || voice.transcript} />
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

      {/* Masaustundeki pet: cubuktan asagi damliyor ve orada duruyor.
          Centik penceresi 220 px, cubuk 22-92 px -- altta kalan alan saydam
          ve fare olaylarini geciriyor, yani masaustunu hic isgal etmiyor. */}
      {sessionActive && <NotchPet level={voice.level} status={voice.status} />}
    </div>
  )
}
