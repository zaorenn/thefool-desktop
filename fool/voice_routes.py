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


@router.get("/api/fool/voice/job/{job_id}")
async def voice_job(job_id: str) -> dict[str, Any]:
    job = voice_models.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="is bulunamadi")
    return job.snapshot()


@router.post("/api/fool/voice/cancel")
async def voice_cancel(body: CancelBody) -> dict[str, Any]:
    return {"cancelled": voice_models.cancel_job(body.job_id)}
