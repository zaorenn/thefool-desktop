/**
 * ESKİ bir cevap asla sesli okunmaz.
 *
 * Kullanıcının bildirdiği birebir: "bir yerden sonra yeni cevap yerine önceki
 * cevabı okumaya başladı sesli şekilde, ve yeni cevap gelene kadar önceki
 * mesajı okumayı başlattığı için yeni cevap geldiğinde 2 ses aynı anda
 * konuşuyor gibi oluyordu."
 *
 * İki ayrı kaynak vardı ve ikisi de aynı kalıptı: bir yüzey konuşmayı BAŞKASINA
 * bıraktığında ya da hiç başlamadığında, o cevabı KENDİ defterinde
 * "okunmamış" bırakıyordu.
 *
 *   1. TÜKETİLMEYEN RET. ``use-auto-speak-replies`` iki erken çıkışında da
 *      (konuşma kipi açık, ya da sahiplik başka yüzeyde) cevabı işaretlemeden
 *      dönüyordu. Çentik sesi devralıp bıraktıktan sonra, herhangi bir
 *      ``$messages`` tikinde -- kullanıcının YENİ istem yazması da bir tik --
 *      ``pendingReply()`` hâlâ ÖNCEKİ cevabı döndürüyor ve besteci onu
 *      okumaya başlıyordu.
 *
 *   2. TOHUMLANMAMIŞ İŞARETÇİ. Çentik açılışta "en son okunan" işaretçisini
 *      tohumluyordu; besteci ``useRef(null)`` ile başlıyordu, yani bir oturum
 *      açıldığında GEÇMİŞTEKİ son cevap okunmamış görünüyordu.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const read = (...parts: string[]) => readFileSync(join(__dirname, ...parts), 'utf8')

const NEWLINE = String.fromCharCode(10)

/** Yorumlar ELENIYOR: bu dosyalar olculen hatayi kendi icinde anlatiyor
 *  (deponun uslubu) ve yorumu tarayan bir muhafiz kendi aciklamasina takilir.
 *  Ayni tuzaga bu depoda daha once de dusuldu. */
const code = (source: string) =>
  source
    .split(NEWLINE)
    .filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join(NEWLINE)

const AUTO_SPEAK = code(
  read('..', '..', 'app', 'chat', 'composer', 'hooks', 'use-auto-speak-replies.ts')
)
const COMPOSER = read('..', '..', 'app', 'chat', 'composer', 'hooks', 'use-composer-voice.ts')
const SHELL = read('notch-shell.tsx')

describe('cekilen yuzey cevabi TUKETIYOR', () => {
  it('konusma kipi acikken cevap isaretleniyor', () => {
    const branch = AUTO_SPEAK.slice(AUTO_SPEAK.indexOf('if (conversationActive) {'))

    expect(branch.slice(0, 200)).toContain('declineCurrent()')
  })

  it('sahiplik BASKA yuzeydeyken cevap isaretleniyor', () => {
    const branch = AUTO_SPEAK.slice(AUTO_SPEAK.indexOf("if (!canSpeak('composer')) {"))

    expect(branch.slice(0, 500)).toContain('declineCurrent()')
  })

  it('ret KORUMALARDAN once hesaplaniyor', () => {
    // Cevabi korumadan SONRA okumak, kaydedilecek kimligin o an artik
    // degismis olmasi demekti.
    expect(AUTO_SPEAK.indexOf('const declineCurrent')).toBeLessThan(
      AUTO_SPEAK.indexOf('if (conversationActive) {')
    )
  })

  it('ret PLANLAYICIYA baglaniyor', () => {
    // Kayit tek basina yetmez: planlayici ``declined`` gorup beklemeli.
    expect(AUTO_SPEAK).toContain('rememberDeclined(declinedRef.current, current.id)')
    expect(AUTO_SPEAK).toContain('declined: Boolean(reply && declinedRef.current.has(reply.id))')
  })
})

describe('isaretci TOHUMLANIYOR', () => {
  it('acilistaki cevap OKUNMUS sayiliyor', () => {
    // Tohumlanmadan, sohbeti acar acmaz gecmisteki son cevap konusmaya
    // baslardi.
    expect(COMPOSER).toContain('const spokenMarker = ()')
    expect(COMPOSER).toContain('lastSpokenIdRef.current = { id: seeded, session: sessionId ?? null }')
  })

  it('OTURUM da tutuluyor', () => {
    // Isaretci tek basina oturumlar arasinda anlamsiz: baska bir sohbetin
    // kimligiyle karsilastirilan cevap her zaman "okunmamis" cikar.
    expect(COMPOSER).toContain('current.session === sessionId')
  })

  it('tohumlama EFEKT DEGIL, okumanin kendisinde', () => {
    // Atomdan ref'e efektle kopyalamak bir render geriden gelir (deponun
    // lint kurali da bunu yasakliyor) ve o bir render, gecmisteki cevabin
    // "okunmamis" gorunmesine yetiyordu.
    expect(COMPOSER).toContain('const spoken = spokenMarker()')
    expect(COMPOSER).not.toContain('lastSpokenIdRef.current = last?.id ?? null')
  })

  it('iki secici de AYNI isaretciyi okuyor', () => {
    // Ayri okumak, biri tohumlanmisken digerinin tohumsuz kalmasi olurdu.
    expect(COMPOSER).toContain('collectUnspokenTurnSpeech($messages.get(), spokenMarker())')
  })
})

describe('centik acikken sesin sahibi CENTIK', () => {
  it('centik oturum durumunu YAYINLIYOR', () => {
    expect(SHELL).toContain('setNotchVoiceActive(sessionActive)')
    // Centik giderse oncelik de gitmeli, yoksa besteci kalici olarak susardi.
    expect(SHELL).toContain('return () => setNotchVoiceActive(false)')
  })

  it('besteci oncelige UYUYOR', () => {
    expect(AUTO_SPEAK).toContain('if (notchVoiceIsActive()) {')
  })

  it('oncelik YARISI degil, YAZILI kural', () => {
    // Eskiden hangi yuzeyin once talep ettigi tura gore degisiyordu: besteci
    // kazandiginda centik akis acmiyor, cumle ilerleyisini duymuyor ve ALT
    // YAZI hic cikmiyordu.
    const branch = AUTO_SPEAK.slice(AUTO_SPEAK.indexOf('if (notchVoiceIsActive()) {'))

    expect(branch.slice(0, 300)).toContain('declineCurrent()')
    expect(branch.slice(0, 300)).toContain('streamRef.current = null')
  })
})
