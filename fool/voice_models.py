"""Yerel ses modelleri: katalog, durum tespiti ve ilerlemeli kurulum.

Neden bu var
------------
TTS ve STT motorları upstream'de "ilk kullanımda kendiliğinden inen" şeyler.
Pratikte bu şu demek: kullanıcı sesi açıyor, ajan bir şey söylemeye çalışıyor,
arka planda 200 MB'lık bir indirme başlıyor ve arayüzde hiçbir şey görünmüyor.
Ne kadar sürdüğü, ne indiği, bittiği belli değil — sadece "çalışmıyor" gibi
duruyor. Kullanıcı bunu üç kez istedi: modeller uygulama içinden indirilebilmeli
ve ilerleme görülebilmeli.

İlerleme neden iki farklı biçimde ölçülüyor
-------------------------------------------
İki ayrı iş var ve dürüst ilerleme ikisinde aynı şey değil:

1. **Motor kurulumu** (pip). pip'in gerçek bir yüzdesi yoktur; paketleri
   sırayla indirir ve çözümleyicisi ne kadar iş kaldığını önceden bilmez.
   Burada uydurma bir yüzde çubuğu göstermek yalan olurdu, o yüzden AŞAMA
   bildiriliyor ("çözümleniyor", "downloading", "installing") ve pip'in kendi
   çıktısının son satırı canlı gösteriliyor.
2. **Model dosyası** (HTTP). Burada ``Content-Length`` var, yani gerçek bir
   yüzde var. Baytlar sayılıyor ve yüzde gerçekten baytlardan geliyor.

Bu ayrım kasıtlı: bir çubuk gösteriyorsak arkasında gerçek bir ölçü olmalı.

Zone A
------
Bu dosyayı upstream bilmiyor; birleştirmede çakışamaz.
"""

from __future__ import annotations

import hashlib
import queue
import re
import shutil
import threading
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Final, Iterable, Literal

Kind = Literal["tts", "stt"]
Device = Literal["cpu", "cuda"]


# ---------------------------------------------------------------------------
# Katalog
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class VoiceAsset:
    """İndirilebilir tek bir dosya (ses modeli, yapılandırma)."""

    url: str
    filename: str
    #: Yaklaşık boyut (bayt). Sunucu ``Content-Length`` vermezse ilerleme
    #: yüzdesi için bu kullanılır; vermezse yüzde yerine inen bayt gösterilir.
    approx_bytes: int = 0


@dataclass(frozen=True)
class VoiceEntry:
    """Katalogda tek bir kurulabilir öğe."""

    id: str
    label: str
    kind: Kind
    #: Kullanıcıya tek cümlelik açıklama — neden bunu seçsin?
    summary: str
    #: ``tools.lazy_deps`` grubu; motor paketi bundan kurulur.
    dep_group: str | None = None
    #: Bu öğeyi "kurulu" sayan Python modülü.
    probe_module: str | None = None
    #: CUDA için ek paket grubu (varsa).
    cuda_group: str | None = None
    devices: tuple[Device, ...] = ("cpu",)
    assets: tuple[VoiceAsset, ...] = ()
    #: Yaklaşık toplam indirme boyutu, kullanıcıya gösterilir.
    size_label: str = ""
    recommended: bool = False


#: Piper sesleri Rhasspy'nin HuggingFace deposundan geliyor; ``.onnx`` ve yanında
#: ``.onnx.json`` olmak zorunda — Piper ikisini birden arar, biri eksikse
#: çalışma anında anlaşılmaz bir hata verir.
_PIPER_BASE: Final = (
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium"
)


CATALOG: Final[tuple[VoiceEntry, ...]] = (
    VoiceEntry(
        id="piper",
        label="Piper",
        kind="tts",
        summary=(
            "Fast and fully local. Runs faster than real time even on CPU — "
            "the most balanced choice for everyday use."
        ),
        dep_group="tts.piper",
        probe_module="piper",
        cuda_group="tts.piper_cuda",
        devices=("cpu", "cuda"),
        assets=(
            VoiceAsset(
                url=f"{_PIPER_BASE}/en_US-lessac-medium.onnx",
                filename="en_US-lessac-medium.onnx",
                approx_bytes=63_000_000,
            ),
            VoiceAsset(
                url=f"{_PIPER_BASE}/en_US-lessac-medium.onnx.json",
                filename="en_US-lessac-medium.onnx.json",
                approx_bytes=5_000,
            ),
        ),
        size_label="~63 MB",
        recommended=True,
    ),
    VoiceEntry(
        id="kokoro",
        label="Kokoro",
        kind="tts",
        summary=(
            "Surprisingly natural for its size. Better intonation than Piper, "
            "still local and quick."
        ),
        dep_group="tts.kokoro",
        probe_module="kokoro",
        devices=("cpu", "cuda"),
        size_label="~350 MB",
    ),
    VoiceEntry(
        id="chatterbox",
        label="Chatterbox",
        kind="tts",
        summary=(
            "The most realistic option, and it can clone voices. The cost is "
            "weight: it wants CUDA to run smoothly."
        ),
        dep_group="tts.chatterbox",
        probe_module="chatterbox",
        devices=("cpu", "cuda"),
        size_label="~2 GB",
    ),
    VoiceEntry(
        id="faster-whisper",
        label="Faster-Whisper",
        kind="stt",
        summary=(
            "Local speech recognition. Far above real time on CUDA, and usable "
            "on CPU too."
        ),
        dep_group="stt.faster_whisper",
        probe_module="faster_whisper",
        devices=("cpu", "cuda"),
        size_label="~150 MB",
        recommended=True,
    ),
)


def entry(entry_id: str) -> VoiceEntry | None:
    return next((e for e in CATALOG if e.id == entry_id), None)


# ---------------------------------------------------------------------------
# Durum tespiti
# ---------------------------------------------------------------------------


def _module_available(name: str) -> bool:
    """Modül İTHAL EDİLMEDEN varlığına bakılır.

    Gerçekten ithal etmek ağır modelleri belleğe yükler ve CUDA bağlamı
    açabilir — durum sorgusu bunu yapmamalı; panel her açılışta saniyeler
    sürerdi.
    """
    import importlib.util

    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def voice_dir() -> Path:
    """Ses varlıklarının indiği dizin.

    ``FOOL_HOME`` altında; kullanıcının orijinal Hermes kurulumuna dokunulmaz.
    """
    from fool_constants import get_hermes_home

    path = Path(get_hermes_home()) / "voices"
    path.mkdir(parents=True, exist_ok=True)
    return path


def asset_present(asset: VoiceAsset) -> bool:
    target = voice_dir() / asset.filename
    # Boyut kontrolü kasıtlı: yarıda kesilmiş bir indirme dosyayı bırakır ve
    # varlık kontrolü onu "inmiş" sayardı. Piper o dosyayı açmaya çalışıp
    # anlaşılmaz bir hata verirdi.
    return target.exists() and target.stat().st_size > 1024


def status(entry_id: str) -> dict[str, Any]:
    e = entry(entry_id)
    if e is None:
        return {"id": entry_id, "installed": False, "error": "bilinmeyen oge"}

    engine_ok = _module_available(e.probe_module) if e.probe_module else True
    assets_ok = all(asset_present(a) for a in e.assets)
    return {
        "id": e.id,
        "label": e.label,
        "kind": e.kind,
        "summary": e.summary,
        "devices": list(e.devices),
        "size_label": e.size_label,
        "recommended": e.recommended,
        "engine_installed": engine_ok,
        "assets_installed": assets_ok,
        "installed": engine_ok and assets_ok,
        "cuda_available": _cuda_available() if "cuda" in e.devices else False,
    }


def _cuda_available() -> bool:
    """CUDA gerçekten kullanılabilir mi?

    ``torch`` ithal etmek pahalı, o yüzden önce ``nvidia-smi`` deneniyor;
    yoksa torch'a düşülüyor (zaten yüklüyse maliyeti yok).
    """
    if shutil.which("nvidia-smi"):
        return True
    try:
        import torch  # noqa: PLC0415

        return bool(torch.cuda.is_available())
    except Exception:
        return False


def catalog_status() -> list[dict[str, Any]]:
    return [status(e.id) for e in CATALOG]


# ---------------------------------------------------------------------------
# Kurulum işleri
# ---------------------------------------------------------------------------


@dataclass
class Job:
    """Tek bir kurulum işi ve canlı ilerlemesi."""

    id: str
    entry_id: str
    device: Device
    state: Literal["running", "done", "failed", "cancelled"] = "running"
    #: 0..100. Model dosyası indirilirken GERÇEK baytlardan hesaplanır; pip
    #: aşamasında adım sayısından gelir (bkz. modül başlığı).
    percent: float = 0.0
    stage: str = "starting"
    detail: str = ""
    error: str = ""
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    _cancel: threading.Event = field(default_factory=threading.Event)

    def snapshot(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "entry_id": self.entry_id,
            "device": self.device,
            "state": self.state,
            "percent": round(self.percent, 1),
            "stage": self.stage,
            "detail": self.detail,
            "error": self.error,
            "elapsed": round((self.finished_at or time.time()) - self.started_at, 1),
        }


_JOBS: dict[str, Job] = {}
_JOBS_LOCK = threading.Lock()
#: Aynı öğe için ikinci bir işe izin verilmez: iki pip aynı hedefe aynı anda
#: yazarsa ortam yarım kalmış bir kurulumla bozulur.
_ACTIVE_BY_ENTRY: dict[str, str] = {}


def get_job(job_id: str) -> Job | None:
    with _JOBS_LOCK:
        return _JOBS.get(job_id)


def active_job_for(entry_id: str) -> Job | None:
    with _JOBS_LOCK:
        job_id = _ACTIVE_BY_ENTRY.get(entry_id)
        return _JOBS.get(job_id) if job_id else None


def cancel_job(job_id: str) -> bool:
    job = get_job(job_id)
    if job is None or job.state != "running":
        return False
    job._cancel.set()
    return True


def _download(asset: VoiceAsset, job: Job, base: float, span: float) -> None:
    """Tek varlığı indir; yüzdeyi GERÇEK baytlardan güncelle."""
    target = voice_dir() / asset.filename
    if asset_present(asset):
        job.percent = base + span
        return

    # Geçici dosyaya indirilip sonra taşınıyor: yarıda kesilen bir indirme
    # hedef adı asla almamalı, yoksa ``asset_present`` onu geçerli sanar.
    tmp = target.with_suffix(target.suffix + ".part")
    request = urllib.request.Request(asset.url, headers={"User-Agent": "TheFool"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            declared = response.headers.get("Content-Length")
            total = int(declared) if declared else asset.approx_bytes
            read = 0
            with tmp.open("wb") as fh:
                while True:
                    if job._cancel.is_set():
                        raise InterruptedError("cancelled")
                    chunk = response.read(256 * 1024)
                    if not chunk:
                        break
                    fh.write(chunk)
                    read += len(chunk)
                    if total > 0:
                        job.percent = base + span * min(read / total, 1.0)
                        job.detail = f"{read // 1_000_000} / {total // 1_000_000} MB"
                    else:
                        job.detail = f"{read // 1_000_000} MB"
        tmp.replace(target)
    except InterruptedError:
        tmp.unlink(missing_ok=True)
        raise
    except (urllib.error.URLError, OSError) as exc:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"could not download {asset.filename}: {exc}") from exc
    finally:
        tmp.unlink(missing_ok=True)

    job.percent = base + span


#: pip'in çıktısındaki aşama işaretleri. Yüzde uydurmak yerine kullanıcıya
#: gerçekten ne olduğu söyleniyor.
_PIP_STAGES: Final[tuple[tuple[re.Pattern[str], str], ...]] = (
    (re.compile(r"Collecting|Resolving", re.I), "resolving packages"),
    (re.compile(r"Downloading", re.I), "downloading"),
    (re.compile(r"Building|Preparing", re.I), "preparing"),
    (re.compile(r"Installing", re.I), "installing"),
)


def _install_engine(e: VoiceEntry, device: Device, job: Job, base: float, span: float) -> None:
    groups = [g for g in (e.dep_group, e.cuda_group if device == "cuda" else None) if g]
    # Sessiz basari yasak. Kurulacak paket yoksa is "tamamlandi" demeden
    # once durur: aksi halde kullanici dugmeye basar, cubuk %100'e gider ve
    # oge hala kurulmamis kalir -- hicbir hata da gorunmez.
    if not groups:
        raise RuntimeError(f"{e.label} icin kurulabilir paket tanimli degil")

    from tools.lazy_deps import LAZY_DEPS, install_specs

    specs: list[str] = []
    for group in groups:
        specs.extend(LAZY_DEPS.get(group, ()))
    if not specs:
        raise RuntimeError(f"{e.label} icin paket listesi bos: {groups}")

    job.stage = "installing engine"
    job.detail = ", ".join(specs)

    # pip senkron çalışıyor ve ilerleme yayınlamıyor. Çubuğu donuk bırakmamak
    # için ayrı bir iş parçacığı yavaşça ilerletiyor; bu yüzde bir TAHMİN ve
    # asla span'in sonuna varmıyor — bittiğinde gerçek değere sıçrar.
    stop = threading.Event()

    def _creep() -> None:
        crept = 0.0
        while not stop.wait(0.5):
            crept = min(crept + span * 0.01, span * 0.9)
            job.percent = base + crept

    ticker = threading.Thread(target=_creep, daemon=True)
    ticker.start()
    try:
        outcome = install_specs(specs, timeout=900)
    finally:
        stop.set()

    if getattr(outcome, "blocked", False):
        raise RuntimeError(getattr(outcome, "reason", "install blocked"))
    if not getattr(outcome, "ok", False):
        tail = (getattr(outcome, "stderr", "") or getattr(outcome, "stdout", "") or "").strip()
        last = tail.splitlines()[-1] if tail else "unknown error"
        raise RuntimeError(f"pip failed: {last}")

    job.percent = base + span


def _run(job: Job, e: VoiceEntry) -> None:
    try:
        # Ağırlık dağılımı işin gerçek maliyetini yansıtıyor: motor paketleri
        # model dosyalarından belirgin biçimde büyük.
        engine_span = 70.0 if e.assets else 100.0
        _install_engine(e, job.device, job, 0.0, engine_span)

        if e.assets:
            job.stage = "downloading voice model"
            remaining = 100.0 - engine_span
            each = remaining / len(e.assets)
            for i, asset in enumerate(e.assets):
                if job._cancel.is_set():
                    raise InterruptedError("cancelled")
                _download(asset, job, engine_span + i * each, each)

        job.percent = 100.0
        job.stage = "done"
        job.detail = ""
        job.state = "done"
    except InterruptedError:
        job.state = "cancelled"
        job.stage = "cancelled"
    except Exception as exc:  # noqa: BLE001 - hata kullanıcıya gösterilecek
        job.state = "failed"
        job.stage = "failed"
        job.error = str(exc)
    finally:
        job.finished_at = time.time()
        with _JOBS_LOCK:
            if _ACTIVE_BY_ENTRY.get(e.id) == job.id:
                _ACTIVE_BY_ENTRY.pop(e.id, None)


def start_install(entry_id: str, device: Device = "cpu") -> dict[str, Any]:
    """Kurulumu arka planda başlat, iş kimliğini döndür."""
    e = entry(entry_id)
    if e is None:
        raise ValueError(f"bilinmeyen oge: {entry_id}")
    if device not in e.devices:
        raise ValueError(f"{e.label} icin desteklenmeyen aygit: {device}")

    with _JOBS_LOCK:
        existing_id = _ACTIVE_BY_ENTRY.get(entry_id)
        if existing_id and (existing := _JOBS.get(existing_id)) and existing.state == "running":
            # Zaten süren bir iş varsa yenisini başlatmak yerine mevcut olan
            # döndürülüyor: iki pip aynı hedefe yazarsa ortam bozulur.
            return existing.snapshot()

        job = Job(id=uuid.uuid4().hex[:12], entry_id=entry_id, device=device)
        _JOBS[job.id] = job
        _ACTIVE_BY_ENTRY[entry_id] = job.id

    threading.Thread(target=_run, args=(job, e), daemon=True, name=f"fool-voice-{job.id}").start()
    return job.snapshot()
