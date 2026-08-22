/**
 * Yalnızca ANA pencerede koş.
 *
 * Çentik ayrı bir ``BrowserWindow`` ama AYNI paketi yüklüyor (``?win=notch``,
 * bkz. ``electron/fool-notch.ts`` ve ``app/contrib/controller.tsx``). Yani içe
 * aktarma anında yan etkisi olan her modül İKİ KEZ koşuyor.
 *
 * Değer pencereye özelse zararsız. PAYLAŞILAN bir yere yazılıyorsa -- ana
 * süreç ya da pencereler arası bir atom -- çentiğin boş kopyası ana pencerenin
 * gerçeğini eziyor. İki kez yaşandı:
 *
 *   ``$voiceSessionId``  ses yanlış oturuma gitti, cevap bot panelinde çıktı
 *   ``setActiveWork``    çıkış muhafızı süren turu görmedi, akış kısıldı
 *
 * Yardımcı ORTAK çünkü her yayıncının kendi guard'ını yazması, birinin
 * unutması demek -- ve unutulan tam olarak yukarıdaki iki hatadır.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

let mainWindow: boolean | null = null

/**
 * ``fn`` yalnızca ana pencerede çalışır.
 *
 * Karar SENKRON verilemiyor (``isNotchWindow`` çentik modülünde ve onu
 * statik içe aktarmak depo katmanını arayüz katmanına bağlardı), o yüzden
 * dinamik. Çağıran taraf abonelikleri hemen kurup bayrağı okuyor.
 */
export function whenMainWindow(fn: () => void): void {
  if (typeof window === 'undefined') {
    return
  }

  if (mainWindow !== null) {
    if (mainWindow) {
      fn()
    }

    return
  }

  void import('@/fool/notch/window').then(({ isNotchWindow }) => {
    mainWindow = !isNotchWindow()

    if (mainWindow) {
      fn()
    }
  })
}
