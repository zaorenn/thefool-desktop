"""
Sayfa numarasındaki TOPLAMI gerçek sayıyla sabitle.

Ölçülen sorun
-------------
MADDE 8(9) sayfa numarasını "1/30" biçiminde istiyor: bölü işaretinden sonrası
RAPOR METNİNİN toplam sayfası. Bunu OOXML'de anlatmanın yolu ``SECTIONPAGES``
alanı -- "bu bölümün sayfa sayısı". Word bunu hesaplıyor.

LibreOffice hesaplamıyor. Üretilen 5 sayfalık raporda ölçüldü::

    sayfa 2: "1/1"      sayfa 3: "2/1"      sayfa 4: "3/1"

Metin üç sayfa ama toplam hep 1 çıkıyor. Yani belge Word'de doğru, LibreOffice
ile açan ya da PDF'e çeviren için yönergeye aykırı. Resmî evrakta "hangi
programla açtığına bağlı" kabul edilebilir değil.

Çözüm: toplamı ALAN olarak bırakmak yerine, belgeyi bir kez bastırıp metnin
kaç sayfa olduğunu SAYMAK ve o sayıyı üstbilgiye düz metin olarak yazmak.
Sayfa numarasının kendisi (``PAGE``) alan olarak kalıyor; değişen yalnızca
toplam.

Neden sayarak, hesaplayarak değil
---------------------------------
Metnin kaç sayfa tuttuğu yazı tipine, tabloların kırılmasına ve paragraf
uzunluklarına bağlı; kestirilemiyor. Belgeyi zaten doğru sayfalayan programa
bastırıp saymak tek güvenilir yol.

Dönüştürücü yoksa bu adım atlanıyor ve alan olduğu gibi kalıyor -- Word'de
yine doğru çalışıyor, başka yerde eksik kalıyor ve bu AÇIKÇA bildiriliyor.

Zone A: upstream bu dosyayı bilmiyor.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import zipfile
from dataclasses import dataclass
from pathlib import Path

from .pdf_cikti import donusturucu_bul, pdf_uret

#: Üstbilgideki sayfa numarası: sayfanın EN BAŞINDA "3/12" gibi.
#
#: Satırın tamamı aranmıyor: ``pdftotext`` üstbilgiyi gövdenin ilk satırıyla
#: aynı satıra koyabiliyor ("1/1 I. GİRİŞ"), o yüzden sayfa başında olması
#: yetiyor. Ölçüldü -- tam satır araması hiçbir sayfayı saymamıştı.
_NUMARA = re.compile(r"\A\s*\d+\s*/\s*\d+")


@dataclass
class Sabitleme:
    """Toplamı sabitleme denemesinin sonucu."""

    yapildi: bool
    metin_sayfasi: int = 0
    gerekce: str = ""


def _pdf_sayfa_metinleri(pdf: Path) -> list[str]:
    arac = shutil.which("pdftotext")

    if arac is None:
        return []

    sonuc = subprocess.run(
        [arac, "-enc", "UTF-8", str(pdf), "-"],
        capture_output=True,
        # stdin ACIKCA: Windows'ta bos stdin ile subprocess asili kaliyor.
        stdin=subprocess.DEVNULL,
        check=False,
    )

    if sonuc.returncode != 0:
        return []

    return sonuc.stdout.decode("utf-8", "replace").split("\f")


def metin_sayfalarini_say(pdf: Path) -> int:
    """Kaç sayfa ÜSTBİLGİ taşıyor? -- yani rapor metni kaç sayfa.

    Kapak, özet ve ek dizini boş üstbilgiye bağlı (bkz. ``docx_yazici``), o
    yüzden numarası olan sayfalar tam olarak metin bölümü.
    """
    return sum(1 for sayfa in _pdf_sayfa_metinleri(pdf) if _NUMARA.search(sayfa))


def _header_sabitle(ham: str, toplam: int) -> str:
    """``SECTIONPAGES`` alanını düz sayıyla değiştir."""
    # Alan bir dizi run: begin / instrText / separate / gecici deger / end.
    # Tamamini tek bir metin run'i ile degistiriyoruz.
    kalip = re.compile(
        r"<w:r><w:fldChar w:fldCharType=\"begin\"/></w:r>"
        r"<w:r><w:instrText[^>]*> SECTIONPAGES </w:instrText></w:r>"
        r"<w:r><w:fldChar w:fldCharType=\"separate\"/></w:r>"
        r"<w:r><w:t>[^<]*</w:t></w:r>"
        r"<w:r><w:fldChar w:fldCharType=\"end\"/></w:r>"
    )

    return kalip.sub(f"<w:r><w:t>{toplam}</w:t></w:r>", ham, count=1)


def sabitle(docx: str | Path) -> Sabitleme:
    """Belgeyi bastır, metin sayfalarını say, toplamı üstbilgiye yaz."""
    docx = Path(docx)

    if not docx.exists():
        return Sabitleme(False, gerekce=f"belge bulunamadı: {docx}")

    if donusturucu_bul() is None:
        return Sabitleme(
            False,
            gerekce=(
                "Dönüştürücü yok; sayfa toplamı alan olarak bırakıldı. "
                "Word'de doğru görünür, LibreOffice'te toplam 1 çıkar."
            ),
        )

    with zipfile.ZipFile(docx) as paket:
        if "word/header1.xml" not in paket.namelist():
            return Sabitleme(False, gerekce="belgede numaralı üstbilgi yok")

        parcalar = {ad: paket.read(ad) for ad in paket.namelist()}

    ham = parcalar["word/header1.xml"].decode("utf-8")

    if "SECTIONPAGES" not in ham:
        # Zaten sabitlenmis; yeniden saymak gereksiz.
        return Sabitleme(False, gerekce="toplam zaten sabit")

    sonuc = pdf_uret(docx)

    if not sonuc.basarili or sonuc.yol is None:
        return Sabitleme(False, gerekce=sonuc.gerekce)

    toplam = metin_sayfalarini_say(sonuc.yol)

    if toplam < 1:
        return Sabitleme(False, gerekce="metin sayfası sayılamadı")

    parcalar["word/header1.xml"] = _header_sabitle(ham, toplam).encode("utf-8")

    with zipfile.ZipFile(docx, "w", zipfile.ZIP_DEFLATED) as paket:
        for ad, veri in parcalar.items():
            paket.writestr(ad, veri)

    return Sabitleme(True, toplam)
