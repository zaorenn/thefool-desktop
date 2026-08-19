"""``cuda_ready`` sürücüyü değil MOTORU sormalı.

Bu deponun en pahalı hata sınıflarından biri: "cihaz ``cuda`` yazıyordu,
motor CPU'da koşuyordu". Panel güvenle CUDA gösteriyor, kullanıcı 15 saniye
bekliyor ve neden yavaş olduğunu hiçbir yerde göremiyor.

Kök neden ölçüldü: ``_cuda_available()`` yalnızca ``nvidia-smi``nin PATH'te
olup olmadığına bakıyordu -- yani NVIDIA SÜRÜCÜSÜ kurulu olan HER makinede
``True``. Sürücünün varlığı, çıkarım motorunun CUDA kullanabildiği anlamına
gelmiyor:

  * faster-whisper ``ctranslate2`` kullanıyor, torch değil. cuBLAS/cuDNN
    eksikse ``ctranslate2.get_cuda_device_count()`` 0 döner ve motor sessizce
    CPU'ya düşer -- 0,23 sn yerine 15,16 sn.
  * Sidecar motorlarında PyPI'dan gelen torch Windows'ta CPU-only derlemedir;
    kart da sürücü de yerinde ama motor CPU'da koşar.

Bu testler "kart var mı" ile "motor kullanabiliyor mu" arasındaki farkı
tutuyor.
"""

from __future__ import annotations

import pytest

from fool import voice_models as vm


def _entry(entry_id: str):
    e = vm.entry(entry_id)
    assert e is not None, f"katalogda {entry_id} yok"
    return e


# ---------------------------------------------------------------------------
# STT: ctranslate2 sorulmali
# ---------------------------------------------------------------------------

def test_stt_surucuye_degil_ctranslate2ye_soruyor(monkeypatch) -> None:
    """Sürücü kurulu ama ctranslate2 CUDA göremiyorsa cevap ``False``."""
    e = _entry("whisper-turbo")

    # Surucu yerinde: nvidia-smi PATH'te.
    monkeypatch.setattr(vm.shutil, "which", lambda name: "/usr/bin/nvidia-smi")
    # Ama motor goremiyor -- cuBLAS/cuDNN eksik.
    monkeypatch.setattr(vm, "_ctranslate2_cuda_devices", lambda: 0)

    assert vm.cuda_ready(e) is False


def test_stt_ctranslate2_gorunce_dogru_soyluyor(monkeypatch) -> None:
    """Motorun kendi cevabi KESIN -- ustune surucu sondasi konmuyor.

    ``nvidia-smi`` on elemesi eklemek, PATH'inde o ikili olmayan ama CUDA'si
    calisan kurulumlarda dogru cevabi yanlisa cevirirdi.
    """
    e = _entry("whisper-turbo")

    monkeypatch.setattr(vm.shutil, "which", lambda name: None)
    monkeypatch.setattr(vm, "_ctranslate2_cuda_devices", lambda: 1)

    assert vm.cuda_ready(e) is True


def test_ctranslate2_yoksa_cokmuyor(monkeypatch) -> None:
    """Motor hiç kurulu değilse cevap ``False``, istisna değil."""
    def _boom() -> int:
        raise ImportError("ctranslate2 yok")

    monkeypatch.setattr(vm, "_ctranslate2_cuda_devices", _boom)

    assert vm.cuda_ready(_entry("whisper-turbo")) is False


@pytest.mark.parametrize("entry_id", ["whisper-turbo", "faster-whisper"])
def test_butun_stt_girdileri_ayni_yolu_kullaniyor(entry_id: str, monkeypatch) -> None:
    monkeypatch.setattr(vm.shutil, "which", lambda name: "/usr/bin/nvidia-smi")
    monkeypatch.setattr(vm, "_ctranslate2_cuda_devices", lambda: 0)

    assert vm.cuda_ready(_entry(entry_id)) is False


# ---------------------------------------------------------------------------
# Sidecar motorlari: torch derlemesi sorulmali (mevcut davranis korunuyor)
# ---------------------------------------------------------------------------

def test_sidecar_motoru_kendi_torchunu_soruyor(monkeypatch) -> None:
    e = _entry("kokoro")
    assert e.sidecar_specs, "kokoro sidecar motoru olmali"

    from fool import sidecar as _sidecar

    monkeypatch.setattr(vm.shutil, "which", lambda name: "/usr/bin/nvidia-smi")
    monkeypatch.setattr(_sidecar, "has_cuda_torch", lambda entry_id: False)

    assert vm.cuda_ready(e) is False


# ---------------------------------------------------------------------------
# Genel kural
# ---------------------------------------------------------------------------

def test_piper_onnxruntimeye_soruyor(monkeypatch) -> None:
    """Piper torch degil ``onnxruntime`` kullaniyor.

    Bu makinede olculdu: saglayicilar
    ``['AzureExecutionProvider', 'CPUExecutionProvider']`` -- CUDA YOK. Eski
    kod ``nvidia-smi`` gordugu icin yine de "CUDA" diyordu ve panel Piper icin
    guvenle CUDA sunuyordu.
    """
    e = _entry("piper")
    assert e.cuda_probe == "onnxruntime"

    monkeypatch.setattr(vm.shutil, "which", lambda name: "/usr/bin/nvidia-smi")
    monkeypatch.setattr(vm, "_torch_cuda_available", lambda: True)
    monkeypatch.setattr(vm, "_onnxruntime_cuda_available", lambda: False)

    assert vm.cuda_ready(e) is False

    monkeypatch.setattr(vm, "_onnxruntime_cuda_available", lambda: True)

    assert vm.cuda_ready(e) is True


def test_her_cuda_sunan_motorun_acik_bir_sondasi_var() -> None:
    """Yeni bir motor eklerken sonda secmek ZORUNLU olsun.

    Varsayilan ``torch``; yanlis yigina soran bir motor sessizce CPU'da
    kosardi. Bu test en azindan bilinen yiginlarin dogru esleştigini tutuyor.
    """
    beklenen = {
        "faster-whisper": "ctranslate2",
        "piper": "onnxruntime",
        "whisper-turbo": "ctranslate2",
    }

    for entry_id, probe in beklenen.items():
        assert _entry(entry_id).cuda_probe == probe, f"{entry_id}: yanlis sonda"


def test_nvidia_smi_tek_basina_yetmiyor(monkeypatch) -> None:
    """Sürücünün varlığı hiçbir motor için tek başına kanıt değil.

    Bu testin varlık nedeni: eski ``_cuda_available()`` tam bunu yapıyordu ve
    panel sürücü kurulu her makinede CUDA yazıyordu.
    """
    monkeypatch.setattr(vm.shutil, "which", lambda name: "/usr/bin/nvidia-smi")
    monkeypatch.setattr(vm, "_ctranslate2_cuda_devices", lambda: 0)
    monkeypatch.setattr(vm, "_torch_cuda_available", lambda: False)
    monkeypatch.setattr(vm, "_onnxruntime_cuda_available", lambda: False)

    from fool import sidecar as _sidecar

    monkeypatch.setattr(_sidecar, "has_cuda_torch", lambda entry_id: False)

    hazir = [e.id for e in vm.CATALOG if vm.cuda_ready(e)]

    assert not hazir, f"surucu disinda kanit olmadan CUDA diyen motorlar: {hazir}"
