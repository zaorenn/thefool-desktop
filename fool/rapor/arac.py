"""
Ajan araçları: resmî rapor okuma, öğrenme, tamamlama ve yazma.

Neden araç, neden bilgi istemi değil
------------------------------------
Bu işlerin hiçbiri modele anlatılarak yaptırılmıyor. Kenar boşluğunu, Türkçe
büyük harfi, ek numaralandırmasını, bozuk PDF tespitini kod yapıyor; model
yalnızca İÇERİK üretiyor. 70 sayfalık resmî bir evrakta biçim tutarlılığını
bir dil modelinin dikkatine bırakmak, kullanıcının "hata payı yok" şartıyla
bağdaşmıyor.

Araçlar bilerek dar
-------------------
Her araç tek bir soruya cevap veriyor ve JSON döndürüyor. Modelin bağlamı
64-128 bin token; araçlar bu yüzden metin YIĞMIYOR: büyük belgelerden sorguya
uyan kesitleri, örnek rapordan iskeleti, yarım rapordan eksik listesini
döndürüyorlar.

Zone A: upstream bu dosyayı bilmiyor.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .bicim_devral import devral, yonergeye_uygunluk
from .cozumle import bolumlere_ayir, eksik_bolumler, iskelet_cikar, tur_tahmin
from .docx_yazici import yaz
from .kaynak import oku, token_tahmini
from .pdf_cikti import pdf_uret
from .model import EKSIK, Alinti, AltBaslik, Bolum, Ek, Kapak, Paragraf, Rapor, Tablo
from . import taslak
from .secici import ilgili_kesitler
from .yonerge import RAPOR_TURLERI


def _hata(mesaj: str, **ek: Any) -> str:
    return json.dumps({"error": mesaj, **ek}, ensure_ascii=False)


def _sonuc(veri: dict) -> str:
    return json.dumps(veri, ensure_ascii=False)


# ---------------------------------------------------------------------------
# 1. Kaynak okuma -- tamamı ya da yalnızca sorguya uyan kısmı
# ---------------------------------------------------------------------------


def kaynak_oku(
    yol: str,
    sorgu: str | None = None,
    token_butcesi: int = 8000,
) -> str:
    """Belgeyi oku. ``sorgu`` verilirse yalnızca ilgili kesitler döner.

    Kalite denetimi HER ZAMAN çalışıyor: bozuk çıkarılmış bir metin modele
    gitmeden önce işaretleniyor (bkz. ``kaynak.kalite_olc``).
    """
    hedef = Path(yol)

    if not hedef.exists():
        return _hata(f"belge bulunamadı: {yol}")

    try:
        belge = oku(hedef)
    except Exception as sebep:  # noqa: BLE001 -- sebep kullaniciya gosteriliyor
        return _hata(f"belge okunamadı: {sebep}")

    kalite = belge.kalite

    if not kalite.guvenilir:
        # Metin DONDURULMUYOR. Bozuk metni "yine de al" diye vermek, raporun
        # icine bozuk yazimin girmesi demek -- kullanicinin en acik sarti buna
        # aykiri.
        return _sonuc(
            {
                "belge": belge.ad,
                "sayfa_sayisi": belge.sayfa_sayisi,
                "guvenilir": False,
                "gerekce": kalite.gerekce,
                "oneri": (
                    "Bu belgenin metin katmanı bozuk. İçeriği rapora "
                    "kullanmadan önce OCR'lı bir kopya gerekiyor; bozuk metin "
                    "bilerek döndürülmedi."
                ),
            }
        )

    if sorgu:
        kesitler = ilgili_kesitler(belge, sorgu, token_butcesi=token_butcesi)

        return _sonuc(
            {
                "belge": belge.ad,
                "guvenilir": True,
                "sayfa_sayisi": belge.sayfa_sayisi,
                "toplam_token": token_tahmini(belge.metin),
                "secilen_token": sum(token_tahmini(k.metin) for k in kesitler),
                "kesitler": [
                    {"baslik": k.baslik, "atif": k.atif, "metin": k.metin}
                    for k in kesitler
                ],
            }
        )

    toplam = token_tahmini(belge.metin)

    if toplam > token_butcesi:
        return _sonuc(
            {
                "belge": belge.ad,
                "guvenilir": True,
                "sayfa_sayisi": belge.sayfa_sayisi,
                "toplam_token": toplam,
                "uyari": (
                    f"Belge {toplam} token, bütçe {token_butcesi}. Tamamını "
                    "okumak yerine `sorgu` vererek ilgili kısmı iste."
                ),
            }
        )

    return _sonuc(
        {
            "belge": belge.ad,
            "guvenilir": True,
            "sayfa_sayisi": belge.sayfa_sayisi,
            "toplam_token": toplam,
            "metin": belge.metin,
        }
    )


# ---------------------------------------------------------------------------
# 2. Örnek rapordan öğrenme
# ---------------------------------------------------------------------------


def ornek_ogren(yol: str) -> str:
    """Örnek rapordan yazım iskeletini çıkar.

    Örneğin METNİ dönmüyor: başka bir soruşturmanın isim ve tarihlerinin yeni
    rapora sızmaması için yalnızca biçim bilgisi veriliyor.
    """
    hedef = Path(yol)

    if not hedef.exists():
        return _hata(f"örnek rapor bulunamadı: {yol}")

    try:
        belge = oku(hedef)
    except Exception as sebep:  # noqa: BLE001
        return _hata(f"örnek okunamadı: {sebep}")

    if not belge.kalite.guvenilir:
        return _hata(
            "örnek raporun metni güvenilir değil", gerekce=belge.kalite.gerekce
        )

    iskelet = iskelet_cikar(belge)

    try:
        devralinan = devral(hedef)
        bicim = {
            "yazi_tipi": devralinan.bicim.yazi_tipi,
            "punto": devralinan.bicim.yazi_boyut / 2,
            "hizalama": devralinan.bicim.hizalama,
            "okunamayan": devralinan.okunamayan,
        }
    except Exception:  # noqa: BLE001 -- bicim okunamazsa iskelet yine degerli
        bicim = {}

    return _sonuc(
        {
            "ornek": belge.ad,
            "iskelet": iskelet.metin(),
            "bolumler": iskelet.bolumler,
            "ek_atif_bicimi": iskelet.ek_atif_bicimi,
            "sonuc_alt_basliklari": iskelet.alt_basliklar,
            "bicim": bicim,
            "iskelet_token": token_tahmini(iskelet.metin()),
            "ornek_token": token_tahmini(belge.metin),
        }
    )


# ---------------------------------------------------------------------------
# 3. Yarım raporu çözümle
# ---------------------------------------------------------------------------


def yarim_cozumle(yol: str) -> str:
    """Yarım raporun neyi var, neyi eksik ve hangi biçimde yazılmış?

    Yarım rapor HER ZAMAN eksiksiz okunuyor: atlanan bir paragraf, zaten
    yazılmış olanla çelişen bir tamamlama demek.
    """
    hedef = Path(yol)

    if not hedef.exists():
        return _hata(f"rapor bulunamadı: {yol}")

    try:
        belge = oku(hedef)
    except Exception as sebep:  # noqa: BLE001
        return _hata(f"rapor okunamadı: {sebep}")

    if not belge.kalite.guvenilir:
        return _hata(
            "tamamlanacak raporun metni güvenilir değil",
            gerekce=belge.kalite.gerekce,
        )

    cozumlenmis = bolumlere_ayir(belge)
    tur = tur_tahmin(cozumlenmis)
    eksikler = eksik_bolumler(cozumlenmis, tur)

    try:
        devralinan = devral(hedef)
        farklar = [str(f) for f in yonergeye_uygunluk(devralinan.bicim)]
        bicim = {
            "yazi_tipi": devralinan.bicim.yazi_tipi,
            "punto": devralinan.bicim.yazi_boyut / 2,
            "satir_araligi": devralinan.bicim.satir_araligi,
            "hizalama": devralinan.bicim.hizalama,
            "kenar_sol": devralinan.bicim.kenar_sol,
            "kenar_ust": devralinan.bicim.kenar_ust,
            "okunamayan": devralinan.okunamayan,
            "yonergeden_farklar": farklar,
        }
    except Exception as sebep:  # noqa: BLE001
        bicim = {"hata": f"biçim okunamadı: {sebep}"}

    return _sonuc(
        {
            "rapor": belge.ad,
            "tur": tur.kimlik if tur else None,
            "tur_adi": tur.ad if tur else None,
            "mevcut_bolumler": [
                {"baslik": b.baslik, "karakter": b.karakter, "bos": b.bos}
                for b in cozumlenmis.bolumler
            ],
            "eksik_bolumler": [
                {"baslik": e.baslik, "durum": e.durum} for e in eksikler
            ],
            "bicim": bicim,
            "tam_metin": belge.metin,
            "not": (
                "Tamamlarken bu biçimi kullan: aynı yazı tipi, punto ve "
                "hizalama. Yönergeden farklar bildirildi ama DÜZELTİLMEDİ; "
                "belgeyi ortasından değiştirmek müfettişin kararı."
            ),
        }
    )


# ---------------------------------------------------------------------------
# 4. Raporu yaz
# ---------------------------------------------------------------------------


def _oge_kur(ham: dict) -> Any:
    tur = (ham.get("tur") or "paragraf").lower()

    if tur == "alt_baslik":
        return AltBaslik(ham.get("metin", ""))

    if tur == "alinti":
        return Alinti(
            ham.get("metin", ""), ham.get("kaynak", ""), ham.get("ek", "")
        )

    if tur == "tablo":
        return Tablo(
            ham.get("baslik", ""),
            list(ham.get("basliklar", [])),
            [list(s) for s in ham.get("satirlar", [])],
        )

    return Paragraf(
        ham.get("metin", ""),
        kalin=bool(ham.get("kalin", False)),
        ek=ham.get("ek", ""),
    )


def rapor_yaz(rapor_json: str | dict, hedef: str, bicim_kaynagi: str | None = None) -> str:
    """Yapılandırılmış rapordan ``.docx`` üret.

    ``bicim_kaynagi`` verilirse biçim O BELGEDEN devralınıyor -- yarım bir
    raporu aynı fontla tamamlamanın yolu bu.
    """
    try:
        veri = json.loads(rapor_json) if isinstance(rapor_json, str) else rapor_json
    except json.JSONDecodeError as sebep:
        return _hata(f"rapor JSON çözümlenemedi: {sebep}")

    if not isinstance(veri, dict):
        return _hata("rapor JSON bir nesne olmalı")

    tur = veri.get("tur", "inceleme")

    if tur not in RAPOR_TURLERI:
        return _hata(
            f"bilinmeyen rapor türü: {tur}",
            gecerli=sorted(RAPOR_TURLERI),
        )

    kapak_ham = veri.get("kapak", {})
    kapak = Kapak(
        **{
            alan: kapak_ham[alan]
            for alan in (
                "bakanlik", "baskanlik", "baslik", "konu",
                "gorev_emri_tarih", "gorev_emri_sayi", "rapor_tarih",
                "rapor_sayi", "ek_adedi", "mufettis_ad", "mufettis_unvan",
            )
            if alan in kapak_ham
        },
        gizli=bool(kapak_ham.get("gizli", False)),
    )

    # Bolumler YONERGEDEKI siraya diziliyor: model istedigi sirada
    # gonderebiliyor ve sirasi karismis bir resmi rapor yonergeye aykiri.
    bolumler = []
    for ham in taslak.sirala(list(veri.get("bolumler", [])), tur):
        bolum = Bolum(ham.get("baslik", ""))
        ogeler = list(ham.get("ogeler", []))

        # Sekli ANLASILMAYAN oge sessizce bos paragrafa donusmuyor: modelin
        # bozuk yapisi bes bolumu de bos birakmisti ve arac "basarili"
        # demisti (bkz. taslak.ogeleri_dogrula).
        try:
            taslak.ogeleri_dogrula(ogeler, bolum.baslik)
            bolum.ogeler = [_oge_kur(o) for o in ogeler]
        except (taslak.TaslakHatasi, ValueError) as sebep:
            return _hata(str(sebep))

        bolumler.append(bolum)

    ekler = [
        Ek(
            no=int(e.get("no", i + 1)),
            icerik=e.get("icerik", ""),
            sayfa_sayisi=int(e.get("sayfa_sayisi", 1)),
        )
        for i, e in enumerate(veri.get("ekler", []))
    ]

    rapor = Rapor(
        tur=tur,
        kapak=kapak,
        bolumler=bolumler,
        ozet=list(veri.get("ozet", [])),
        ekler=ekler,
        # Verilmeyen imza alani UYDURULMUYOR: EKSIK olarak belgede kaliyor
        # ve ``eksikler()`` bunu imzadan once listeliyor.
        imza_yer=veri.get("imza_yer") or EKSIK,
        imza_tarih=veri.get("imza_tarih") or EKSIK,
    )

    bicim = None
    devralindi = None

    if bicim_kaynagi:
        kaynak_yolu = Path(bicim_kaynagi)

        if not kaynak_yolu.exists():
            return _hata(f"biçim kaynağı bulunamadı: {bicim_kaynagi}")

        try:
            devralinan = devral(kaynak_yolu)
            bicim = devralinan.bicim
            devralindi = {
                "kaynak": devralinan.kaynak,
                "yazi_tipi": bicim.yazi_tipi,
                "punto": bicim.yazi_boyut / 2,
                "okunamayan": devralinan.okunamayan,
            }
        except Exception as sebep:  # noqa: BLE001
            return _hata(f"biçim devralınamadı: {sebep}")

    try:
        yazilan = yaz(rapor, hedef, bicim)
    except Exception as sebep:  # noqa: BLE001
        return _hata(f"docx yazılamadı: {sebep}")

    eksikler = rapor.eksikler()

    return _sonuc(
        {
            "yazildi": str(yazilan),
            "bayt": yazilan.stat().st_size,
            "tur": tur,
            "bolum_sayisi": len(bolumler),
            "ek_sayisi": len(ekler),
            "bicim_devralindi": devralindi,
            "eksik_alanlar": eksikler,
            "uyari": (
                "Doldurulmamış alanlar var; belgede [EKSİK] olarak duruyor. "
                "İmzadan önce tamamlanmalı."
            )
            if eksikler
            else None,
        }
    )


# ---------------------------------------------------------------------------
# 5. Parça parça rapor kurma
# ---------------------------------------------------------------------------
#
# Tek dev JSON yerine biriken taslak. Gerekçe ``taslak.py`` başında ölçümle
# yazılı: yerel model uzun bir yapıyı yeniden kurarken alan düşürüyor, ve 70
# sayfalık bir rapor zaten tek çağrıya sığmıyor.


def taslak_baslat(
    kimlik: str,
    tur: str = "inceleme",
    kapak: dict | None = None,
    ozet: list | None = None,
    imza_yer: str = "",
    imza_tarih: str = "",
    sifirla: bool = False,
) -> str:
    """Yeni bir rapor taslağı aç."""
    try:
        taslak.baslat(
            kimlik,
            tur,
            kapak=kapak,
            ozet=list(ozet or []),
            imza_yer=imza_yer,
            imza_tarih=imza_tarih,
            sifirla=sifirla,
        )
    except taslak.TaslakHatasi as sebep:
        return _hata(str(sebep))

    return _sonuc(taslak.durum(kimlik))


def taslak_bolum(kimlik: str, baslik: str, ogeler: list | None = None) -> str:
    """Taslağa tek bir bölüm yaz (aynı başlık gelirse üzerine yazar)."""
    try:
        taslak.bolum_ekle(kimlik, baslik, list(ogeler or []))
    except taslak.TaslakHatasi as sebep:
        return _hata(str(sebep))

    return _sonuc(taslak.durum(kimlik))


def taslak_ek(kimlik: str, icerik: str, sayfa_sayisi: int = 1) -> str:
    """Ek dizinine bir kayıt ekle."""
    try:
        taslak.ek_ekle(kimlik, icerik, sayfa_sayisi)
    except taslak.TaslakHatasi as sebep:
        return _hata(str(sebep))

    return _sonuc(taslak.durum(kimlik))


def taslak_kapak(kimlik: str, alanlar: dict | None = None) -> str:
    """Kapağın YALNIZCA verilen alanlarını güncelle."""
    try:
        taslak.kapak_guncelle(kimlik, dict(alanlar or {}))
    except taslak.TaslakHatasi as sebep:
        return _hata(str(sebep))

    return _sonuc(taslak.durum(kimlik))


def taslak_ozet(kimlik: str, satirlar: list | None = None) -> str:
    """Raporun özetini yaz (MADDE 7)."""
    try:
        taslak.ozet_yaz(kimlik, list(satirlar or []))
    except taslak.TaslakHatasi as sebep:
        return _hata(str(sebep))

    return _sonuc(taslak.durum(kimlik))


def taslak_durum(kimlik: str) -> str:
    """Taslakta ne var, yönergeye göre ne eksik?"""
    try:
        return _sonuc(taslak.durum(kimlik))
    except taslak.TaslakHatasi as sebep:
        return _hata(str(sebep))


def taslak_uret(kimlik: str, hedef: str, bicim_kaynagi: str | None = None) -> str:
    """Biriken taslaktan ``.docx`` üret."""
    try:
        sozluk = taslak.rapor_sozlugu(kimlik)
    except taslak.TaslakHatasi as sebep:
        return _hata(str(sebep))

    cevap = json.loads(rapor_yaz(sozluk, hedef, bicim_kaynagi))

    if "error" not in cevap:
        cevap["taslak_durumu"] = taslak.durum(kimlik)

    return _sonuc(cevap)


def rapor_pdf(docx: str, hedef_klasor: str | None = None) -> str:
    """Üretilmiş bir ``.docx`` raporu PDF'e çevir."""
    sonuc = pdf_uret(docx, hedef_klasor)

    if not sonuc.basarili:
        return _hata(sonuc.gerekce, donusturucu=sonuc.donusturucu or None)

    return _sonuc(
        {
            "pdf": str(sonuc.yol),
            "bayt": sonuc.yol.stat().st_size,
            "donusturucu": sonuc.donusturucu,
        }
    )
