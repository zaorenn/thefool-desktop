#!/usr/bin/env python3
"""
FOOL-SEAM: resmi-rapor

Resmî rapor araçlarının kayıt yeri.

Neden bu dosya ``tools/`` altında
---------------------------------
Kayıt defteri yalnızca ``tools/*.py`` dosyalarını tarıyor
(``tools/registry.py::discover_builtin_tools``): bir modül orada değilse ve
kimse onu elle ithal etmiyorsa araçları HİÇ kaydolmuyor.

Bu sessiz bir tuzak ve depoda bir örneği zaten var: ``fool/output_file.py``
kendini kaydediyor ama ``tools/`` altında olmadığı için yalnızca test onu
ithal ediyor -- yani ``output_file`` takımı takım listesinde görünüyor,
``write_output`` aracı ise çalışan üründe hiç var olmuyor. Ölçüldü:
``discover_builtin_tools()`` sonrası kayıtlı 88 araç içinde ``write_output``
yok; ``import fool.output_file`` yapılınca beliriyor.

Aynı hataya düşmemek için mantık Zone A'da (``fool/rapor/``), kayıt burada.
Bu dosya bilerek ince: yalnızca şema ve bağlama.
"""

from __future__ import annotations

from fool.rapor import arac
from tools.registry import registry

KAYNAK_OKU_SCHEMA = {
    "name": "rapor_kaynak_oku",
    "description": (
        "Read a source document (.pdf/.docx/.txt) for official report work, "
        "with an automatic text-quality check.\n\n"
        "Pass `sorgu` to retrieve ONLY the parts relevant to a question — "
        "required for large references (a 73-page guide is ~44k tokens, the "
        "directive ~135k). Without `sorgu` the whole text is returned, but "
        "only if it fits `token_butcesi`.\n\n"
        "If the document's text layer is broken (e.g. a PDF whose font drops "
        "a letter), the text is NOT returned — you get the reason instead. "
        "Do not work around this; ask the user for an OCR'd copy."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "yol": {"type": "string", "description": "Path to the document."},
            "sorgu": {
                "type": "string",
                "description": (
                    "What you need from it, in Turkish or English. Only the "
                    "matching sections are returned, in document order."
                ),
            },
            "token_butcesi": {
                "type": "integer",
                "description": "Max tokens to return (default 8000).",
            },
        },
        "required": ["yol"],
    },
}

ORNEK_OGREN_SCHEMA = {
    "name": "rapor_ornek_ogren",
    "description": (
        "Learn HOW an example official report is written: section order, "
        "annex-reference shape, closing formulas, sub-headings, and its "
        "font/size.\n\n"
        "Returns a compact skeleton, not the example's text — measured 6,384 "
        "tokens down to 226. The example's sentences are deliberately "
        "withheld so another investigation's names and dates cannot leak "
        "into the new report."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "yol": {"type": "string", "description": "Path to the example .docx."}
        },
        "required": ["yol"],
    },
}

YARIM_COZUMLE_SCHEMA = {
    "name": "rapor_yarim_cozumle",
    "description": (
        "Analyse a half-finished report: which sections exist, which are "
        "missing or empty, and the exact formatting it uses (font, size, "
        "line spacing, alignment, margins).\n\n"
        "Reads the report IN FULL — a skipped paragraph means completed text "
        "that contradicts what is already written. Use the returned `bicim` "
        "as `bicim_kaynagi` when writing, so the completion matches the "
        "existing half exactly."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "yol": {"type": "string", "description": "Path to the half report .docx."}
        },
        "required": ["yol"],
    },
}

RAPOR_YAZ_SCHEMA = {
    "name": "rapor_yaz",
    "description": (
        "Write a structured report to .docx with the directive's layout "
        "applied by code (A4, margins, Times New Roman 12, justified, 1cm "
        "indent, 'n/N' page numbers on the body section only, Turkish "
        "uppercase). You supply CONTENT; formatting is not yours to get "
        "right.\n\n"
        "Report types: inceleme, disiplin, adli, on_inceleme.\n\n"
        "Any field you leave out stays [EKSİK] in the document and is listed "
        "back to you — never invent a date, file number or article reference."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "rapor_json": {
                "type": "string",
                "description": (
                    "JSON object: {tur, kapak:{bakanlik,baskanlik,baslik,konu,"
                    "gorev_emri_tarih,gorev_emri_sayi,rapor_tarih,rapor_sayi,"
                    "ek_adedi,mufettis_ad,gizli}, ozet:[...], bolumler:["
                    "{baslik, ogeler:[{tur:'paragraf'|'alt_baslik'|'alinti'|"
                    "'tablo', metin, ek, kaynak, baslik, basliklar, satirlar}]}"
                    "], ekler:[{no,icerik,sayfa_sayisi}], imza_yer, imza_tarih}"
                ),
            },
            "hedef": {"type": "string", "description": "Output .docx path."},
            "bicim_kaynagi": {
                "type": "string",
                "description": (
                    "Optional .docx to inherit formatting from — use the half "
                    "report being completed so both halves look identical."
                ),
            },
        },
        "required": ["rapor_json", "hedef"],
    },
}


# Kayitlar EN UST SEVIYEDE, ``try`` icinde DEGIL.
#
# ``tools/registry.py::_module_registers_tools`` yalnizca modul govdesindeki
# en ust seviye ifadelere bakiyor (``ast.parse(...).body``). Kayitlari bir
# ``try`` blogunun icine koydugumda tarayici bu dosyayi "arac kaydetmiyor"
# diye isaretledi ve modul hic ithal edilmedi -- olculdu: kesif sonrasi
# kayitli rapor araci 0, dogrudan ithal edince 4.
registry.register(
    name="rapor_kaynak_oku",
    toolset="rapor",
    schema=KAYNAK_OKU_SCHEMA,
    handler=lambda args, **kw: arac.kaynak_oku(
        yol=args.get("yol", ""),
        sorgu=args.get("sorgu"),
        token_butcesi=int(args.get("token_butcesi", 8000)),
    ),
    emoji="📑",
)

registry.register(
    name="rapor_ornek_ogren",
    toolset="rapor",
    schema=ORNEK_OGREN_SCHEMA,
    handler=lambda args, **kw: arac.ornek_ogren(yol=args.get("yol", "")),
    emoji="🧭",
)

registry.register(
    name="rapor_yarim_cozumle",
    toolset="rapor",
    schema=YARIM_COZUMLE_SCHEMA,
    handler=lambda args, **kw: arac.yarim_cozumle(yol=args.get("yol", "")),
    emoji="🧩",
)

registry.register(
    name="rapor_yaz",
    toolset="rapor",
    schema=RAPOR_YAZ_SCHEMA,
    handler=lambda args, **kw: arac.rapor_yaz(
        rapor_json=args.get("rapor_json", "{}"),
        hedef=args.get("hedef", ""),
        bicim_kaynagi=args.get("bicim_kaynagi"),
    ),
    emoji="📄",
)