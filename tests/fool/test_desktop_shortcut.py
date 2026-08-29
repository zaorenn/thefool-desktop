"""Terminalden kuran kullanıcı da masaüstünde kısayol görmeli.

İstenen: "``fool desktop`` ilk çalıştığında ... masaüstünde exesi olmalı,
kullanıcı isterse hâlâ terminalden çalıştırabilmeli ya da masaüstü
kısayolundan açabilmeli."

Kısayolu üreten kod ``scripts/install.ps1``de vardı ama yalnızca installer
yolunda koşuyordu; iki kurulum yolu aynı sonucu vermiyordu.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from fool_cli.main import _ensure_windows_desktop_shortcut


def test_exe_YOKKEN_hicbir_sey_yapmiyor(tmp_path, monkeypatch) -> None:
    calls: list = []
    monkeypatch.setattr("fool_cli.main.subprocess.run", lambda *a, **k: calls.append(a))

    _ensure_windows_desktop_shortcut(None)
    _ensure_windows_desktop_shortcut(tmp_path / "yok.exe")

    assert calls == []


@pytest.mark.skipif(sys.platform != "win32", reason="kisayol Windows'a ozgu")
def test_VAR_OLAN_kisayolun_uzerine_yazmiyor(tmp_path, monkeypatch) -> None:
    """Kullanıcının taşıdığı/yeniden adlandırdığı kısayolu geri getirmek,
    onun kararını geri almak olurdu."""
    desktop = tmp_path / "Desktop"
    desktop.mkdir()
    (desktop / "The Fool.lnk").write_text("var", encoding="utf-8")
    exe = tmp_path / "TheFool.exe"
    exe.write_text("x", encoding="utf-8")

    calls: list = []
    monkeypatch.setattr("os.path.expanduser", lambda _p: str(tmp_path))
    monkeypatch.setattr("fool_cli.main.subprocess.run", lambda *a, **k: calls.append(a))

    _ensure_windows_desktop_shortcut(exe)

    assert calls == []


@pytest.mark.skipif(sys.platform != "win32", reason="kisayol Windows'a ozgu")
def test_YOKKEN_olusturuluyor(tmp_path, monkeypatch) -> None:
    desktop = tmp_path / "Desktop"
    desktop.mkdir()
    exe = tmp_path / "TheFool.exe"
    exe.write_text("x", encoding="utf-8")

    calls: list = []
    monkeypatch.setattr("os.path.expanduser", lambda _p: str(tmp_path))
    monkeypatch.setattr(
        "fool_cli.main.subprocess.run", lambda *a, **k: calls.append(a[0]) or None
    )

    _ensure_windows_desktop_shortcut(exe)

    assert len(calls) == 1
    script = calls[0][-1]
    assert "The Fool.lnk" in script
    assert str(exe) in script


@pytest.mark.skipif(sys.platform != "win32", reason="kisayol Windows'a ozgu")
def test_powershell_DUSERSE_patlamiyor(tmp_path, monkeypatch) -> None:
    """Kısayol bir kolaylık; oluşturulamaması uygulamayı açtırmamalı."""
    desktop = tmp_path / "Desktop"
    desktop.mkdir()
    exe = tmp_path / "TheFool.exe"
    exe.write_text("x", encoding="utf-8")

    monkeypatch.setattr("os.path.expanduser", lambda _p: str(tmp_path))

    def _boom(*_a, **_k):
        raise OSError("powershell yok")

    monkeypatch.setattr("fool_cli.main.subprocess.run", _boom)

    _ensure_windows_desktop_shortcut(exe)  # yükselmemeli
