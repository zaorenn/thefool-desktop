/**
 * Pencereler arasında GERÇEKTEN paylaşılan kalıcı değer.
 *
 * Ölçülen hata
 * ------------
 * ``lib/persisted.ts::persistentAtom`` değeri ``localStorage``a YAZIYOR ama
 * başka bir pencerenin yazdığını hiç OKUMUYOR: tohum değerini yalnızca atom
 * yaratılırken bir kez alıyor ve ``storage`` olayını dinlemiyor. Dört fool
 * atomu da bunun tersini varsayıyordu ve yorumlarında öyle yazıyordu.
 *
 * Sonuç ölçüldü (jsdom, gerçek atom): ayarlar paneli ``pushToTalkCode``u
 * ``KeyQ`` yapıyor, depoda ``KeyQ`` yazıyor, notch penceresindeki atom
 * ``ControlRight`` kalıyor. Notch, pencere yeniden açılana kadar ESKİ tuşu
 * dinliyor.
 *
 * Kullanıcıya görünen hâli: ayarda tuşu değiştiriyorsun, notch'a basıyorsun,
 * hiçbir şey olmuyor. Aynısı kip seçimi için de geçerliydi -- panelde Jarvis
 * seçiliyken notch hâlâ arkadaş kipinde kalıyordu.
 *
 * Neden ``lib/persisted.ts`` düzeltilmedi
 * ---------------------------------------
 * Orası Zone C ve o atomu uygulamadaki HER kalıcı değer kullanıyor. Dışarıdan
 * gelen yazıyı topluca benimsetmek, bu davranışı beklemeyen depolarda (aynı
 * dosyadaki soğuk-önyükleme clobber notuna bakın) sessiz veri kaybı riski
 * taşıyor. Burada yalnızca paylaşılması GEREKEN fool atomları katılıyor.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import type { WritableAtom } from 'nanostores'

import { type Codec, persistentAtom } from '@/lib/persisted'

/**
 * Atomu, aynı anahtarı yazan DİĞER pencerelere bağla.
 *
 * Yankı yok: gelen değer atomdakiyle aynı kodlanıyorsa hiç yazılmıyor.
 * Yazsaydık, iki pencere birbirinin yazısını sonsuza kadar geri yollardı.
 */
export function adoptExternalWrites<T>(
  $value: WritableAtom<T>,
  key: string,
  fallback: T,
  codec: Codec<T>
): void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return
  }

  window.addEventListener('storage', event => {
    // ``key === null`` depo tamamen temizlendi demek; ilgisiz anahtarlar
    // için hiç uyanmiyoruz.
    if (event.key !== null && event.key !== key) {
      return
    }

    // Anahtar SİLİNDİYSE varsayılana dön: silinmiş bir anahtarı çözmeye
    // çalışmak bozuk girdiyle aynı şey.
    let incoming = fallback

    if (event.newValue !== null) {
      try {
        incoming = codec.decode(event.newValue)
      } catch {
        // Bozuk yazı: varsayilanla devam et, pencereyi kilitleme.
        incoming = fallback
      }
    }

    if (codec.encode(incoming) === codec.encode($value.get())) {
      return
    }

    $value.set(incoming)
  })
}

/**
 * "Bu değer pencereler arasında paylaşılıyor" demenin tek yolu.
 *
 * ``persistentAtom`` + dışarıdan gelen yazıyı benimseme, tek çağrıda. Ayrı
 * ayrı yazılabilirdi ama o zaman yeni bir paylaşılan değer eklerken dinleyiciyi
 * unutmak mümkün olurdu -- bu dosyanın var olma sebebi olan hata tam olarak
 * buydu.
 */
export function sharedAtom<T>(key: string, fallback: T, codec: Codec<T>): WritableAtom<T> {
  const $value = persistentAtom<T>(key, fallback, codec)

  adoptExternalWrites($value, key, fallback, codec)

  return $value
}
