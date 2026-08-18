<p align="center">
  <img src="apps/desktop/assets/icon.png" alt="The Fool" width="128">
</p>

<h1 align="center">The Fool</h1>

<p align="center">
  <em>A local-first AI agent — desktop app, CLI, and TUI.</em>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-C41E3A?style=for-the-badge" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Local--first-LM%20Studio-C41E3A?style=for-the-badge" alt="Local-first">
</p>

---

## What this is

The Fool is a **fork of [Hermes Agent](https://github.com/NousResearch/hermes-agent)**
by Nous Research, rebranded and reconfigured to run entirely on your own machine.

It keeps everything that makes the upstream agent good — the tool-calling loop,
the skill-learning system, persistent memory, session search, the desktop app,
the TUI — and changes three things:

1. **Local by default.** The model runs on your hardware through
   [LM Studio](https://lmstudio.ai). No account, no credits, no per-token cost.
2. **No phone-home.** The model catalog ships with the release instead of being
   fetched on every launch. Diagnostics upload is off — your logs stay on your
   machine.
3. **Its own identity.** Separate app id, separate data directory, its own
   update channel. It can sit next to an upstream Hermes install without
   touching its config, sessions, or memory.

Remote providers still work. Point it at OpenRouter, Anthropic, OpenAI or any
OpenAI-compatible endpoint whenever you want more capability than local weights
give you — the whole provider layer is intact.

## Requirements

- [LM Studio](https://lmstudio.ai) with a **tool-calling capable** model loaded.
  This matters: The Fool edits files and runs commands. A model without tool
  calling can only chat.
- ~16 GB VRAM for a comfortable 9B-class model (less works, with a smaller model)

Python and Node are **not** prerequisites — the installer below fetches its own
copies. You only need them if you plan to build from source.

## Install

One command. No installer to download, no release page to visit.

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/zaorenn/thefool-desktop/main/scripts/install.ps1 | iex
```

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/zaorenn/thefool-desktop/main/scripts/install.sh | bash
```

That installs the terminal agent and puts `fool` on your PATH. Open a new
terminal and it's there:

```bash
fool --help
fool            # interactive chat
```

### Desktop app

Once the CLI is installed, one more command builds and launches the desktop
app from the same checkout:

```bash
fool desktop
```

### Updating

One command updates **both** — the terminal agent and the desktop app:

```bash
fool update
```

The desktop rebuild only runs if you have actually used `fool desktop`, so a
terminal-only install never pays for an Electron build.

## First run

There is nothing to configure. On first launch The Fool probes the fixed local
endpoints and adopts whatever it finds:

| Runner | Endpoint |
|---|---|
| LM Studio | `127.0.0.1:1234` |
| Ollama | `127.0.0.1:11434` |
| Jan | `127.0.0.1:1337` |
| llama.cpp | `127.0.0.1:8080` |
| vLLM | `127.0.0.1:8000` |
| text-generation-webui | `127.0.0.1:5000` |
| Bionic | `127.0.0.1:3000` |

Start LM Studio with a tool-calling model loaded, then start The Fool — no
provider picker, no base URL, no model id to copy. An existing provider choice
is never overwritten.

To set it by hand instead, `~/.fool/config.yaml`:

```yaml
model:
  default: "qwen/qwen3.5-9b"   # must match LM Studio's /v1/models id
  provider: "lmstudio"
display:
  skin: "the-fool"
```

## Building from source

For hacking on The Fool itself:

```bash
git clone https://github.com/zaorenn/thefool-desktop.git
cd thefool-desktop

uv venv .venv --python 3.13
uv pip install --python .venv -e ".[dev]"
npm install

.venv/Scripts/fool --help                  # CLI
npm run dev --workspace apps/desktop       # desktop, with hot reload
```

> `npm install` — **without** `--workspace`. A workspace-scoped install prunes
> other workspaces' packages and silently breaks the build. See
> [docs/fool/DEVELOPMENT.md](docs/fool/DEVELOPMENT.md).

## How the fork stays maintainable

Forks usually die by drifting: the rebrand touches everything, every upstream
merge conflicts everywhere, merging stops, and the fork rots.

The Fool is built so that doesn't happen. Nearly all of its code lives in
directories upstream doesn't know about (`fool/`, `apps/desktop/src/fool/`),
where a merge conflict is impossible. Upstream files carry a small, counted set
of **seams**, each marked `FOOL-SEAM:` and covered by a test that fails loudly
if a merge ever swallows one.

Most of the branding isn't a set of edited strings — it's a *transform* applied
at load time to the i18n catalog, argparse help, command descriptions, skill
descriptions and tool schemas. When upstream adds new text, it gets rebranded
automatically. Maintenance cost stays flat.

```bash
git fetch upstream
git merge upstream/main
python -m pytest tests/fool/ -q     # seam + branding guards
```

Details: [ARCHITECTURE.md](docs/fool/ARCHITECTURE.md) ·
[SEAMS.md](docs/fool/SEAMS.md) · [RELEASE.md](docs/fool/RELEASE.md)

## Credit

The Fool exists because [Hermes Agent](https://github.com/NousResearch/hermes-agent)
is MIT-licensed and genuinely well built. The agent loop, skill system, memory
architecture and desktop shell are Nous Research's work. This fork changes the
name, the surface and the defaults — not the engineering underneath.

**This project is not affiliated with or endorsed by Nous Research.**
For the original, go upstream — it's excellent.

## License

MIT — see [LICENSE](LICENSE). Upstream copyright is retained alongside this
fork's own.
