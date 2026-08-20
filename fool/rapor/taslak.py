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
) -> Taslak:
    """Yeni taslak aç -- varsa ÜZERİNE YAZAR."""
    if tur not in RAPOR_TURLERI:
        raise TaslakHatasi(
            f"bilinmeyen rapor türü: {tur} (geçerli: {', '.join(sorted(RAPOR_TURLERI))})"
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
    }


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
        "bolumler": taslak.bolumler,
        "ekler": taslak.ekler,
        "imza_yer": taslak.imza_yer,
        "imza_tarih": taslak.imza_tarih,
    }
