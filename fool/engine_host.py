"""Kalıcı motor süreçleri — modeli bir kez yükle, açık tut.

Neden bu var
------------
İlk sidecar tasarımında her sentez çağrısı YENİ bir Python süreci
başlatıyordu: süreç torch'u içe aktarıyor (~5-10 sn), modeli diskten
yüklüyor (~10-40 sn), tek cümleyi sentezliyor ve ölüyordu. Sonraki cümlede
her şey baştan — hiçbir şey önbellekte kalmıyor, çünkü önbelleği tutacak
süreç yok.

Ölçüldü (Kokoro, 82M parametre, beş kelimelik cümle, CUDA):

    1. çağrı   48,7 sn
    2. çağrı   21,4 sn

Aynı model kalıcı bir süreçte saniyenin altında çalışıyor. Yani gecikmenin
neredeyse tamamı model yüklemeydi, sentez değil. Kullanıcının "CUDA'ya
rağmen aşırı yavaş" şikâyetinin tek sebebi buydu.

Protokol
--------
stdin/stdout üzerinde satır başına bir JSON. Basitliği kasıtlı: bir soket
port çakışması, erişim denetimi ve temizlik sorunları getirirdi — boru ise
süreçle birlikte kendiliğinden ölüyor.

stdout kirliliği
----------------
Motor kütüphaneleri açılışta stdout'a yazıyor (ilerleme çubukları, uyarılar)
ve bu protokolü bozar. Kurulum boyunca stdout stderr'e yönlendiriliyor;
protokol yalnızca saklanan gerçek stdout'u kullanıyor.

Zone A: upstream bu dosyayı bilmiyor.
"""

from __future__ import annotations

import hashlib
import json
import logging
import subprocess
import threading
import time
from dataclasses import dataclass
from typing import Any, Final

logger = logging.getLogger(__name__)

from fool.sidecar import _isolated_env, sidecar_python

#: İlk istek model yüklemeyi de bekliyor; sonrakiler yalnızca sentezi.
BOOT_TIMEOUT_SECONDS: Final = 600
REQUEST_TIMEOUT_SECONDS: Final = 300

#: Motoru saran koşucu. ``{setup}`` modeli yükler ve ``handle(req)`` tanımlar.
_RUNNER: Final = '''
import json
import sys

# Protokol icin GERCEK stdout saklaniyor; kurulum boyunca stdout stderr'e
# yonlendiriliyor cunku motor kutuphaneleri oraya ilerleme yaziyor.
_out = sys.stdout
sys.stdout = sys.stderr

# Kurulum EXEC ile calisiyor ki hatasi YAKALANABILSIN.
#
# Once dogrudan yazilmisti ve bir istisna stderr'e (DEVNULL) gidiyordu:
# ebeveyn yalnizca "surec oldu" goruyor, SEBEBI goremiyordu. Olculdu --
# F5-TTS'in "paylasilan FFmpeg kutuphaneleri gerekiyor" mesaji tamamen
# kayboluyor ve kullanici ham bir cokme ile bas basa kaliyordu.
#
# ``exec(..., globals())`` modul kapsamini koruyor: kurulumda tanimlanan
# ``handle`` ve ``global`` degiskenleri aynen calisiyor.
try:
    exec(compile({setup!r}, "<setup>", "exec"), globals())
except BaseException as _boot_exc:
    sys.stdout = _out
    _out.write(json.dumps({{"ready": False, "error": "%s: %s" % (type(_boot_exc).__name__, _boot_exc)}}) + "\\n")
    _out.flush()
    raise SystemExit(1)

sys.stdout = _out
_out.write(json.dumps({{"ready": True}}) + "\\n")
_out.flush()

for _line in sys.stdin:
    _line = _line.strip()
    if not _line:
        continue
    try:
        _req = json.loads(_line)
        sys.stdout = sys.stderr
        _result = handle(_req)
        sys.stdout = _out
        _payload = {{"ok": True, "result": _result}}
    except Exception as _exc:
        sys.stdout = _out
        _payload = {{"ok": False, "error": "%s: %s" % (type(_exc).__name__, _exc)}}
    _out.write(json.dumps(_payload) + "\\n")
    _out.flush()
'''


@dataclass
class _Engine:
    lock: threading.Lock
    process: subprocess.Popen
    setup_hash: str
    #: Son kullanim zamani -- VRAM tahliyesinde en eskisi once gidiyor.
    last_used: float = 0.0


_ENGINES: dict[str, _Engine] = {}
_ENGINES_LOCK = threading.Lock()

#: Ayni anda ayakta tutulacak EN FAZLA motor sayisi.
#:
#: FOOL-SEAM: engine-vram-eviction
#:
#: Bir varsayilan degil, olculmus bir zorunluluk. Her motor modelini VRAM'e
#: yukluyor ve kalici surec oldugu icin HIC birakmiyordu. Bes TTS motoru +
#: whisper + LM Studio'daki 9B model ayni 16 GB kartta birikince olculen
#: sonuc su oldu:
#:
#:     nvidia-smi -> 15338 / 16376 MiB dolu, 724 MiB bos, 10 surec
#:
#: O noktadan sonra her sey bozuluyor: sentez saniyelerce takiliyor, panelde
#: "Speaking..." donuyor, cogu zaman hic ses cikmiyor. Kullaniciya "TTS
#: calismiyor" diye gorunen sey buydu -- tek tek her motor calisiyor, hepsi
#: birlikte hicbiri calismiyor.
#:
#: Seslendirme SIRALI: ayni anda iki motor konusmuyor. Birden fazlasini
#: ayakta tutmanin tek etkisi VRAM'i tuketmek.
MAX_RESIDENT_ENGINES = 1

#: Bosta kalan bir motor bu sureden sonra kendiliginden bosaltiliyor.
#:
#: Bes dakika bilincli: bir sohbet turu arasindan cok uzun (yeniden yukleme
#: bedelini her cumlede odemeyelim), ama kullanici baska ise gectiginde
#: karti sonsuza kadar tutmayacak kadar kisa. ``fool/gpu_budget.py``deki
#: konusma tanima esigiyle ayni buyukluk.
IDLE_UNLOAD_SECONDS = 300.0


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def _evict_for(name: str) -> list[str]:
    """FOOL-SEAM: engine-vram-eviction

    Yeni bir motora yer ac: EN ESKI kullanilan motorlari durdur.

    Iki kosuldan biri yeterli:

    * Ayakta duran motor sayisi ``MAX_RESIDENT_ENGINES``i asiyor, ya da
    * kartta yer kalmadi (``fool/gpu_budget.py`` olcuyor).

    Ikinci kosul ilkinden bagimsiz olarak gerekiyor: iki motor bile kartta
    yer birakmayabilir (Chatterbox ~3,5 GB, Kyutai ~3,5 GB ve kartta zaten
    LM Studio'nun 9B modeli var).

    Durdurulan motor bir sonraki kullanimda yeniden yukleniyor -- bedeli
    olculdu ve kabul edilebilir (Kokoro 8 sn, StyleTTS 2 19 sn ilk cagri).
    Alternatif, hicbirinin calismamasi.
    """
    with _ENGINES_LOCK:
        # KULLANIMDA olan motor asla tahliye edilmiyor: kilidi tutulan bir
        # motoru durdurmak, suren bir sentezi ortasindan kesmek demek --
        # kullanici cumlenin yarisini duyar ve sebebini goremez.
        others = [
            (n, e.last_used)
            for n, e in _ENGINES.items()
            if n != name and not e.lock.locked()
        ]

    if not others:
        return []

    others.sort(key=lambda item: item[1])
    victims: list[str] = []

    # 1) Sayi siniri.
    overflow = (len(others) + 1) - MAX_RESIDENT_ENGINES
    while overflow > 0 and others:
        victims.append(others.pop(0)[0])
        overflow -= 1

    # 2) Bellek siniri. Sonda cokerse tahliye ETMIYORUZ: olcemedigimiz bir
    #    durumda calisan motorlari durdurmak, cozdugunden cok sorun uretir.
    try:
        from fool.gpu_budget import fits_in_vram, free_vram_mb

        free = free_vram_mb()
        while others and free is not None and not fits_in_vram(name, free):
            victim = others.pop(0)[0]
            victims.append(victim)
            # Durdurup YENIDEN olcuyoruz: tahmin etmek yerine karta sormak.
            _stop_locked(victim)
            free = free_vram_mb()
    except Exception as exc:  # pragma: no cover
        logger.debug("VRAM tahliyesi atlandi: %s", exc)

    for victim in victims:
        _stop_locked(victim)

    if victims:
        logger.info(
            "[The Fool] %s icin yer acildi; durdurulan motor(lar): %s",
            name, ", ".join(dict.fromkeys(victims)),
        )
    return victims


def _idle_sweep() -> list[str]:
    """FOOL-SEAM: engine-vram-eviction

    ``IDLE_UNLOAD_SECONDS``dan uzun sure kullanilmayan motorlari bosalt.

    KULLANIMDA olan motor sayilmiyor: kilidi tutulan bir surec suren bir
    sentezin ortasinda ve onu durdurmak cumleyi yarida kesmek demek.

    Neden bir izleyici gerekiyor: tahliye yalnizca YENI bir motor
    istendiginde caliyor. Kullanici konusmayi birakip baska ise gecerse
    hicbir istek gelmiyor ve son motor karti sonsuza kadar tutuyordu.
    """
    now = time.monotonic()

    with _ENGINES_LOCK:
        stale = [
            name
            for name, engine in _ENGINES.items()
            if not engine.lock.locked() and now - engine.last_used >= IDLE_UNLOAD_SECONDS
        ]

    for name in stale:
        _stop_locked(name)

    if stale:
        logger.info(
            "[The Fool] %.0f sn bosta kalan motor(lar) bosaltildi: %s",
            IDLE_UNLOAD_SECONDS, ", ".join(stale),
        )
    return stale


_IDLE_THREAD: threading.Thread | None = None
_IDLE_THREAD_LOCK = threading.Lock()


def _ensure_idle_watcher() -> None:
    """Bosta-bosaltma izleyicisini calistir (tek, uzun omurlu, daemon)."""
    global _IDLE_THREAD

    with _IDLE_THREAD_LOCK:
        if _IDLE_THREAD is not None and _IDLE_THREAD.is_alive():
            return

        def _loop() -> None:
            while True:
                time.sleep(min(30.0, IDLE_UNLOAD_SECONDS / 4))
                try:
                    _idle_sweep()
                except Exception as exc:  # pragma: no cover
                    logger.debug("bosta tarama atlandi: %s", exc)

        _IDLE_THREAD = threading.Thread(
            target=_loop, name="fool-engine-idle", daemon=True
        )
        _IDLE_THREAD.start()


def _stop_locked(name: str) -> None:
    """``stop`` ama zaten durdurulmus olmasi sorun degil."""
    try:
        stop(name)
    except Exception as exc:  # pragma: no cover
        logger.debug("motor %s durdurulamadi: %s", name, exc)


def _spawn(name: str, setup: str) -> _Engine:
    python = sidecar_python(name)
    if not python.exists():
        raise RuntimeError(f"{name} sidecar ortami kurulu degil")

    process = subprocess.Popen(
        [str(python), "-u", "-c", _RUNNER.format(setup=setup)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        # stderr YUTULUYOR: motorlar oraya yuzlerce satir uyari yaziyor ve
        # okunmayan bir boru dolunca surec KILITLENIR.
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        env=_isolated_env(),
        errors="replace",
    )

    # Hazır işaretini bekle: model yüklenmeden gönderilen bir istek
    # "motor çöktü" gibi görünürdü.
    deadline = time.monotonic() + BOOT_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"{name}: motor sureci acilista coktu")

        line = process.stdout.readline() if process.stdout else ""
        if not line:
            continue

        try:
            payload = json.loads(line)
        except ValueError:
            # Protokol öncesi kaçak satır — yoksay, beklemeye devam et.
            continue

        if payload.get("ready"):
            return _Engine(lock=threading.Lock(), process=process, setup_hash=_hash(setup))

        # Kurulum SEBEBIYLE dustu: sebebi yukari tasi. Ham bir "surec coktu"
        # kullaniciyi hicbir yere goturmuyordu.
        if "error" in payload:
            process.kill()
            raise RuntimeError(f"{name}: {payload['error']}")

    process.kill()
    raise RuntimeError(f"{name}: motor {BOOT_TIMEOUT_SECONDS} sn icinde hazir olmadi")


def stop(name: str) -> None:
    """Çalışan motoru durdur. Idempotent."""
    with _ENGINES_LOCK:
        engine = _ENGINES.pop(name, None)

    if engine is None or engine.process.poll() is not None:
        return

    try:
        if engine.process.stdin:
            engine.process.stdin.close()
        engine.process.wait(timeout=5)
    except Exception:
        engine.process.kill()


def stop_all() -> None:
    with _ENGINES_LOCK:
        names = list(_ENGINES)
    for name in names:
        stop(name)


def is_running(name: str) -> bool:
    with _ENGINES_LOCK:
        engine = _ENGINES.get(name)
    return engine is not None and engine.process.poll() is None


def request(name: str, setup: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Motora bir istek gönder; gerekiyorsa önce başlat.

    ``setup`` değişirse (başka bir model ya da aygıt seçildi) süreç yeniden
    başlatılıyor: ayakta duran süreç ESKİ modeli tutuyor ve sessizce yanlış
    sesle cevap verirdi — sessiz yanlışlık, görünür hatadan kötüdür.
    """
    setup_hash = _hash(setup)

    with _ENGINES_LOCK:
        engine = _ENGINES.get(name)
        stale = engine is not None and (
            engine.setup_hash != setup_hash or engine.process.poll() is not None
        )

    if stale:
        stop(name)
        engine = None

    if engine is None:
        # FOOL-SEAM: engine-vram-eviction -- yer ACMADAN once yukleme yapma.
        _evict_for(name)
        engine = _spawn(name, setup)
        with _ENGINES_LOCK:
            _ENGINES[name] = engine

    engine.last_used = time.monotonic()
    _ensure_idle_watcher()

    # Tek sürece aynı anda iki istek giderse cevaplar birbirine karışır:
    # protokol satır sıralı ve hangi cevabın hangi isteğe ait olduğunu
    # ayırt edecek bir kimlik taşımıyor.
    with engine.lock:
        if engine.process.poll() is not None:
            stop(name)
            raise RuntimeError(f"{name}: motor sureci kapandi")

        try:
            engine.process.stdin.write(json.dumps(payload) + "\n")  # type: ignore[union-attr]
            engine.process.stdin.flush()  # type: ignore[union-attr]
            line = engine.process.stdout.readline()  # type: ignore[union-attr]
        except (BrokenPipeError, OSError) as exc:
            stop(name)
            raise RuntimeError(f"{name}: motorla iletisim koptu: {exc}") from exc

        # Istek BITTIGINDE de tazeleniyor: uzun bir sentez sirasinda
        # baslangic damgasi eskiyor ve motor is biter bitmez "bosta"
        # sayilabiliyordu.
        engine.last_used = time.monotonic()

    if not line:
        stop(name)
        raise RuntimeError(f"{name}: motor cevap vermeden kapandi")

    try:
        reply = json.loads(line)
    except ValueError as exc:
        stop(name)
        raise RuntimeError(f"{name}: motordan bozuk cevap geldi") from exc

    if not reply.get("ok"):
        raise RuntimeError(f"{name}: {reply.get('error') or 'bilinmeyen hata'}")

    return reply.get("result") or {}
