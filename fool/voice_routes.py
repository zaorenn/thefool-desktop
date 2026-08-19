"""Ses modeli kataloğu ve kurulum uçları.

Zone A: bu dosyayı upstream bilmiyor. Tek temas noktası ``web_server.py``
içindeki bir satırlık ``include_router`` çağrısı (FOOL-SEAM: voice-routes).

Uçlar
-----
``GET  /api/fool/voice/catalog``      — öğeler ve kurulu olup olmadıkları
``POST /api/fool/voice/install``      — kurulumu başlat, iş kimliği döner
``GET  /api/fool/voice/job/{job_id}`` — canlı ilerleme
``POST /api/fool/voice/cancel``       — süren kurulumu iptal et

İlerleme neden SSE değil de yoklama ile
---------------------------------------
Kurulum dakikalarca sürebiliyor ve panel bu sırada kapanıp açılabiliyor. Akış
(SSE) bağlantısı koptuğunda ilerleme kaybolurdu; iş durumu sunucuda durduğu
için yoklama, paneli yeniden açan kullanıcıya süren kurulumu olduğu gibi
gösterir. Saniyede bir yoklama bu iş için fazlasıyla yeterli.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from fool import voice_models

router = APIRouter()


class InstallBody(BaseModel):
    entry_id: str
    device: Literal["cpu", "cuda"] = "cpu"


class SelectBody(BaseModel):
    entry_id: str


class DeviceBody(BaseModel):
    entry_id: str
    device: Literal["auto", "cpu", "cuda"]


class VoiceBody(BaseModel):
    entry_id: str
    voice: str


class CloneUploadBody(BaseModel):
    filename: str
    #: base64 gövde. Dosya köprüden geçtiği için ham bayt taşınamıyor.
    data_base64: str


class CloneSelectBody(BaseModel):
    entry_id: str
    #: "" = klonu kapat, motorun kendi sesine dön.
    clone_id: str = ""


class CloneDeleteBody(BaseModel):
    clone_id: str


class CancelBody(BaseModel):
    job_id: str


@router.get("/api/fool/voice/catalog")
async def voice_catalog() -> dict[str, Any]:
    items = voice_models.catalog_status()
    # Süren bir kurulum varsa öğeye iliştiriliyor: panel yeniden açıldığında
    # kullanıcı çubuğu kaldığı yerden görsün.
    for item in items:
        job = voice_models.active_job_for(item["id"])
        item["job"] = job.snapshot() if job else None
    return {
        "items": items,
        "voice_dir": str(voice_models.voice_dir()),
        "active": voice_models.active_providers(),
        "cuda_available": voice_models._cuda_available(),
    }


@router.post("/api/fool/voice/install")
async def voice_install(body: InstallBody) -> dict[str, Any]:
    try:
        return voice_models.start_install(body.entry_id, body.device)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/fool/voice/select")
async def voice_select(body: SelectBody) -> dict[str, Any]:
    try:
        return voice_models.select(body.entry_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class ModeProviderBody(BaseModel):
    mode: str
    provider: str = ""


@router.get("/api/fool/voice/modes")
async def voice_modes_route() -> dict[str, Any]:
    """Kip başına seçili seslendirme sağlayıcıları."""
    from fool.voice_modes import mode_provider, modes
    from fool_cli.config import load_config

    config = load_config() or {}
    return {
        "providers": {key: mode_provider(config, key) for key in modes()},
    }


@router.post("/api/fool/voice/modes")
async def voice_set_mode_provider(body: ModeProviderBody) -> dict[str, Any]:
    """Bir kipin sesini kaydet. Boş sağlayıcı = genel ayara dön."""
    from fool.voice_modes import modes
    from fool_cli.config import set_config_value

    mode = str(body.mode or "").strip().lower()
    if mode not in modes():
        raise HTTPException(status_code=400, detail=f"bilinmeyen kip: {body.mode}")

    set_config_value(f"voice.modes.{mode}.provider", str(body.provider or "").strip())
    return {"ok": True, "mode": mode, "provider": body.provider}


@router.post("/api/fool/voice/warm")
async def voice_warm() -> dict[str, Any]:
    """Konuşma tanıma modelini arka planda yükle.

    Sesli oturum AÇILDIĞI anda çağrılıyor. Ölçüldü (12,18 sn gerçek konuşma,
    Whisper large-v3-turbo float16, RTX 4070 Ti SUPER):

        ısıtmasız ilk transkripsiyon : 6,94 sn
        ısıtılmış ilk transkripsiyon : 0,66 sn

    O 6 saniye, kullanıcının zaten konuşmakla geçirdiği süreye gizleniyor.
    Yanıt HEMEN dönüyor; yükleme arka planda sürüyor.
    """
    from fool import stt_warmup

    return stt_warmup.warm()


@router.post("/api/fool/voice/preview")
async def voice_preview_route(body: SelectBody) -> dict[str, Any]:
    """Kısa bir cümle seslendir ve GEÇEN SÜREYİ de döndür.

    Süre bilerek gövdede: panelin "CUDA" yazması ile motorun gerçekten
    CUDA'da koşması ayrı şeyler ve fark ölçülebilir (Kokoro CUDA'da 0,08 sn,
    CPU'da saniyeler). Kullanıcı düğmeye basınca hem duyuyor hem görüyor.

    Sentez motoru yükleyebildiği için istek uzun sürebilir; zaman aşımını
    çağıran taraf yönetiyor.
    """
    from fool import voice_preview

    try:
        return voice_preview.preview(body.entry_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        # Sessizce basarisiz olan bir dinleme dugmesi, dugmenin bozuk olmasi.
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/api/fool/voice/device")
async def voice_device(body: DeviceBody) -> dict[str, Any]:
    try:
        return voice_models.set_device(body.entry_id, body.device)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/fool/voice/voice")
async def voice_set_voice(body: VoiceBody) -> dict[str, Any]:
    try:
        return voice_models.set_voice(body.entry_id, body.voice)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/fool/voice/cuda")
async def voice_cuda(body: SelectBody) -> dict[str, Any]:
    """CUDA calisma zamanini kur (arka planda is olarak)."""
    try:
        return voice_models.start_cuda_install(body.entry_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/fool/voice/clones")
async def voice_clones() -> dict[str, Any]:
    return {"clones": voice_models.list_clones()}


@router.post("/api/fool/voice/clones/upload")
async def voice_clone_upload(body: CloneUploadBody) -> dict[str, Any]:
    import base64
    import binascii

    try:
        raw = base64.b64decode(body.data_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"gecersiz veri: {exc}") from exc

    try:
        return voice_models.save_clone(body.filename, raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/fool/voice/clones/select")
async def voice_clone_select(body: CloneSelectBody) -> dict[str, Any]:
    try:
        return voice_models.set_clone(body.entry_id, body.clone_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/fool/voice/clones/delete")
async def voice_clone_delete(body: CloneDeleteBody) -> dict[str, Any]:
    return voice_models.delete_clone(body.clone_id)


@router.get("/api/fool/voice/job/{job_id}")
async def voice_job(job_id: str) -> dict[str, Any]:
    job = voice_models.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="is bulunamadi")
    return job.snapshot()


@router.post("/api/fool/voice/cancel")
async def voice_cancel(body: CancelBody) -> dict[str, Any]:
    return {"cancelled": voice_models.cancel_job(body.job_id)}
