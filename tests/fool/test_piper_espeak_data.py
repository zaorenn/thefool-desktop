"""Piper, espeak verisini DERLEME MAKİNESİNİN yolunda aramamalı.

Ölçülen hata (kullanıcının ikinci makinesi, temiz kurulum)::

    Error processing file 'D:/a/piper1-gpl/piper1-gpl/_skbuild/win-amd64-3.9/
      cmake-build/espeak_ng-install/share/espeak-ng-data/phontab':
      No such file or directory.
    The Fool backend exited (1)

``D:/a/piper1-gpl/...`` bir GitHub Actions koşucusunun yolu; espeak-ng tekerleğe
derlenirken gömülmüş. Veri paketin içinde geliyor, eksik olan ADRES.

Sonucu ağırdı: TTS başarısız olmakla kalmıyor, ARKA UCU düşürüyordu -- yani ses
seçimi yüzünden sohbet de, oturumlar da gidiyordu.
"""

from __future__ import annotations

import os

import pytest

from tools.tts_tool import _point_espeak_at_bundled_data


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    monkeypatch.delenv("ESPEAK_DATA_PATH", raising=False)


def test_paketteki_veri_yolu_AYARLANIYOR() -> None:
    _point_espeak_at_bundled_data()

    path = os.environ.get("ESPEAK_DATA_PATH")

    assert path
    assert os.path.isfile(os.path.join(path, "phontab"))


def test_KULLANICININ_ayari_ezilmiyor(monkeypatch, tmp_path) -> None:
    """Kendi espeak kurulumunu gösteren birinin kararını geri almak,
    düzeltilen hatanın aynası olurdu."""
    monkeypatch.setenv("ESPEAK_DATA_PATH", str(tmp_path))

    _point_espeak_at_bundled_data()

    assert os.environ["ESPEAK_DATA_PATH"] == str(tmp_path)


def test_YARIM_klasor_gosterilmiyor(monkeypatch, tmp_path) -> None:
    """Boş bir klasörü göstermek, hiçbir şey göstermemekle aynı hatayı verir --
    o yüzden klasörün kendisi değil ``phontab`` sınanıyor."""
    import piper

    monkeypatch.setattr(piper, "__file__", str(tmp_path / "piper" / "__init__.py"))
    (tmp_path / "piper" / "espeak-ng-data").mkdir(parents=True)

    _point_espeak_at_bundled_data()

    assert os.environ.get("ESPEAK_DATA_PATH") is None


def test_piper_ice_aktarilirken_CAGIRILIYOR() -> None:
    """Ayarın sentezden önce yapılması gerekiyor; içe aktarma tek geçit."""
    from pathlib import Path

    source = Path("tools/tts_tool.py").read_text(encoding="utf-8")
    body = source[source.index("def _import_piper"):]

    assert body.index("_point_espeak_at_bundled_data()") < body.index("from piper import PiperVoice")
