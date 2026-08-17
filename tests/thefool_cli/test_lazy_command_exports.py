"""The decomposed command modules stay lazy after `import thefool_cli.main`.

The main.py decomposition re-exports the sessions/update/dashboard command
surface from thefool_cli.main so argparse wiring and monkeypatches keep
resolving. Those re-exports must not import the modules eagerly: every
`hermes` invocation (including `hermes --version`) would pay for update_cmd's
dependency chain (jwt, click, ...) even when no subcommand runs.
"""

import subprocess
import sys
import textwrap

import thefool_cli.main


def test_importing_main_does_not_import_command_modules():
    code = textwrap.dedent(
        """
        import sys
        import thefool_cli.main  # noqa: F401
        loaded = [
            m
            for m in (
                "thefool_cli.update_cmd",
                "thefool_cli.sessions_cmd",
                "thefool_cli.dashboard_procs",
            )
            if m in sys.modules
        ]
        assert not loaded, f"eagerly imported: {loaded}"
        """
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr


def test_lazy_reexports_resolve_to_real_objects():
    import thefool_cli.dashboard_procs
    import thefool_cli.sessions_cmd
    import thefool_cli.update_cmd

    assert thefool_cli.main.cmd_sessions is thefool_cli.sessions_cmd.cmd_sessions
    assert (
        thefool_cli.main._cmd_update_impl is thefool_cli.update_cmd._cmd_update_impl
    )
    assert (
        thefool_cli.main._scan_dashboard_processes
        is thefool_cli.dashboard_procs._scan_dashboard_processes
    )
    # Back-compat alias resolves to the kill helper.
    assert (
        thefool_cli.main._warn_stale_dashboard_processes
        is thefool_cli.dashboard_procs._kill_stale_dashboard_processes
    )


def test_lazy_reexports_accept_monkeypatch(monkeypatch):
    sentinel = object()
    monkeypatch.setattr("thefool_cli.main._cmd_update_impl", sentinel)
    assert thefool_cli.main._cmd_update_impl is sentinel
