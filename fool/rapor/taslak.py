"""
Raporu PARÇA PARÇA kur -- tek bir dev JSON ile değil.

Ölçülen sebep
-------------
İlk tasarımda ``rapor_yaz`` raporun tamamını tek bir JSON olarak alıyordu.
Yerel modelle (google/gemma-4-e4b, LM Studio) denendi: araç çağrıldı, belge
yazıldı, ama model JSON'u yeniden kurarken kapak alanlarını düşürdü --
``gorev_emri_tarih``, ``gorev_emri_sayi``, ``rapor_tarih``, ``rapor_sayi``,
``ek_adedi`` ve ``imza_tarih`` kayboldu. Aynı JSON doğrudan araca verildiğinde
``eksik_alanlar`` boş dönüyor, yani hata araçta değil: küçük bir yerel model
uzun ve birebir bir yapıyı tek seferde üretemiyor.

Bu, tek başına bile düzeltilmesi gereken bir kusur. Ama asıl sorun daha
temelde: kullanıcının raporu 70 sayfaya kadar çıkıyor. 70 sayfalık bir raporun
tamamı tek bir JSON olarak ~100 bin token eder ve zaten 64 binlik pencereye
sığmaz. Yani "tek çağrıda tüm rapor" yaklaşımı modelden bağımsız olarak
ölçekleyemiyor.

Çözüm: taslak diskte birikiyor. Model her seferinde TEK bölüm gönderiyor,
her çağrı küçük ve doğrulanabilir, bağlamda hiçbir zaman raporun tamamı
durmuyor.

Neden diskte
------------
Oturum uzun; model bağlamı doluyor ve eski turlar özetleniyor. Taslak bağlamda
tutulsaydı, 40. bölüm yazılırken 3. bölüm çoktan unutulmuş olurdu. Diskte
duran taslak bundan etkilenmiyor ve iş yarıda kalırsa kaldığı yerden devam
ediyor.

Zone A: upstream bu dosyayı bilmiyor.
"""

from __future__ import annotations

import json
import re
import tempfile
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .yonerge import RAPOR_TURLERI

#: Taslak kimliğinde yalnızca bunlar: taslak adı dosya yolu oluyor ve
#: ``../`` gibi bir ad başka klasöre yazmaya çalışırdı.
_GECERLI_KIMLIK = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


class TaslakHatasi(Exception):
    """Taslak işlemi yapılamadı."""


def taslak_klasoru() -> Path:
    """Taslakların durduğu yer.

    ``FOOL_RAPOR_TASLAK_DIR`` ile değiştirilebiliyor; testler kendi geçici
    klasörünü veriyor, böylece kullanıcının gerçek taslakları test koşusundan
    etkilenmiyor.
    """
    import os

    ham = os.environ.get("FOOL_RAPOR_TASLAK_DIR")

    if ham:
        yol = Path(ham)
    else:
        yol = Path(tempfile.gettempdir()) / "fool-rapor-taslak"

    yol.mkdir(parents=True, exist_ok=True)

    return yol


def _taslak_yolu(kimlik: str) -> Path:
    if not _GECERLI_KIMLIK.match(kimlik):
        raise TaslakHatasi(
            f"geçersiz taslak kimliği: {kimlik!r} "
            "(yalnızca harf, rakam, nokta, tire, alt çizgi; en çok 64)"
        )

    return taslak_klasoru() / f"{kimlik}.json"


@dataclass
class Taslak:
    """Diskte biriken rapor."""

    kimlik: str
    tur: str
    kapak: dict = field(default_factory=dict)
    ozet: list[str] = field(default_factory=list)
    bolumler: list[dict] = field(default_factory=list)
    ekler: list[dict] = field(default_factory=list)
    imza_yer: str = ""
    imza_tarih: str = ""

    def sozluk(self) -> dict:
        return asdict(self)


def baslat(
    kimlik: str,
    tur: str,
    kapak: dict | None = None,
    ozet: list[str] | None = None,
    imza_yer: str = "",
    imza_tarih: str = "",
    sifirla: bool = False,
) -> Taslak:
    """Yeni taslak aç. Var olanın ÜZERİNE YAZMAZ.

    Önce yazıyordu ve ölçüldü: uygulama sürülürken model, bölümleri yazdıktan
    SONRA ``baslat``ı bir kez daha çağırdı ve o ana kadar yazılmış beş bölümün
    tamamı silindi -- taslakta 5 ek ve 10 kapak alanı kalmış, bölümler boştu.
    Bir dil modelinin turu yeniden başlatması olağan; 70 sayfalık bir işi
    sessizce sıfırlamak değil.

    Gerçekten baştan başlanacaksa ``sifirla=True`` açıkça isteniyor.
    """
    if tur not in RAPOR_TURLERI:
        raise TaslakHatasi(
            f"bilinmeyen rapor türü: {tur} (geçerli: {', '.join(sorted(RAPOR_TURLERI))})"
        )

    if not sifirla and _taslak_yolu(kimlik).exists():
        mevcut = yukle(kimlik)

        if mevcut.bolumler or mevcut.ekler:
            raise TaslakHatasi(
                f"'{kimlik}' taslağı zaten var: "
                f"{len(mevcut.bolumler)} bölüm, {len(mevcut.ekler)} ek. "
                "Kaldığın yerden devam et (rapor_taslak_bolum / "
                "rapor_taslak_durum). Gerçekten baştan başlamak istiyorsan "
                "sifirla=true gönder."
            )

    taslak = Taslak(
        kimlik=kimlik,
        tur=tur,
        kapak=dict(kapak or {}),
        ozet=list(ozet or []),
        imza_yer=imza_yer,
        imza_tarih=imza_tarih,
    )
    _yaz(taslak)

    return taslak


def _yaz(taslak: Taslak) -> None:
    yol = _taslak_yolu(taslak.kimlik)
    gecici = yol.with_suffix(".json.tmp")

    # Once gecici dosyaya, sonra yerine koy: 40. bolumu yazarken kesilen bir
    # islem, o ana kadar birikmis 39 bolumu bozmasin.
    gecici.write_text(
        json.dumps(taslak.sozluk(), ensure_ascii=False, indent=1), encoding="utf-8"
    )
    gecici.replace(yol)


def yukle(kimlik: str) -> Taslak:
    yol = _taslak_yolu(kimlik)

    if not yol.exists():
        raise TaslakHatasi(f"taslak bulunamadı: {kimlik}")

    try:
        ham = json.loads(yol.read_text(encoding="utf-8"))
    except json.JSONDecodeError as sebep:
        raise TaslakHatasi(f"taslak bozuk: {sebep}") from sebep

    return Taslak(**ham)


def bolum_ekle(kimlik: str, baslik: str, ogeler: list[dict]) -> Taslak:
    """Taslağa bir bölüm ekle.

    Aynı başlık ikinci kez gelirse ÜZERİNE YAZILIYOR, ikinci kopya
    eklenmiyor: model bir bölümü düzeltmek isteyince aynı başlıkla tekrar
    gönderiyor ve iki "III. İNCELEME VE ARAŞTIRMA" bölümü olan bir rapor,
    tamamlanmamış bir rapordan daha kötü.
    """
    ogeleri_dogrula(list(ogeler), baslik)

    taslak = yukle(kimlik)
    yeni = {"baslik": baslik, "ogeler": list(ogeler)}

    for sira, mevcut in enumerate(taslak.bolumler):
        if mevcut.get("baslik") == baslik:
            taslak.bolumler[sira] = yeni
            break
    else:
        taslak.bolumler.append(yeni)

    _yaz(taslak)

    return taslak


def ek_ekle(kimlik: str, icerik: str, sayfa_sayisi: int = 1, no: int | None = None) -> Taslak:
    """Ek dizinine bir kayıt ekle.

    Numara verilmezse sıradaki veriliyor: yönerge eklerin rapordaki ilk
    anılma sırasına göre numaralanmasını istiyor (MADDE 10(4)), o da doğal
    olarak ekleme sırası.
    """
    taslak = yukle(kimlik)
    sonraki = no if no is not None else len(taslak.ekler) + 1

    taslak.ekler.append(
        {"no": int(sonraki), "icerik": icerik, "sayfa_sayisi": int(sayfa_sayisi)}
    )
    _yaz(taslak)

    return taslak


def kapak_guncelle(kimlik: str, alanlar: dict) -> Taslak:
    """Kapağın yalnızca verilen alanlarını değiştir.

    Tümünü birden göndermek zorunda kalmamak önemli: ölçülen hata tam olarak
    modelin uzun bir kapak nesnesini yeniden kurarken alan düşürmesiydi.
    """
    kapak_alanlarini_dogrula(alanlar)

    taslak = yukle(kimlik)
    taslak.kapak.update({k: v for k, v in alanlar.items() if v not in (None, "")})
    _yaz(taslak)

    return taslak


def durum(kimlik: str) -> dict:
    """Taslakta ne var, yönergeye göre ne eksik?"""
    taslak = yukle(kimlik)
    tur = RAPOR_TURLERI[taslak.tur]

    mevcut = [b.get("baslik", "") for b in taslak.bolumler]
    sade = {_sade(b) for b in mevcut}

    eksik = [b for b in tur.bolumler if not _var_mi(_sade(b), sade)]

    return {
        "kimlik": taslak.kimlik,
        "tur": taslak.tur,
        "tur_adi": tur.ad,
        "beklenen_bolumler": list(tur.bolumler),
        "yazilan_bolumler": mevcut,
        "eksik_bolumler": eksik,
        "oge_sayisi": {b.get("baslik", ""): len(b.get("ogeler", [])) for b in taslak.bolumler},
        "ek_sayisi": len(taslak.ekler),
        "kapak_alanlari": sorted(taslak.kapak),
        "tamam_mi": not eksik,
        "siradaki_adim": _siradaki_adim(taslak, eksik),
    }


#: MADDE 6(1)'in saydigi, kapakta BULUNMASI ZORUNLU alanlar.
_ZORUNLU_KAPAK = (
    "bakanlik", "baskanlik", "baslik", "konu", "gorev_emri_tarih",
    "gorev_emri_sayi", "rapor_tarih", "rapor_sayi", "ek_adedi", "mufettis_ad",
)


def _siradaki_adim(taslak: "Taslak", eksik: list[str]) -> str:
    """Sırada ne yapılacağını AÇIKÇA söyle.

    Ölçüldü: yerel model (gemma-4-e4b) on bir adımlık bir planın ikinci
    bölümünden sonra durdu ve "rapor tamamlandı" dedi -- oysa üç bölüm ve
    kapağın yarısı eksikti. Araç cevabının içinde sıradaki adımı adıyla
    söylemek, planı modelin hafızasında tutmaya çalışmaktan çok daha
    dayanıklı: her turda yeniden hatırlatılıyor.
    """
    if eksik:
        return (
            f"HENÜZ BİTMEDİ. Sıradaki bölüm: '{eksik[0]}'. "
            f"rapor_taslak_bolum aracını kimlik='{taslak.kimlik}', "
            f"baslik='{eksik[0]}' ile çağır. "
            f"Kalan bölümler: {', '.join(eksik)}."
        )

    kapak_eksik = [a for a in _ZORUNLU_KAPAK if not str(taslak.kapak.get(a, "")).strip()]

    if kapak_eksik:
        return (
            f"Bölümler tamam. Kapakta eksik alan var: {', '.join(kapak_eksik)}. "
            f"rapor_taslak_kapak aracını kimlik='{taslak.kimlik}' ile çağır."
        )

    if not taslak.ekler:
        return (
            f"Bölümler ve kapak tamam. Şimdi ekleri gir: rapor_taslak_ek, "
            f"kimlik='{taslak.kimlik}'."
        )

    if not taslak.ozet:
        # MADDE 7: kapak ile rapor metni arasinda ozet sayfasi bulunur.
        return (
            f"Bölümler, kapak ve ekler tamam. Şimdi özeti yaz: "
            f"rapor_taslak_ozet, kimlik='{taslak.kimlik}'."
        )

    return (
        f"Taslak hazır. rapor_taslak_uret aracını kimlik='{taslak.kimlik}' "
        f"ve hedef dosya yolu ile çağırıp .docx üret."
    )


def _sade(baslik: str) -> str:
    baslik = baslik.replace("İ", "i").replace("I", "ı")
    return " ".join(re.sub(r"[^\w\s]", " ", baslik.lower()).split())


def _var_mi(hedef: str, mevcut: set[str]) -> bool:
    # "V. SONUC" ile "V. SONUC VE ONERILER" ayni bolum (bkz. cozumle.bul).
    return any(m == hedef or m.startswith(hedef) or hedef.startswith(m) for m in mevcut)


def sil(kimlik: str) -> None:
    _taslak_yolu(kimlik).unlink(missing_ok=True)


def rapor_sozlugu(kimlik: str) -> dict:
    """Taslağı ``arac.rapor_yaz``ın beklediği yapıya çevir."""
    taslak = yukle(kimlik)

    return {
        "tur": taslak.tur,
        "kapak": taslak.kapak,
        "ozet": taslak.ozet,
        "bolumler": sirala(taslak.bolumler, taslak.tur),
        "ekler": taslak.ekler,
        "imza_yer": taslak.imza_yer,
        "imza_tarih": taslak.imza_tarih,
    }


def sirala(bolumler: list[dict], tur_kimligi: str) -> list[dict]:
    """Bölümleri YÖNERGEDEKİ sıraya diz.

    Model bölümleri istediği sırada yazıyor -- ölçüldü: yerel model
    "IV. TARTIŞMA VE DEĞERLENDİRME"i "III. İNCELEME VE ARAŞTIRMA"dan önce
    gönderdi. Geliş sırasına göre yazınca ortaya bölümleri karışmış bir resmî
    rapor çıkıyor; yönerge (MADDE 17) sırayı sayıyor ve o sıra bağlayıcı.

    Yönergede olmayan bir başlık ATILMIYOR, sona ekleniyor: müfettiş kendi alt
    bölümünü açabiliyor (MADDE 8(7)) ve sessizce silmek veri kaybı olurdu.
    """
    tur = RAPOR_TURLERI.get(tur_kimligi)

    if tur is None:
        return list(bolumler)

    beklenen = [_sade(b) for b in tur.bolumler]

    def anahtar(veri: tuple[int, dict]) -> tuple[int, int]:
        sira, bolum = veri
        sade = _sade(bolum.get("baslik", ""))

        for yer, hedef in enumerate(beklenen):
            if sade == hedef or sade.startswith(hedef) or hedef.startswith(sade):
                return (yer, sira)

        # Taninmayan baslik sona, kendi arasinda geldigi sirayla.
        return (len(beklenen), sira)

    return [b for _, b in sorted(enumerate(bolumler), key=anahtar)]


# ---------------------------------------------------------------------------
# Doğrulama -- modelin gönderdiği şekli SESSİZCE kabul etmemek
# ---------------------------------------------------------------------------
#
# Ölçülen olay: yerel model bölüm öğeleri yerine şunu gönderdi::
#
#     {"\"icerik\"": [{"\"metin\"": [{"\"aciklama\"": 1, "\"tur\"": 0}]}]}
#
# Kod bunu kabul etti: ``tur`` yoktu -> "paragraf" varsayıldı, ``metin`` yoktu
# -> boş dizi. Sonuçta beş bölümü de BOŞ olan bir rapor üretildi ve araç
# "başarılı" dedi. Kapakta da model ``rapor_tarih`` yerine ``rapor_date``
# yazdı; bilinmeyen alan sessizce yutuldu ve tarih [EKSİK] kaldı.
#
# İkisi de aynı kusur: anlaşılmayanı sessizce düşürmek. Resmî evrakta en kötü
# sonuç bu -- hata görünmüyor, belge boş çıkıyor. Artık anlaşılmayan şey
# REDDEDİLİYOR ve doğru şeklin ne olduğu söyleniyor, böylece model düzeltip
# tekrar gönderebiliyor.

#: Bir bölüm öğesinin alabileceği türler ve o türde ZORUNLU alanlar.
_OGE_ALANLARI = {
    "paragraf": ("metin",),
    "alt_baslik": ("metin",),
    "alinti": ("metin",),
    "tablo": ("basliklar", "satirlar"),
}

#: Kapakta tanınan alanlar. MADDE 6(1) + imza/gizlilik.
_KAPAK_ALANLARI = frozenset(
    (
        "bakanlik", "baskanlik", "baslik", "konu", "gorev_emri_tarih",
        "gorev_emri_sayi", "rapor_tarih", "rapor_sayi", "ek_adedi",
        "mufettis_ad", "mufettis_unvan", "gizli",
    )
)


def ogeleri_dogrula(ogeler: list[dict], baslik: str) -> None:
    """Bölüm öğeleri gerçekten yazılabilir mi? Değilse NEDEN olmadığını söyle."""
    if not ogeler:
        raise TaslakHatasi(
            f"'{baslik}' bölümü boş gönderildi. En az bir öğe gerekiyor: "
            '{"tur": "paragraf", "metin": "..."}'
        )

    for sira, oge in enumerate(ogeler, start=1):
        yer = f"'{baslik}' bölümü, {sira}. öğe"

        if not isinstance(oge, dict):
            raise TaslakHatasi(f"{yer}: nesne olmalı, {type(oge).__name__} geldi.")

        tur = oge.get("tur", "paragraf")

        if tur not in _OGE_ALANLARI:
            raise TaslakHatasi(
                f"{yer}: bilinmeyen tür {tur!r}. "
                f"Geçerli türler: {', '.join(sorted(_OGE_ALANLARI))}."
            )

        for alan in _OGE_ALANLARI[tur]:
            deger = oge.get(alan)

            if alan == "metin":
                if not isinstance(deger, str) or not deger.strip():
                    raise TaslakHatasi(
                        f"{yer} ({tur}): 'metin' dolu bir yazı olmalı. "
                        'Doğru şekli: {"tur": "%s", "metin": "..."}' % tur
                    )
            elif not isinstance(deger, list) or not deger:
                raise TaslakHatasi(
                    f"{yer} (tablo): '{alan}' dolu bir dizi olmalı. "
                    'Doğru şekli: {"tur": "tablo", "baslik": "Tablo 1: ...", '
                    '"basliklar": ["A","B"], "satirlar": [["1","2"]]}'
                )


def kapak_alanlarini_dogrula(alanlar: dict) -> None:
    """Kapakta tanınmayan alan varsa reddet.

    Sessizce yutmak, modelin ``rapor_date`` yazıp tarihin boş kalmasına yol
    açıyordu -- belge [EKSİK] ile basıldı ve kimse fark etmedi.
    """
    bilinmeyen = sorted(set(alanlar) - _KAPAK_ALANLARI)

    if bilinmeyen:
        raise TaslakHatasi(
            f"Kapakta tanınmayan alan: {', '.join(bilinmeyen)}. "
            f"Geçerli alanlar: {', '.join(sorted(_KAPAK_ALANLARI))}."
        )


def ozet_yaz(kimlik: str, satirlar: list[str]) -> Taslak:
    """Özeti yaz -- ÜZERİNE yazar.

    Ayrı bir işlem, çünkü özet doğal olarak EN SON yazılıyor: MADDE 7 özeti
    "raporun her 30 sayfası için en fazla 1 sayfa" diye tanımlıyor, yani
    metnin ne kadar olduğu bilinmeden yazılamıyor. ``baslat`` sırasında
    istemek, modeli daha hiçbir bölüm yokken özet uydurmaya zorlardı.
    """
    temiz = [str(s).strip() for s in satirlar if str(s).strip()]

    if not temiz:
        raise TaslakHatasi(
            "Özet boş gönderildi. En az bir cümle gerekiyor "
            "(MADDE 7: kapak ile rapor metni arasında özet sayfası bulunur)."
        )

    taslak = yukle(kimlik)
    taslak.ozet = temiz
    _yaz(taslak)

    return taslak
