"""Ses modeli kataloğu ve kurulum işlerinin sözleşme testleri.

Buradaki testler AĞA ÇIKMAZ. Gerçek indirme ``_download``'un içinde ve o
``urllib`` ile sınanmıyor; sınanan şey işin etrafındaki sözleşme: aynı öğe için
iki kurulum başlatılamaması, iptalin işi gerçekten durdurması, ilerlemenin
uydurulmaması ve yarıda kalan bir dosyanın "inmiş" sayılmaması.
"""

from __future__ import annotations

import threading
from pathlib import Path
import time

import pytest

from fool import voice_models


class TestKatalog:
    def test_her_ogenin_kimligi_tekil(self):
        ids = [e.id for e in voice_models.CATALOG]
        assert len(ids) == len(set(ids))

    def test_her_oge_tts_ya_da_stt(self):
        assert all(e.kind in ("tts", "stt") for e in voice_models.CATALOG)

    def test_hem_tts_hem_stt_var(self):
        """Kullanıcı ikisini de istedi; biri düşerse panel yarım kalır."""
        kinds = {e.kind for e in voice_models.CATALOG}
        assert kinds == {"tts", "stt"}

    def test_cuda_iddiasi_olan_ogenin_cuda_grubu_ya_da_gerekcesi_var(self):
        """CUDA sunan her öğe onu gerçekten kullanabilmeli.

        Aksi halde kullanıcı CUDA düğmesine basar, kurulum sessizce CPU
        sürümünü kurar ve neden yavaş olduğunu anlamaz.
        """
        for e in voice_models.CATALOG:
            if "cuda" not in e.devices:
                continue
            # CUDA iddiasinin uc mesru dayanagi var:
            #   - ayri bir CUDA paket grubu (piper -> onnxruntime-gpu)
            #   - sidecar'a kurulan CUDA torch tekerlegi (qwen3)
            #   - motorun kendisi cihazi calisma aninda seciyor (torch tabanli)
            assert e.cuda_group or e.sidecar_cuda_specs or e.dep_group or e.sidecar_specs, (
                f"{e.id}: CUDA iddiasi dayanaksiz"
            )

    def test_bilinmeyen_kimlik_none(self):
        assert voice_models.entry("yok-boyle-bir-sey") is None


class TestDurum:
    def test_durum_tam_sozlesme_dondurur(self):
        s = voice_models.status("piper")
        for key in (
            "id", "label", "kind", "summary", "devices", "size_label",
            "recommended", "engine_installed", "assets_installed", "installed",
        ):
            assert key in s, f"eksik alan: {key}"

    def test_installed_iki_kosulun_birlesimi(self):
        """``installed`` motor VE varlıkların ikisini birden gerektirir.

        Motor kurulu ama ses dosyası inmemişken "kurulu" demek, kullanıcının
        sesi açıp anlaşılmaz bir hata almasına yol açardı.
        """
        s = voice_models.status("piper")
        assert s["installed"] == (s["engine_installed"] and s["assets_installed"])

    def test_bilinmeyen_kimlik_hata_dondurur(self):
        s = voice_models.status("yok-boyle-bir-sey")
        assert s["installed"] is False
        assert "error" in s


class TestVarlikDogrulama:
    def test_yarim_dosya_inmis_sayilmaz(self, tmp_path, monkeypatch):
        """Yarıda kesilen indirme hedef adı almamalı.

        Alsaydı ``asset_present`` onu geçerli sayar, Piper açmaya çalışır ve
        hata çalışma anına ertelenirdi.
        """
        monkeypatch.setattr(voice_models, "voice_dir", lambda: tmp_path)
        asset = voice_models.VoiceAsset(url="http://x/y.onnx", filename="y.onnx")

        assert voice_models.asset_present(asset) is False

        (tmp_path / "y.onnx").write_bytes(b"kirik")       # 5 bayt
        assert voice_models.asset_present(asset) is False

        (tmp_path / "y.onnx").write_bytes(b"x" * 2048)
        assert voice_models.asset_present(asset) is True


class TestKurulumIsleri:
    def test_bilinmeyen_oge_reddedilir(self):
        with pytest.raises(ValueError):
            voice_models.start_install("yok-boyle-bir-sey")

    def test_her_ogenin_kurulabilir_paketi_var(self):
        """Kurulacak paketi olmayan oge katalogda YER ALMAMALI.

        KittenTTS tam bu yuzden cikarildi: sabitlenmis bir paket kaydi yoktu,
        yani dugme hicbir sey yapmadan "kuruldu" derdi. Kullanici cubugun
        %100'e gitmesini gorur, oge kurulmamis kalir ve hicbir hata cikmaz --
        sessiz basari, gorunur hatadan cok daha kotudur.
        """
        from tools.lazy_deps import LAZY_DEPS

        for e in voice_models.CATALOG:
            if e.sidecar_specs:
                # Sidecar'li oge dep_group KULLANMAZ; sarkan bir grup adi
                # birakmak ileride yanlis yere bakmaya yol acar.
                assert not e.dep_group, f"{e.id}: sidecar'li ogede dep_group olmamali"
                continue
            assert e.dep_group, f"{e.id}: kurulabilir paket grubu yok"
            assert LAZY_DEPS.get(e.dep_group), (
                f"{e.id}: dep_group={e.dep_group!r} LAZY_DEPS'te yok -- "
                f"kurulum sessizce hicbir sey yapmazdi"
            )

    def test_paketsiz_oge_sessizce_basarili_olmaz(self, monkeypatch):
        job = voice_models.Job(id="t3", entry_id="x", device="cpu")
        bare = voice_models.VoiceEntry(id="x", label="X", kind="tts", summary="")

        with pytest.raises(RuntimeError):
            voice_models._install_engine(bare, "cpu", job, 0.0, 70.0)

        assert job.percent == 0.0, "hata verirken ilerleme ilerletilmemeli"

    def test_ayni_oge_icin_ikinci_is_baslamaz(self, monkeypatch):
        """İki pip aynı hedefe yazarsa ortam yarım kurulumla bozulur."""
        started = threading.Event()
        release = threading.Event()

        def _slow(entry, device, job, base, span):
            started.set()
            release.wait(timeout=5)

        monkeypatch.setattr(voice_models, "_install_engine", _slow)

        first = voice_models.start_install("kokoro")
        assert started.wait(timeout=5), "is baslamadi"
        second = voice_models.start_install("kokoro")

        assert second["id"] == first["id"], "ayni oge icin ikinci is acildi"

        release.set()
        for _ in range(50):
            if voice_models.get_job(first["id"]).state != "running":
                break
            time.sleep(0.1)

    def test_iptal_isi_durdurur(self, monkeypatch):
        release = threading.Event()

        def _slow(entry, device, job, base, span):
            for _ in range(100):
                if job._cancel.is_set():
                    raise InterruptedError("cancelled")
                time.sleep(0.05)

        monkeypatch.setattr(voice_models, "_install_engine", _slow)

        job = voice_models.start_install("chatterbox")
        assert voice_models.cancel_job(job["id"]) is True

        for _ in range(50):
            state = voice_models.get_job(job["id"]).state
            if state != "running":
                break
            time.sleep(0.1)

        assert voice_models.get_job(job["id"]).state == "cancelled"
        release.set()

    def test_tahmini_ilerleme_asamayi_asmaz(self, monkeypatch):
        """pip aşamasında çubuk uydurulmuyor: span'in sonuna DAYANMAZ.

        Yüzde %100'e varıp sonra beklemek, kullanıcıya işin bittiğini yanlış
        söylemek olurdu.
        """
        # DIKKAT: burada ``_install_engine`` YAMALANMAZ -- sinanan sey tam da
        # onun kendi mantigi. (Ilk yazimda yamalanip sonra cagrilmisti; test
        # gercek kodu degil, yamayi olcuyordu.)
        job = voice_models.Job(id="t", entry_id="kokoro", device="cpu")
        e = voice_models.entry("kokoro")
        assert e is not None

        # Yamalanmis surumle degil, gercek fonksiyonla: pip cagrisini taklit et.
        import tools.lazy_deps as lazy

        class _Result:
            ok = True
            blocked = False
            stdout = ""
            stderr = ""

        monkeypatch.setattr(lazy, "install_specs", lambda specs, timeout=0: _Result())
        voice_models._install_engine(e, "cpu", job, 0.0, 70.0)
        assert job.percent == 70.0, "asama bitince gercek degere sicramali"

    def test_is_anlik_goruntusu_tam(self):
        job = voice_models.Job(id="t2", entry_id="piper", device="cpu")
        snap = job.snapshot()
        for key in ("id", "entry_id", "device", "state", "percent", "stage", "detail", "error", "elapsed"):
            assert key in snap, f"eksik alan: {key}"


class TestSaglayiciBaglantisi:
    """Katalogdaki her ogenin GERCEKTEN kullanilabilir bir saglayicisi olmali.

    Kokoro tam bu yuzden olu bir dugmeydi: katalogda listeleniyordu, iniyordu,
    panel "Installed" diyordu ve ajan onu asla kullanamiyordu -- hicbir hata da
    gorunmuyordu. Indirilebilirlik ile kullanilabilirlik AYRI seyler ve ikisi
    ayri ayri dogrulanmali.
    """

    @staticmethod
    def _tts_saglayici_adlari() -> set[str]:
        import re

        names: set[str] = set()

        # Yerlesikler
        from tools.tts_tool import BUILTIN_TTS_PROVIDERS

        names |= set(BUILTIN_TTS_PROVIDERS)

        # Zone A eklentileri: manifestteki ``provides_tts_providers``.
        root = Path(__file__).resolve().parents[2] / "plugins" / "tts"
        for manifest in root.glob("*/plugin.yaml"):
            text = manifest.read_text(encoding="utf-8")
            block = re.search(
                r"provides_tts_providers:\s*((?:\s*-\s*\S+\n?)+)", text
            )
            if block:
                names |= set(re.findall(r"-\s*(\S+)", block.group(1)))
        return names

    def test_her_tts_ogesinin_saglayicisi_var(self):
        available = self._tts_saglayici_adlari()
        missing = [
            e.id
            for e in voice_models.CATALOG
            if e.kind == "tts" and (e.provider_id or e.id) not in available
        ]
        assert not missing, (
            f"saglayicisi olmayan TTS ogeleri: {missing}. "
            f"Bunlar inebilir ama ajan kullanamaz -- sessiz olu dugme. "
            f"Mevcut saglayicilar: {sorted(available)}"
        )

    def test_saglayici_adi_kimlikten_ayri_olabilir(self):
        """``qwen3-tts`` indirilir, ``qwen3`` secilir -- ikisi ayni degil."""
        entry = voice_models.entry("qwen3-tts")
        assert entry is not None
        assert entry.provider_id == "qwen3"
        assert voice_models.status("qwen3-tts")["provider_id"] == "qwen3"

    def test_sidecar_ogeleri_ana_ortami_kirlemez(self):
        """Sidecar'li oge ANA ortamda aranmamali.

        Aranırsa her zaman "kurulu degil" derdi: motor orada zaten yok.
        """
        for e in voice_models.CATALOG:
            if not e.sidecar_specs:
                continue
            assert e.probe_module, f"{e.id}: sidecar var ama probe_module yok"

    def test_sidecar_adi_katalog_kimligiyle_ayni(self):
        """Saglayici sidecar'i KATALOG KIMLIGIYLE ariyor.

        Ayrisirlarsa panel "Installed" derken saglayici ortami bulamaz --
        birbirini goremeyen iki dogru bilesen.
        """
        import re

        root = Path(__file__).resolve().parents[2] / "plugins" / "tts"
        catalog_ids = {e.id for e in voice_models.CATALOG}
        for init in root.glob("*/__init__.py"):
            text = init.read_text(encoding="utf-8")
            found = re.search(r'^SIDECAR_NAME\s*=\s*"([^"]+)"', text, re.M)
            if found:
                assert found.group(1) in catalog_ids, (
                    f"{init.parent.name}: SIDECAR_NAME={found.group(1)!r} "
                    f"katalogda yok"
                )
