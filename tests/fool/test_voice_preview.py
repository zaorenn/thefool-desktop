"""Ses panelinde model başına dinleme düğmesi.

Dört TTS motoru "kurulu" yazıyor ve kullanıcı hangisinin nasıl konuştuğunu
duymadan seçim yapmak zorunda. Daha kötüsü, bu depodaki en pahalı hata sınıfı
tam burada görünür hâle gelirdi: "cihaz cuda yazıyordu, motor CPU'da
koşuyordu". Ölçülen fark küçük değil -- Kokoro CUDA'da 0,08 sn, CPU'da
saniyeler.

Önizleme bu yüzden yalnızca ses döndürmüyor, GEÇEN SÜREYİ de döndürüyor.
Bir düğmeye basıp "3,4 saniye" görmek, panelin "CUDA" yazmasından daha
inandırıcı bir kanıt.
"""

from __future__ import annotations

import pytest

from fool import voice_preview as vp


def test_deneme_metni_kisa_ve_sabit() -> None:
    """Uzun metin ölçümü sentez süresi yerine metin uzunluğuyla karıştırır."""
    assert 0 < len(vp.PREVIEW_TEXT) <= 80


def test_bilinmeyen_motor_reddediliyor() -> None:
    with pytest.raises(ValueError):
        vp.preview("boyle-bir-motor-yok")


def test_kurulu_olmayan_motor_anlasilir_hata_veriyor(monkeypatch) -> None:
    """"Kurulu değil" ile "sentez patladı" ayrı şeyler; kullanıcı hangisi
    olduğunu bilmeden ne yapacağını bilemez."""
    monkeypatch.setattr(vp, "_status", lambda entry_id: {"installed": False})

    with pytest.raises(ValueError, match="kurulu"):
        vp.preview("kokoro")


def test_basarili_onizleme_ses_ve_sure_donuyor(monkeypatch, tmp_path) -> None:
    audio = tmp_path / "s.wav"
    audio.write_bytes(b"RIFFsahte")

    monkeypatch.setattr(vp, "_status", lambda entry_id: {"installed": True})
    monkeypatch.setattr(vp, "_synthesize", lambda provider, path: str(audio))

    result = vp.preview("kokoro")

    assert result["ok"] is True
    assert result["provider"] == "kokoro"
    assert result["elapsed_ms"] >= 0
    assert result["audio_base64"]
    assert result["mime"] == "audio/wav"


def test_olculen_sure_gercekten_sentezi_kapsiyor(monkeypatch, tmp_path) -> None:
    """Süre, çağrının etrafında ölçülmeli; sabit bir sayı döndürmek yalan olurdu."""
    audio = tmp_path / "s.wav"
    audio.write_bytes(b"RIFF")

    # Tukenen bir iterator kullanmak pytest'in kendi ic cagrilarini da
    # patlatiyor; sayac son degerde kaliyor.
    ticks = [1_000.0, 1_002.5]
    state = {"i": 0}

    def _clock() -> float:
        value = ticks[min(state["i"], len(ticks) - 1)]
        state["i"] += 1

        return value

    monkeypatch.setattr(vp, "_status", lambda entry_id: {"installed": True})
    monkeypatch.setattr(vp, "_synthesize", lambda provider, path: str(audio))
    monkeypatch.setattr(vp.time, "monotonic", _clock)

    assert vp.preview("kokoro")["elapsed_ms"] == 2500


def test_sentez_patlarsa_hata_yutulmuyor(monkeypatch) -> None:
    """Sessizce başarısız olan bir dinleme düğmesi, düğmenin bozuk olması."""
    def _boom(provider, path):
        raise RuntimeError("engine died")

    monkeypatch.setattr(vp, "_status", lambda entry_id: {"installed": True})
    monkeypatch.setattr(vp, "_synthesize", _boom)

    with pytest.raises(RuntimeError, match="engine died"):
        vp.preview("kokoro")


def test_gecici_dosya_temizleniyor(monkeypatch, tmp_path) -> None:
    """Her önizleme diske bir dosya bırakmamalı."""
    created: list = []

    def _synth(provider, path):
        p = tmp_path / "out.wav"
        p.write_bytes(b"RIFF")
        created.append(path)
        return str(p)

    monkeypatch.setattr(vp, "_status", lambda entry_id: {"installed": True})
    monkeypatch.setattr(vp, "_synthesize", _synth)

    vp.preview("kokoro")

    from pathlib import Path

    assert created and not Path(created[0]).exists()


def test_stt_motoru_onizlenemiyor() -> None:
    """Konuşma tanımanın dinletecek bir şeyi yok."""
    with pytest.raises(ValueError):
        vp.preview("whisper-turbo")
