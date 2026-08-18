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
    #: ``tts.provider`` / ``stt.provider`` yapılandırmasına yazılan ad.
    #:
    #: Katalog kimliğinden AYRI tutuluyor çünkü ikisi farklı şeyler: kimlik
    #: indirilen paketi, bu ad ise ajanın konuşurken kullandığı sağlayıcıyı
    #: gösteriyor (``qwen3-tts`` indirilir, ``qwen3`` seçilir). Boş bırakılırsa
    #: kimliğin kendisi kullanılır.
    provider_id: str = ""
    #: ``tools.lazy_deps`` grubu; motor paketi bundan kurulur.
    dep_group: str | None = None
    #: Bu öğeyi "kurulu" sayan Python modülü.
    probe_module: str | None = None
    #: CUDA için ek paket grubu (varsa).
    cuda_group: str | None = None
    devices: tuple[Device, ...] = ("cpu",)
    #: Doluysa motor ANA ortama DEGIL, kendi izole ortamina kurulur.
    #: Gerekce ``fool/sidecar.py`` basliginda olculerek anlatildi: bu
    #: motorlarin ucu de paylasilan paketleri geriye dusuruyor (biri bir CVE
    #: duzeltmesini, biri Hindsight'i kiriyor).
    sidecar_specs: tuple[str, ...] = ()
    #: CUDA icin ana kurulumdan SONRA uygulanan paketler ve indeksleri.
    sidecar_cuda_specs: tuple[str, ...] = ()
    sidecar_cuda_index: str = ""
    #: PyPI'da olmayan, resmi URL'den gelen ek tekerlekler.
    sidecar_wheels: tuple[str, ...] = ()
    #: Paket kurulduktan SONRA agirliklari indiren Python parcasi.
    #:
    #: Neden gerekli: faster-whisper paketi model agirliklarini TASIMIYOR;
    #: ilk kullanimda sessizce indiriyor. Kullanici o an sadece "cok yavas"
    #: goruyor. Burada indirme kurulumun parcasi oluyor, yani ilerleme
    #: cubugunda gorunuyor.
    warmup: str = ""
    #: Isinma ve model kimligi icin kullanilan ad.
    model_id: str = ""
    #: Bu motorun SES listesi: (kimlik, aciklama).
    #:
    #: Sabit liste yalnizca kendi ses kumesi olan motorlar icin. Piper'in
    #: sesleri ayri ayri INEN dosyalar oldugu icin listesi diskten uretiliyor:
    #: inmemis bir sesi sunmak, secildiginde calisma aninda patlardi.
    voices: tuple[tuple[str, str], ...] = ()
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
        probe_module="kokoro",
        sidecar_specs=("kokoro==0.9.4", "soundfile==0.14.0"),
        sidecar_cuda_index="https://download.pytorch.org/whl/cu126",
        voices=(
            ("af_heart", "Amerikan kadin - sicak"),
            ("af_bella", "Amerikan kadin - berrak"),
            ("af_nicole", "Amerikan kadin - yumusak"),
            ("am_michael", "Amerikan erkek - dengeli"),
            ("am_puck", "Amerikan erkek - canli"),
            ("bf_emma", "Ingiliz kadin"),
            ("bm_george", "Ingiliz erkek"),
        ),
        # Kokoro spaCy'nin ``en_core_web_sm`` modelini istiyor ve o PyPI'da
        # YOK. Bu adim olmadan motor kuruluyor ama ilk sentezde E050 veriyor.
        sidecar_wheels=(
            "https://github.com/explosion/spacy-models/releases/download/"
            "en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl",
        ),
        devices=("cpu", "cuda"),
        size_label="~1,3 GB",
    ),
    VoiceEntry(
        id="chatterbox",
        label="Chatterbox",
        kind="tts",
        summary=(
            "The most realistic option, and it can clone voices. The cost is "
            "weight: it wants CUDA to run smoothly."
        ),
        probe_module="chatterbox",
        sidecar_specs=("chatterbox-tts==0.1.7", "soundfile==0.14.0"),
        sidecar_cuda_index="https://download.pytorch.org/whl/cu126",
        devices=("cpu", "cuda"),
        size_label="~3 GB",
    ),
    VoiceEntry(
        id="qwen3-tts",
        label="Qwen3-TTS",
        kind="tts",
        summary=(
            "Alibaba'nin cok dilli modeli: 9 konusmaci, 10 dil (Ingilizce, "
            "Almanca, Fransizca, Ispanyolca, Italyanca, Portekizce, Rusca, "
            "Cince, Japonca, Korece). TURKCE DESTEKLENMIYOR."
        ),
        provider_id="qwen3",
        probe_module="qwen_tts",
        # Ana ortama KURULAMAZ: transformers==4.57.3 huggingface-hub'i
        # 1.27.0 -> 0.36.2'ye dusuruyor ve lazy_deps.py bunun Hindsight'i
        # cokerttigini (#60783) yaziyor. Kendi ortamina kuruluyor.
        sidecar_specs=("qwen-tts==0.1.1",),
        # Modelin ``get_supported_speakers()`` ciktisindan alindi, tahmin degil.
        voices=(
            ("ryan", "Dengeli erkek"),
            ("serena", "Berrak kadin"),
            ("aiden", "Genc erkek"),
            ("dylan", "Alcak, sakin erkek"),
            ("eric", "Anlati tonu"),
            ("vivian", "Sicak kadin"),
            ("ono_anna", "Japonca'da dogal kadin"),
            ("sohee", "Korece'de dogal kadin"),
            ("uncle_fu", "Cince'de olgun erkek"),
        ),
        # PyPI'nin Windows torch tekerlegi CPU-only. Gercek CUDA derlemesi
        # yalnizca PyTorch'un kendi indeksinde; olculdu: CPU'da kisa bir
        # cumle 7.8 saniye surdu.
        sidecar_cuda_index="https://download.pytorch.org/whl/cu126",
        devices=("cpu", "cuda"),
        size_label="~3 GB",
    ),
    VoiceEntry(
        id="whisper-turbo",
        label="Whisper Large-v3 Turbo",
        kind="stt",
        summary=(
            "En iyi yerel konusma tanima. Turkce ve Ingilizce dahil 99 dil, "
            "large-v3'un dogruluguna yakin ama belirgin sekilde hizli."
        ),
        dep_group="stt.faster_whisper",
        probe_module="faster_whisper",
        model_id="large-v3-turbo",
        warmup=(
            "from faster_whisper import WhisperModel; "
            "WhisperModel('large-v3-turbo', device='cpu', compute_type='int8')"
        ),
        devices=("cpu", "cuda"),
        size_label="~1,6 GB",
        recommended=True,
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

    # Isinmasi olan oge icin AGIRLIKLAR da inmis olmali. Yalnizca pakete
    # bakmak "kurulu" derdi ama ilk konusmada model sessizce inmeye baslar ve
    # kullanici sadece "cok yavas" gorur -- panelin tam kacinmasi gereken sey.
    if e.warmup and e.model_id and not _weights_present(e.model_id):
        engine_ok = False
    elif e.sidecar_specs:
        # Sidecar'li motor ANA ortamda asla gorunmez; orada aramak her zaman
        # "kurulu degil" derdi.
        from fool import sidecar as _sidecar

        engine_ok = _sidecar.is_ready(e.id, e.probe_module)
    else:
        engine_ok = _module_available(e.probe_module) if e.probe_module else True
    assets_ok = all(asset_present(a) for a in e.assets)
    return {
        "id": e.id,
        "provider_id": e.provider_id or e.id,
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


def _weights_present(model_id: str) -> bool:
    """HuggingFace onbelleginde model agirliklari var mi?

    faster-whisper agirliklari ``Systran/faster-whisper-<model>`` altinda
    tutuyor. Dizin varligi degil, ICINDE gercek bir dosya olup olmadigi
    kontrol ediliyor: yarida kesilen bir indirme bos dizin birakiyor.
    """
    from pathlib import Path as _Path

    root = _Path.home() / ".cache" / "huggingface" / "hub"
    for pattern in (f"models--Systran--faster-whisper-{model_id}", f"models--*{model_id}*"):
        for candidate in root.glob(pattern):
            if any(f.is_file() and f.stat().st_size > 1_000_000 for f in candidate.rglob("*")):
                return True
    return False


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


def active_providers() -> dict[str, str]:
    """Su an SECILI olan TTS/STT saglayicilari.

    Panel bunu gostermeden kullanici hangi modelin konustugunu bilemiyordu:
    dort model "kurulu" yaziyor, hangisinin aktif oldugu hicbir yerde yok.
    """
    try:
        from fool_cli.config import load_config

        cfg = load_config() or {}
    except Exception:
        return {"stt": "", "tts": ""}

    tts = str((cfg.get("tts") or {}).get("provider") or "")
    stt_cfg = cfg.get("stt") or {}
    stt = str(stt_cfg.get("provider") or "")
    # Yerel STT'de asil kimlik MODEL: "local" dort farkli whisper boyutu
    # olabiliyor ve panel hangisini gosterecegini bilemez.
    if stt == "local":
        stt = str((stt_cfg.get("local") or {}).get("model") or "local")
    return {"stt": stt, "tts": tts}


def select(entry_id: str) -> dict[str, Any]:
    """Bu ogeyi AKTIF saglayici yap."""
    e = entry(entry_id)
    if e is None:
        raise ValueError(f"bilinmeyen oge: {entry_id}")
    if not status(entry_id).get("installed"):
        raise ValueError(f"{e.label} kurulu degil")

    from fool_cli.config import set_config_value

    if e.kind == "tts":
        set_config_value("tts.provider", e.provider_id or e.id)
    else:
        # Yerel whisper: saglayici "local", asil secim model boyutu.
        set_config_value("stt.provider", "local")
        set_config_value("stt.local.model", e.model_id or "base")
        # Dil OTOMATIK kalmali: sabitlemek baska dilde konusmayi bozuyor.
        set_config_value("stt.local.language", "")

    return {"ok": True, "active": active_providers()}


def device_key(e: VoiceEntry) -> str:
    """Bu ogenin cihaz ayarinin yapilandirmadaki yeri."""
    if e.kind == "stt":
        return "stt.local.device"
    return f"tts.{e.provider_id or e.id}.device"


def current_device(e: VoiceEntry) -> str:
    """Secili cihaz: ``auto`` | ``cpu`` | ``cuda``."""
    try:
        from fool_cli.config import load_config

        cfg = load_config() or {}
    except Exception:
        return "auto"

    node: Any = cfg
    for part in device_key(e).split("."):
        node = (node or {}).get(part) if isinstance(node, dict) else None
    value = str(node or "auto").strip().lower()
    return value if value in ("auto", "cpu", "cuda") else "auto"


def set_device(entry_id: str, device: str) -> dict[str, Any]:
    """Ogenin CALISMA cihazini ayarla.

    Kurulum sirasindaki secimden AYRI: kurulum hangi paketin inecegini
    belirler, bu ise modelin her calismada nerede kosacagini. Ikisini tek
    dugmeye baglamak, kurduktan sonra cihaz degistirmeyi imkansiz kiliyordu.
    """
    e = entry(entry_id)
    if e is None:
        raise ValueError(f"bilinmeyen oge: {entry_id}")
    if device not in ("auto", "cpu", "cuda"):
        raise ValueError(f"gecersiz aygit: {device}")

    from fool_cli.config import set_config_value

    set_config_value(device_key(e), device)

    # CUDA secildi ama ortam onu calistiramiyor: yalnizca yapilandirmaya
    # yazmak sessiz bir yalan olurdu. Gercek CUDA derlemesi kuruluyor.
    needs_runtime = device == "cuda" and bool(e.sidecar_specs) and not cuda_ready(e)

    return {"ok": True, "device": device, "needs_cuda_runtime": needs_runtime}


def available_voices(e: VoiceEntry) -> list[dict[str, str]]:
    """Bu motor icin SECILEBILIR sesler.

    Piper ozel: sesleri ayri ayri inen ``.onnx`` dosyalari, yani liste
    DISKTEN uretiliyor. Inmemis bir sesi sunmak secildiginde calisma aninda
    patlardi -- panelin tam kacinmasi gereken sey.
    """
    if e.id == "piper":
        try:
            return [
                {"id": f.stem, "label": f.stem}
                for f in sorted(voice_dir().glob("*.onnx"))
            ]
        except OSError:
            return []
    return [{"id": vid, "label": desc} for vid, desc in e.voices]


def current_voice(e: VoiceEntry) -> str:
    try:
        from fool_cli.config import load_config

        cfg = load_config() or {}
    except Exception:
        return ""
    node = ((cfg.get("tts") or {}).get(e.provider_id or e.id) or {})
    return str(node.get("voice") or "")


def set_voice(entry_id: str, voice: str) -> dict[str, Any]:
    """Motorun konusacagi sesi ayarla."""
    e = entry(entry_id)
    if e is None:
        raise ValueError(f"bilinmeyen oge: {entry_id}")

    valid = {v["id"] for v in available_voices(e)}
    if valid and voice not in valid:
        raise ValueError(f"{e.label} icin bilinmeyen ses: {voice}")

    from fool_cli.config import set_config_value

    set_config_value(f"tts.{e.provider_id or e.id}.voice", voice)
    return {"ok": True, "voice": voice}


def cuda_ready(e: VoiceEntry) -> bool:
    """Bu motor GERCEKTEN CUDA calistirabiliyor mu?

    Karti olmasi yetmiyor: sidecar'a PyPI'dan gelen torch Windows'ta CPU-only
    derlemedir. Yapilandirmaya ``device: cuda`` yazmak o durumda hicbir sey
    degistirmiyor -- motor sessizce CPU'ya dusuyor ve Chatterbox gibi agir bir
    model dakikalarca tek kelime uretmiyor.
    """
    if not e.sidecar_specs:
        return _cuda_available()

    from fool import sidecar as _sidecar

    return _sidecar.has_cuda_torch(e.id)


def install_cuda_runtime(entry_id: str) -> dict[str, Any]:
    """Sidecar'in torch'unu CUDA derlemesiyle degistir.

    Surum SABITLENMIYOR: her motorun kendi torch pini var (chatterbox 2.6.0,
    kokoro 2.13.0) ve ustune baska bir surum yazmak motoru bozar. Kurulu surum
    okunup AYNI surumun CUDA derlemesi isteniyor.
    """
    e = entry(entry_id)
    if e is None or not e.sidecar_specs:
        raise ValueError(f"{entry_id}: izole ortami yok")
    if not e.sidecar_cuda_index:
        raise ValueError(f"{e.label}: CUDA indeksi tanimli degil")

    from fool import sidecar as _sidecar

    version = _sidecar.installed_version(e.id, "torch")
    if not version:
        raise ValueError(f"{e.label}: torch kurulu degil")

    base = version.split("+")[0]

    # YEREL SURUM ETIKETI sart: ``torch==2.13.0`` kurulu ``2.13.0+cpu``i
    # KARSILIYOR sayiliyor ve uv hicbir sey yapmadan cikiyor (olculdu: 2 sn,
    # cuda hala False). CUDA derlemesi ancak ``+cu126`` ile isteniyor.
    tag = e.sidecar_cuda_index.rstrip("/").rsplit("/", 1)[-1]
    _sidecar.pip_install(
        e.id, (f"torch=={base}+{tag}",), index_url=e.sidecar_cuda_index, timeout=2400
    )
    return {"ok": True, "cuda_ready": cuda_ready(e)}


# ---------------------------------------------------------------------------
# Ses klonlari
# ---------------------------------------------------------------------------


def clone_dir() -> Path:
    """Kullanicinin surukleyip biraktigi referans kayitlari."""
    path = voice_dir() / "clones"
    path.mkdir(parents=True, exist_ok=True)
    return path


#: Klonlamayi DESTEKLEYEN motorlar. Digerleri sabit ses kumesiyle calisiyor ve
#: onlara referans kayit vermek sessizce yok sayilirdi -- kullanici sesini
#: yukleyip hicbir sey degismedigini gorurdu.
CLONE_CAPABLE: Final[frozenset[str]] = frozenset({"chatterbox"})

#: Kabul edilen bicimler. Chatterbox 5-10 saniyelik temiz bir kayitla calisiyor.
CLONE_SUFFIXES: Final[tuple[str, ...]] = (".wav", ".mp3", ".flac", ".m4a", ".ogg")


def list_clones() -> list[dict[str, Any]]:
    """Yuklenmis referans kayitlari."""
    try:
        entries = sorted(clone_dir().iterdir())
    except OSError:
        return []

    out: list[dict[str, Any]] = []
    for f in entries:
        if f.is_file() and f.suffix.lower() in CLONE_SUFFIXES:
            out.append({"id": f.name, "label": f.stem, "path": str(f), "bytes": f.stat().st_size})
    return out


def _safe_clone_name(name: str, suffix: str) -> str:
    """Dosya adini guvenli hale getir.

    Kullanicidan gelen ad dogrudan yola yazilirsa ``../`` ile dizin disina
    cikilabilir. Yalnizca sade karakterler birakiliyor.
    """
    import re

    stem = re.sub(r"[^A-Za-z0-9 _-]", "", pathlib_stem(name)).strip() or "ses"
    return f"{stem[:48]}{suffix}"


def pathlib_stem(name: str) -> str:
    return Path(name).stem


def save_clone(filename: str, data: bytes) -> dict[str, Any]:
    """Referans kaydi diske yaz."""
    suffix = Path(filename).suffix.lower()
    if suffix not in CLONE_SUFFIXES:
        raise ValueError(f"desteklenmeyen bicim: {suffix or '?'}")
    # 50 MB: 5-10 saniyelik bir kayit birkac yuz KB. Bunun ustu ya yanlis
    # dosya ya da kotu niyet.
    if len(data) > 50 * 1024 * 1024:
        raise ValueError("dosya cok buyuk (en fazla 50 MB)")
    if len(data) < 1024:
        raise ValueError("dosya cok kucuk ya da bos")

    target = clone_dir() / _safe_clone_name(filename, suffix)
    target.write_bytes(data)
    return {"ok": True, "id": target.name, "label": target.stem, "path": str(target)}


def delete_clone(clone_id: str) -> dict[str, Any]:
    # Ad yeniden guvenlestiriliyor: gelen deger dogrudan yola yazilmamali.
    target = clone_dir() / Path(clone_id).name
    if target.is_file():
        target.unlink()
    return {"ok": True}


def set_clone(entry_id: str, clone_id: str) -> dict[str, Any]:
    """Bir motorun klon referansini ayarla ("" = kapali)."""
    e = entry(entry_id)
    if e is None:
        raise ValueError(f"bilinmeyen oge: {entry_id}")
    if (e.provider_id or e.id) not in CLONE_CAPABLE:
        raise ValueError(f"{e.label} ses klonlamayi desteklemiyor")

    from fool_cli.config import set_config_value

    if not clone_id:
        set_config_value(f"tts.{e.provider_id or e.id}.voice_sample", "")
        return {"ok": True, "clone": ""}

    target = clone_dir() / Path(clone_id).name
    if not target.is_file():
        raise ValueError(f"klon bulunamadi: {clone_id}")

    set_config_value(f"tts.{e.provider_id or e.id}.voice_sample", str(target))
    return {"ok": True, "clone": target.name}


def current_clone(e: VoiceEntry) -> str:
    try:
        from fool_cli.config import load_config

        cfg = load_config() or {}
    except Exception:
        return ""
    node = ((cfg.get("tts") or {}).get(e.provider_id or e.id) or {})
    return Path(str(node.get("voice_sample") or "")).name


def catalog_status() -> list[dict[str, Any]]:
    active = active_providers()
    rows = []
    for e in CATALOG:
        row = status(e.id)
        key = e.model_id if (e.kind == "stt" and e.model_id) else (e.provider_id or e.id)
        row["active"] = active.get(e.kind, "") == key
        row["device"] = current_device(e)
        # GERCEK yetenek: yapilandirmada "cuda" yazmasi CUDA calistigi anlamina
        # gelmiyor. Sidecar'in torch'u CPU derlemesiyse motor sessizce CPU'ya
        # dusuyor ve kullanici yalnizca "cok yavas" goruyor.
        row["cuda_ready"] = cuda_ready(e)
        row["clone_capable"] = (e.provider_id or e.id) in CLONE_CAPABLE
        row["clone"] = current_clone(e) if row["clone_capable"] else ""
        row["voices"] = available_voices(e) if e.kind == "tts" else []
        row["voice"] = current_voice(e) if e.kind == "tts" else ""
        rows.append(row)
    return rows


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


def _run_warmup(e: VoiceEntry) -> None:
    """Model agirliklarini indir (ana yorumlayicida, alt surec olarak).

    Alt surec kasitli: indirme sirasinda ithal edilen agir moduller ana
    surecte kalmasin ve bir cokme paneli dusurmesin.
    """
    import subprocess
    import sys

    completed = subprocess.run(
        [sys.executable, "-c", e.warmup],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=1800,
        check=False,
    )
    if completed.returncode != 0:
        tail = (completed.stderr or completed.stdout or "").strip()
        last = tail.splitlines()[-1] if tail else "bilinmeyen hata"
        raise RuntimeError(f"model agirliklari indirilemedi: {last}")


def _install_sidecar(e: VoiceEntry, job: Job, base: float, span: float, device: Device = "cpu") -> None:
    """Motoru KENDI izole ortamina kur.

    Ilerleme yine uydurulmuyor: uv'nin cikti satirlari ``job.detail``e
    aktariliyor, yuzde ise ``_creep`` gibi asamayi asmayan bir tahmin.
    Kullanici en azindan hangi paketin indigini goruyor.
    """
    from fool import sidecar as _sidecar

    job.stage = "installing engine (isolated)"

    stop = threading.Event()

    def _creep() -> None:
        crept = 0.0
        while not stop.wait(0.5):
            crept = min(crept + span * 0.004, span * 0.9)
            job.percent = base + crept

    def _line(text: str) -> None:
        # uv satirlari uzun olabiliyor; arayuzde tek satira sigsin.
        job.detail = text[:90]

    ticker = threading.Thread(target=_creep, daemon=True)
    ticker.start()
    try:
        _sidecar.create(
            _sidecar.SidecarSpec(
                name=e.id,
                specs=e.sidecar_specs,
                probe_module=e.probe_module or "",
                cuda_specs=e.sidecar_cuda_specs,
                cuda_index_url=e.sidecar_cuda_index,
                extra_wheels=e.sidecar_wheels,
            ),
            on_output=_line,
            cuda=device == "cuda",
        )
    finally:
        stop.set()

    job.percent = base + span
    job.detail = ""


def _install_engine(e: VoiceEntry, device: Device, job: Job, base: float, span: float) -> None:
    if e.sidecar_specs:
        _install_sidecar(e, job, base, span, device)
        return

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

        if e.warmup:
            job.stage = "downloading model weights"
            job.detail = e.model_id
            _run_warmup(e)

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
