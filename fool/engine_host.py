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
import subprocess
import threading
import time
from dataclasses import dataclass
from typing import Any, Final

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


_ENGINES: dict[str, _Engine] = {}
_ENGINES_LOCK = threading.Lock()


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


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
        engine = _spawn(name, setup)
        with _ENGINES_LOCK:
            _ENGINES[name] = engine

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
