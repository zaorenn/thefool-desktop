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
        # Secili motor OLCULMUS olarak yavassa panel bunu soylesin.
        # Olculdu: kyutai cumle basina 2,52 sn, kokoro 0,20 sn. Kullanici
        # "cevaplar nerdeyse realtime olmali" istedi ama en yavas motorda
        # kalmisti ve bunu hicbir yerden goremiyordu.
        "slow_engine": _slow_engine_hint(),
    }


def _slow_engine_hint() -> dict[str, Any] | None:
    """Secili motor icin "daha hizlisi var" ipucu (``None`` = yok).

    Hata YUTULUYOR: bir ipucu ugruna katalogu dusurmek, kullanicinin ses
    panelini tumden kaybetmesi olurdu.
    """
    try:
        from fool import voice_bench

        selected = voice_models.active_providers().get("tts") or ""
        found = voice_bench.faster_alternative(selected, voice_bench.load_results() or {})
        if not found:
            return None

        alternative, alt_ms, current_ms = found
        return {
            "alternative": alternative,
            "alternative_ms": alt_ms,
            "message": voice_bench.slow_engine_message(
                selected, alternative, alt_ms, current_ms
            ),
            "selected": selected,
            "selected_ms": current_ms,
        }
    except Exception:
        return None


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


# ``GET/POST /api/fool/voice/modes`` KALDIRILDI.
#
# Kip basina ses yazan uclardi ve yazdiklari anahtari artik HIC KIMSE
# okumuyor. Yazan ama okunmayan bir uc, hatanin geri buyumesi icin hazir bir
# yol: bir sonraki yuzey onu bulup "kip sesi" diye kullanmaya baslardi.
# Seslendirme motoru tek yerden seciliyor -- ``tts.provider``.


@router.post("/api/fool/voice/warm")
async def voice_warm() -> dict[str, Any]:
    """Konuşma tanıma VE seslendirme modellerini arka planda yükle.

    Sesli oturum AÇILDIĞI anda çağrılıyor. Ölçüldü (12,18 sn gerçek konuşma,
    Whisper large-v3-turbo float16, RTX 4070 Ti SUPER):

        ısıtmasız ilk transkripsiyon : 6,94 sn
        ısıtılmış ilk transkripsiyon : 0,66 sn

    O 6 saniye, kullanıcının zaten konuşmakla geçirdiği süreye gizleniyor.
    Yanıt HEMEN dönüyor; yükleme arka planda sürüyor.
    """
    from fool import stt_warmup, tts_warmup

    # Sesli oturum aciliyor: kart SESIN de kullandigi kart. Kullanilmayan bir
    # dil modeli orada durmasin.
    #
    # Olculdu (kullanicinin kartinda, 16 GB): gemma 6,33 GB + qwen 6,55 GB =
    # 12,88 GB, geriye ~3 GB. Gunluklerde sonucu goruluyordu:
    # ``[TTS/piper] device=cuda istendi ama CUDA bulunamadi``. Ikinci model
    # hic istenmedigi halde sesin GPU'sunu yiyordu.
    _free_unused_llms()

    # SESLENDIRME de isitiliyor. Olculdu: kokoro soguk 24,17 sn / sicak
    # 0,32 sn; styletts2 soguk 67,21 sn / sicak 0,86 sn. Kullanici bunu
    # "Friend modunda dakikalarca model uyandiriliyor" diye bildirdi -- oysa
    # ayarlardaki Listen dugmesi 2,5 sn'de konusuyordu, cunku orada motor
    # zaten sicakti.
    #
    # Ikisi AYRI is parcaciklarinda ve birbirini beklemiyor: STT ana surecte
    # torch yukluyor, TTS izole bir sidecar surecinde. Sirayla yapmak
    # kazancin yarisini geri verirdi.
    return {"stt": stt_warmup.warm(), "tts": tts_warmup.warm()}


def _free_unused_llms() -> None:
    """Secili olmayan dil modellerini bellekten birak (arka planda, sessizce).

    Hata YUTULUYOR ve is AYRI bir is parcaciginda: isitma ucu HEMEN donmeli.
    Bir bellek temizligi ugruna sesli oturumun acilisini bekletmek, tam olarak
    duzeltilmek istenen yavasligi geri getirirdi.
    """
    import threading

    def _run() -> None:
        try:
            from fool import lmstudio_residency
            from fool_cli.config import load_config

            model_cfg = (load_config() or {}).get("model") or {}
            keep = str(model_cfg.get("default") or model_cfg.get("model") or "").strip()
            base_url = str(model_cfg.get("base_url") or "http://localhost:1234/v1").strip()

            lmstudio_residency.enforce_single(base_url, keep)
        except Exception:
            pass

    threading.Thread(target=_run, daemon=True, name="fool-llm-residency").start()


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
