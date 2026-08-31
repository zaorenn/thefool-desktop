/**
 * Yapılandırılmış bir ev KÖR KÖRÜNE kabul edilemez.
 *
 * Ölçülen hasar
 * -------------
 * Masaüstünün ``test:desktop:fresh`` sınavı ``%TEMP%`` altındaki bir sandbox
 * eviyle ``install.ps1`` çalıştırdı ve o geçici yol KULLANICI kapsamlı
 * ``FOOL_HOME``a yazıldı. Test bitti, klasör silindi, değer kaldı.
 *
 * Uygulama o günden sonra her açılışta var olmayan bir dizine girdi: oturum
 * geçmişi yok, profil yok, ses klonu yok, "hiçbir TTS motoru kurulu değil",
 * modeller baştan iniyor. Kullanıcının bildirdiği: "girlfriend gitmiş, ses
 * klonlarım gitmiş, bütün sohbetlerim gitmiş." Hiçbiri silinmemişti -- ama
 * onun için farkı yoktu.
 *
 * Yazma tarafı artık korunuyor (``install.ps1``), ama BOZULMUŞ makineler
 * dışarıda duruyor. Yeni sürümü kurmak onları kendiliğinden iyileştirmeli --
 * bu testler o iyileştirmenin yerinde durduğunu tutuyor.
 *
 * Zone A: upstream bu dosyayı bilmiyor.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { test } from 'vitest'

const MAIN = readFileSync(join(__dirname, 'main.ts'), 'utf8')

test('gecici dizin altindaki ev REDDEDILIYOR', () => {
  // Geçici bir dizin kalıcı bir ev olamaz: var olsa bile işletim sistemi onu
  // istediği an siler.
  assert.ok(MAIN.includes('looksLikeDiscardedHome'))
  assert.ok(MAIN.includes('os.tmpdir()'))
  assert.ok(MAIN.includes('gecici dizin altinda'))
})

test('var olmayan ev, varsayilan ev DURURKEN reddediliyor', () => {
  assert.ok(MAIN.includes('dizin yok, varsayilan ev ise duruyor'))
})

test('KALICILASMIS deger kapidan geciyor, ortam degiskeni GECMIYOR', () => {
  // Hasar kalıcılaşmış bir değerden geldi: test bitti, klasör silindi, değer
  // kaldı ve her açılışı zehirledi.
  assert.ok(MAIN.includes("acceptConfiguredHome(fromRegistry, 'kullanici kapsamli')"))

  // Ortam değişkeni DOĞRULANMIYOR -- ve bunun sebebi ölçüldü: ilk yazımda o da
  // kapıdan geçiyordu, masaüstünün kendi `test:desktop:fresh` sınavı %TEMP%
  // altında bir sandbox evi kuruyor, kapı onu reddetti ve uygulama GERÇEK eve
  // düştü. Sınav artık hiçbir şey sınamıyordu.
  //
  // Bir sürecin o an verdiği değişken bu launch'a özel, bilinçli bir seçim.
  assert.ok(!MAIN.includes("acceptConfiguredHome(process.env.FOOL_HOME"))
  assert.ok(MAIN.includes('ORTAM DEGISKENI dogrulanmiyor'))
})

test('reddetme SESSIZ degil', () => {
  // Kullanıcı "verilerim neden geri geldi" sorusunu da cevaplayabilmeli.
  const gate = MAIN.slice(MAIN.indexOf('function acceptConfiguredHome'))

  assert.ok(gate.slice(0, 600).includes('console.warn'))
  assert.ok(gate.slice(0, 600).includes('yok sayildi'))
})

test('GECERLI bir ev hala kabul ediliyor', () => {
  // Kapı fazla hevesli olsaydı, gerçekten FOOL_HOME ayarlamış bir kullanıcının
  // yapılandırması yok sayılırdı -- aynı hatanın aynası.
  const gate = MAIN.slice(
    MAIN.indexOf('function acceptConfiguredHome'),
    MAIN.indexOf('function resolveHermesHome')
  )

  assert.ok(gate.includes('if (reason === null)'))
  assert.ok(gate.includes('return home'))
})

test('cozulemeyen temp icin sandbox IDDIA EDILMIYOR', () => {
  // Yanlış tarafa düşmek gerçek bir evi reddetmek olurdu.
  const fn = MAIN.slice(
    MAIN.indexOf('function looksLikeDiscardedHome'),
    MAIN.indexOf('function defaultHermesHome')
  )

  assert.ok(fn.includes('IDDIA YOK'))
})
