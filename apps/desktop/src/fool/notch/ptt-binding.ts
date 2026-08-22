/**
 * Bas-konuş tuşunun bağlanması — saf, DOM'suz, sınanabilir.
 *
 * Neden atanabilir olmalı
 * -----------------------
 * Varsayılan sağ Ctrl çoğu makinede boş, ama hepsinde değil: bazı dizüstülerde
 * sağ Ctrl fiziksel olarak yok (Fn ya da menü tuşu yerini almış), bazı
 * kullanıcılar onu IME değiştirmeye ya da ekran okuyucuya bağlamış durumda.
 * O makinelerde bas-konuş HİÇ çalışmıyor ve sebebi görünmüyor — kullanıcı
 * notch'u açık görüp konuşuyor, hiçbir şey olmuyor.
 *
 * Neden ``code``, ``key`` değil
 * -----------------------------
 * ``code`` FİZİKSEL tuşu gösterir ve klavye düzeninden etkilenmez. ``key``
 * düzene göre değişiyor: Türkçe Q ile Türkçe F klavyede aynı fiziksel tuş
 * farklı ``key`` üretiyor, yani kullanıcı düzen değiştirdiğinde bağlama
 * sessizce bozulurdu. Değiştirici tuşlarda ayrıca bırakma sırasına göre
 * ``key`` farklı gelebiliyor.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

/** Varsayılan fiziksel tuş: sağ Ctrl. */
export const DEFAULT_PTT_CODE = 'ControlRight'

/**
 * Bağlanamayacak tuşlar.
 *
 * ``Escape`` ve ``Tab`` kullanıcının kaçış yolları: birine bas-konuş bağlamak,
 * paneli kapatmayı ya da odak gezinmesini bas-konuşa çevirir ve kullanıcı
 * bağlamayı geri almak için o tuşlara ihtiyaç duyar. ``Enter`` ve ``Space``
 * düğme etkinleştirme: yeniden bağlama ekranında kullanıcı düğmeye basarak
 * yakalamayı açtığı an aynı tuş yakalanırdı.
 */
const UNBINDABLE = new Set(['Enter', 'Escape', 'NumpadEnter', 'Space', 'Tab'])

/** Geçerli bir ``KeyboardEvent.code`` biçimi mi? */
const CODE_SHAPE = /^[A-Za-z][A-Za-z0-9]*$/

export function isBindableCode(code: unknown): code is string {
  return typeof code === 'string' && CODE_SHAPE.test(code) && !UNBINDABLE.has(code)
}

/**
 * Saklanan değeri güvene al.
 *
 * ``localStorage`` kullanıcının elinde: elle düzenlenmiş ya da eski bir
 * sürümden kalmış bir değer bas-konuşu sessizce ölü bırakırdı. Tanınmayan
 * her şey varsayılana düşüyor.
 */
export function sanitizePttCode(raw: unknown): string {
  return isBindableCode(raw) ? raw : DEFAULT_PTT_CODE
}

/** Bilinen tuşların insan okur adları. */
const NAMES: Record<string, string> = {
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  CapsLock: 'Caps Lock',
  ContextMenu: 'Menu',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  MetaLeft: 'Left Win',
  MetaRight: 'Right Win',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift'
}

/**
 * Kullanıcıya gösterilecek ad.
 *
 * ``ControlRight`` bir tanımlayıcı, arayüz metni değil. Ham hâlini göstermek
 * kullanıcıya hangi tuşa basacağını söylemiyor.
 */
export function formatPttCode(code: string): string {
  if (NAMES[code]) {
    return NAMES[code]
  }

  // ``KeyQ`` -> ``Q``, ``Digit7`` -> ``7``, ``F13`` -> ``F13``.
  const stripped =
    /^Key(?<letter>[A-Z])$/.exec(code)?.groups?.letter ?? /^Digit(?<digit>[0-9])$/.exec(code)?.groups?.digit

  return stripped ?? code
}
