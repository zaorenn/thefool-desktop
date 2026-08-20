"""
Parça parça rapor kurma.

Ölçülmüş sebep: yerel model (google/gemma-4-e4b, LM Studio) ``rapor_yaz``ı
tek dev JSON ile çağırdığında kapak alanlarını düşürdü -- ``gorev_emri_tarih``,
``gorev_emri_sayi``, ``rapor_tarih``, ``rapor_sayi``, ``ek_adedi`` ve
``imza_tarih`` kayboldu. Aynı JSON doğrudan araca verildiğinde eksik çıkmadı,
yani hata araçta değil modelin uzun yapıyı yeniden kurmasında.

Ayrıca 70 sayfalık bir rapor tek çağrıya zaten sığmıyor.
"""

from __future__ import annotations

import json
import zipfile

import pytest

from fool.rapor import arac, taslak


@pytest.fixture(autouse=True)
def _ayri_klasor(tmp_path, monkeypatch):
    """Testler kullanıcının gerçek taslaklarına dokunmasın."""
    monkeypatch.setenv("FOOL_RAPOR_TASLAK_DIR", str(tmp_path / "taslak"))


def test_bolumler_AYRI_cagrilarla_birikiyor() -> None:
    taslak.baslat("t1", "inceleme")
    taslak.bolum_ekle("t1", "I. GİRİŞ", [{"tur": "paragraf", "metin": "Başlandı."}])
    taslak.bolum_ekle("t1", "II. KONU", [{"tur": "paragraf", "metin": "Konu."}])

    durum = taslak.durum("t1")

    assert durum["yazilan_bolumler"] == ["I. GİRİŞ", "II. KONU"]
    assert "III. İNCELEME VE ARAŞTIRMA" in durum["eksik_bolumler"]
    assert durum["tamam_mi"] is False


def test_AYNI_baslik_ikinci_kez_gelince_UZERINE_yaziliyor() -> None:
    """Model bir bölümü düzeltmek isteyince aynı başlıkla tekrar gönderiyor."""
    taslak.baslat("t2", "inceleme")
    taslak.bolum_ekle("t2", "I. GİRİŞ", [{"tur": "paragraf", "metin": "ilk"}])
    taslak.bolum_ekle("t2", "I. GİRİŞ", [{"tur": "paragraf", "metin": "duzeltilmis"}])

    durum = taslak.durum("t2")

    assert durum["yazilan_bolumler"] == ["I. GİRİŞ"]
    assert taslak.yukle("t2").bolumler[0]["ogeler"][0]["metin"] == "duzeltilmis"


def test_kapak_PARCA_PARCA_dolduruluyor() -> None:
    """Tüm kapağı yeniden göndermek, alan düşürmenin olduğu yerdi."""
    taslak.baslat("t3", "inceleme", kapak={"bakanlik": "Tarım ve Orman Bakanlığı"})
    taslak.kapak_guncelle("t3", {"rapor_sayi": "8-2026/3"})
    taslak.kapak_guncelle("t3", {"mufettis_ad": "Cemil KAYA"})

    kapak = taslak.yukle("t3").kapak

    assert kapak["bakanlik"] == "Tarım ve Orman Bakanlığı"
    assert kapak["rapor_sayi"] == "8-2026/3"
    assert kapak["mufettis_ad"] == "Cemil KAYA"


def test_BOS_deger_mevcut_alani_SILMIYOR() -> None:
    """Modelin boş gönderdiği bir alan, dolu olanı silmemeli."""
    taslak.baslat("t4", "inceleme", kapak={"mufettis_ad": "Cemil KAYA"})
    taslak.kapak_guncelle("t4", {"mufettis_ad": "", "konu": "Yeni konu"})

    kapak = taslak.yukle("t4").kapak

    assert kapak["mufettis_ad"] == "Cemil KAYA"
    assert kapak["konu"] == "Yeni konu"


def test_ekler_EKLEME_SIRASINA_gore_numaralaniyor() -> None:
    """MADDE 10(4): ekler rapora ilk konu edilme sırasına göre numaralanır."""
    taslak.baslat("t5", "inceleme")
    taslak.ek_ekle("t5", "Makam Onayı", 2)
    taslak.ek_ekle("t5", "Cevaplı Teftiş Raporu", 3)

    ekler = taslak.yukle("t5").ekler

    assert [e["no"] for e in ekler] == [1, 2]
    assert ekler[1]["icerik"] == "Cevaplı Teftiş Raporu"


def test_SONUC_VE_ONERILER_yonergedeki_SONUC_yerine_geciyor() -> None:
    taslak.baslat("t6", "inceleme")
    for baslik in (
        "I. GİRİŞ", "II. KONU", "III. İNCELEME VE ARAŞTIRMA",
        "IV. TARTIŞMA VE DEĞERLENDİRME", "V. SONUÇ VE ÖNERİLER",
    ):
        taslak.bolum_ekle("t6", baslik, [{"tur": "paragraf", "metin": "x"}])

    assert taslak.durum("t6")["tamam_mi"] is True


def test_taslaktan_DOCX_uretiliyor(tmp_path) -> None:
    taslak.baslat(
        "t7", "inceleme",
        kapak={"bakanlik": "Tarım ve Orman Bakanlığı",
               "baskanlik": "DSİ Teftiş Kurulu Başkanlığı",
               "baslik": "İnceleme Raporu", "konu": "Deneme",
               "gorev_emri_tarih": "01.05.2026", "gorev_emri_sayi": "123",
               "rapor_tarih": "01.06.2026", "rapor_sayi": "8-2026/3",
               "ek_adedi": "1", "mufettis_ad": "Cemil KAYA"},
        imza_yer="Ankara", imza_tarih="01.06.2026",
    )
    taslak.bolum_ekle("t7", "I. GİRİŞ", [{"tur": "paragraf", "metin": "Başlandı."}])
    taslak.ek_ekle("t7", "Makam Onayı", 1)

    hedef = tmp_path / "t7.docx"
    cevap = json.loads(arac.taslak_uret("t7", str(hedef)))

    assert cevap["eksik_alanlar"] == []
    with zipfile.ZipFile(hedef) as paket:
        assert paket.testzip() is None


def test_gecersiz_kimlik_BASKA_KLASORE_yazamiyor() -> None:
    """Taslak kimliği dosya adı oluyor; ``../`` başka yere yazardı."""
    with pytest.raises(taslak.TaslakHatasi, match="geçersiz"):
        taslak.baslat("../kacis", "inceleme")


def test_bilinmeyen_tur_REDDEDILIYOR() -> None:
    with pytest.raises(taslak.TaslakHatasi, match="bilinmeyen"):
        taslak.baslat("t8", "olmayan")


def test_olmayan_taslak_ACIK_hata_veriyor() -> None:
    assert "bulunamadı" in json.loads(arac.taslak_durum("hicyok"))["error"]


def test_taslak_OTURUMDAN_bagimsiz_diskte_duruyor() -> None:
    """Uzun oturumda bağlam özetlenince taslak kaybolmamalı."""
    taslak.baslat("t9", "inceleme")
    taslak.bolum_ekle("t9", "I. GİRİŞ", [{"tur": "paragraf", "metin": "kalici"}])

    # Yeni bir yukleme: bellekteki hicbir sey tasinmiyor.
    assert taslak.yukle("t9").bolumler[0]["ogeler"][0]["metin"] == "kalici"


def test_arac_katmani_da_ayni_sekilde_calisiyor() -> None:
    json.loads(arac.taslak_baslat("t10", "inceleme"))
    json.loads(arac.taslak_kapak("t10", {"mufettis_ad": "Cemil KAYA"}))
    cevap = json.loads(
        arac.taslak_bolum("t10", "I. GİRİŞ", [{"tur": "paragraf", "metin": "x"}])
    )

    assert cevap["yazilan_bolumler"] == ["I. GİRİŞ"]
    assert "mufettis_ad" in cevap["kapak_alanlari"]
