# Antler

**A desktop workbench for building LoRA training datasets from e621.**

Antler takes a dataset from search to training-ready in one place. Find an artist or character, download their posts with matching caption files, then tag, split, clean, upscale and review the set before you train on it.

Everything runs on your own machine. Antler talks to e621, and to your own ComfyUI or Ollama server if you choose to connect one. Nothing else leaves the computer.

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Dataset layout](#dataset-layout)
- [Models](#models)
- [Building a release](#building-a-release)
- [Development](#development)
- [Upgrading from Piper AIO](#upgrading-from-piper-aio)
- [License](#license)

## Features

### Collect

| Tool | What it does |
| --- | --- |
| **Artist Search** | Search an artist or character, preview their posts and download the ones you pick from the bar under the post filters (with a Tags only option to refresh captions without re-downloading images). Every image is saved with a `.txt` caption beside it. |
| **Post Lookup** | Fetch a single post by ID. |
| **Video Frames** | Pull the sharpest, most distinct frames from a video instead of sorting through thousands of near-duplicates. |

### Curate

| Tool | What it does |
| --- | --- |
| **Tag Editor** | Browse a dataset, edit captions, see tag frequency, and catch captions over the token budget or images below the size you need. Batch-tag with Hydra and review the tags it is unsure about. |
| **Comic Panels** | Split comic pages into panels and tag each panel with Hydra for review. Your corrections are remembered and applied to later panels. |
| **Image Cleanup** | Detect speech bubbles automatically, mark signatures and captions by hand, and remove them with Flux Fill on ComfyUI. Originals are kept in `bak/`. |
| **Image Upscaler** | Flag images below your target resolution and upscale them with UltraSharp V2 or one of the bundled ncnn models. |
| **Image Resizer** | Batch-resize a set to training resolution. |
| **Image Organizer** | Sort generated images into per-artist folders using their embedded metadata. |

### Prompt

| Tool | What it does |
| --- | --- |
| **Auto Prompter** | Turn post IDs into structured prompts. |
| **Prompt Editor** | Refine prompts by hand or with an LLM through Hugging Face or Ollama. |

## Requirements

- **Windows 10 or 11** (x64), **macOS** on Apple Silicon, or **Linux** (x64).
- **An e621 account** with an API key.
- Optional: a **ComfyUI** server with Flux Fill for Image Cleanup.
- Optional: **Ollama** or a **Hugging Face** token for the prompt tools.

The bundled ncnn upscalers and GPU-accelerated tagging (DirectML) are Windows-only. On macOS and Linux the Image Upscaler uses the UltraSharp V2 models and tagging runs on the CPU.

## Installation

Download the installer for your system from the [latest release](https://github.com/Piper260/Antler/releases/latest):

| System | File | Notes |
| --- | --- | --- |
| Windows | `Antler-Setup-<version>.exe` | Windows SmartScreen may warn because the installer isn't code-signed; choose **More info > Run anyway**. |
| macOS (Apple Silicon) | `Antler-<version>-mac-arm64.dmg` | The app isn't notarized. After dragging it to Applications, right-click it and choose **Open** the first time. |
| Linux | `Antler-<version>-linux-x86_64.AppImage` | Make it executable (`chmod +x`), then run it. |

Each file has a `.sha256` beside it to check the download.

On first launch Antler offers to download its models (about 1.5 GB for the recommended set). See [Models](#models).

### Running from source

You need Node.js 20 or newer.

```bash
git clone https://github.com/Piper260/Antler.git
cd Antler
npm install
npm start
```

## Configuration

Open **Settings** on first launch.

1. **e621 account.** Enter your username and API key (on e621: Account > API Access). Keys are encrypted on disk.
2. **Dataset folders.** Point **Artists** and **Characters** at where datasets should be saved. Both can point at the same folder.
3. **LLM (optional).** Connect Ollama or Hugging Face for the prompt tools.

Image Cleanup asks for the ComfyUI server address inside the tool.

## Dataset layout

Each artist or character gets one folder, prefixed with its type:

```
F:\Datasets\
├── artists_twang\
│   ├── 1234567.png
│   ├── 1234567.txt
│   └── shaded\          subfolders are scanned too
└── characters_Drift\
    ├── 2345678.jpg
    └── 2345678.txt
```

- The `artists_` and `characters_` prefixes are how Antler tells the two apart, which is why both settings can share one folder.
- Older folders without a prefix still work and take the type of the setting they live under.
- Anything Antler sets aside, such as originals before an upscale or cleanup, goes into `bak/` and is skipped by every scan.

## Models

The taggers, detectors and ONNX upscalers are too large for git. Antler offers to download them the first time it starts, and you can add or finish them at any time from **Settings > Models**.

| Pack | Size | Used by |
| --- | --- | --- |
| Hydra 3.5 tagger | 1.28 GB | Tag Editor, Comic Panels |
| Comic panels and speech bubbles | 181 MB | Comic Panels, Image Cleanup |
| UltraSharp V2 upscalers | 82 MB | Image Upscaler |
| Z3D tagger (optional) | 390 MB | Fallback when Hydra is missing |

Where the original author publishes the ONNX file Antler uses, it is downloaded straight from the author's Hugging Face page; each model in the list links to its home and shows its license. Hydra is only published as PyTorch weights, so it comes from Antler's own ONNX conversion. UltraSharp V2 is licensed for non-commercial use only.

Downloads go to `%APPDATA%\antler\models\`, which survives reinstalls and updates. Each file is checked against its SHA-256 before use, and an interrupted download resumes where it stopped. The small ncnn upscalers ship with the app.

If a model is missing, the tool that needs it says so and falls back where it can. Comic Panels uses gutter detection without its panel model, and Z3D can stand in for Hydra as the tagger.

You can also place model files by hand in `resources/models/` (in a source checkout) or in the AppData folder above. Maintainers: see [docs/models.md](docs/models.md) for publishing models.

## Building a release

### Publishing a release

From an up-to-date `main` with everything committed:

```bash
npm run release
```

That runs the tests, bumps the patch version (1.0.1 to 1.0.2), commits and tags it, and pushes. Use `npm run release -- minor` or `-- major` for bigger steps, or `-- 1.4.0` for a specific version. Passing the current version tags it without a bump, for the first release.

The tag starts the [Release workflow](.github/workflows/release.yml), which builds the Windows installer, the macOS `.dmg` and the Linux AppImage, each on its own runner, and publishes them as a GitHub Release with their `.sha256` files and the update metadata. Each build carries only its own platform's binaries. To check the builds without publishing, run the workflow by hand from the Actions tab.

### How updates reach users

| System | What happens |
| --- | --- |
| Windows | Antler checks on launch and every 6 hours, downloads the new version in the background (only the changed parts), then offers **Restart now**. If the user picks **Later**, it installs the next time Antler quits. |
| Linux (AppImage) | The same, replacing the AppImage. |
| macOS | Antler says a new version is out and links to the release. macOS doesn't let unsigned apps replace themselves. |
| From source | No automatic updates; use `git pull`. |

Users can also check any time from **About > Check for updates**.

### Building locally

electron-builder builds for the system it runs on. On Windows, double-click `build.bat`, or on any system run:

```bash
npm run make
```

The builder asks what to build, checks your setup, packages the app, and verifies the result. Installers get a `.sha256` file beside them for release notes. Use `node scripts/build.js` for a straight installer build (or `--dir` for the portable folder) without the menu, for scripts and CI. Output goes to `dist/`.

| Build | Models included | Use it for |
| --- | --- | --- |
| Installer | Only the small ncnn upscalers (Windows); none on macOS and Linux | Public releases. Antler downloads the other models on first launch, so the installer stays small and doesn't redistribute anyone's model. |
| Portable | Everything in `resources/models` | Your own use, offline. Don't publish it: some models' licenses don't allow redistribution. |

Model files are cached between builds, so a rebuild does not copy 3.8 GB again. Builds are not code-signed, so Windows SmartScreen will warn on first run until a signing certificate is configured.

## Development

```bash
npm run dev            # start with development settings
npm test               # Jest test suite
npm run lint           # ESLint
```

### Project structure

```
src/
├── main/        Electron main process
│   ├── ipc/        IPC handlers, one per tool
│   ├── services/   application logic
│   ├── workers/    model inference, off the main thread
│   └── utils/
├── preload/     the only bridge between main and renderer
└── renderer/    UI; each tool is a module in js/modules/tools/
```

### Conventions

- The renderer never touches the filesystem. Everything goes through IPC exposed in `preload/`.
- Every path that arrives over IPC is checked by `utils/pathGuard.js`.
- File writes go through `utils/safeWrite.js`, so a crash cannot leave a half-written caption.

### Themes

Antler ships with four themes, picked under **Settings > Appearance**: Moss and Bone (default), Velvet, Slate and Birch (light).

Every colour in the app comes from [styles/themes.css](src/renderer/styles/themes.css). A theme is one block of about 15 base colours; hover states, muted fills, borders and scrollbars are derived from those in `style.css`, so a theme never needs more. To add one:

1. Copy a block in `themes.css`, give it a new `data-theme` id and change the colours.
2. Add `{ id, name }` to [js/app/themes.js](src/renderer/js/app/themes.js).

To change the look of the whole app, edit the theme block, not individual stylesheets. Tool stylesheets use the tokens (`var(--accent-primary)` and so on) and should never contain a colour value of their own.

## Upgrading from Piper AIO

Antler was previously called Piper AIO. On first launch it moves your existing data from `%APPDATA%\piper-aio` to `%APPDATA%\antler`, so settings, saved keys, thumbnails and models carry over. If the old app is still running the move is retried on the next launch. The installer upgrades an existing Piper AIO install in place.

## Responsible use

- e621 hosts adult content. Antler is intended for adults, and you are responsible for following e621's terms of service.
- Antler follows e621's API rules: requests are spaced at least 500 ms apart, and each one identifies Antler and your e621 username in its User-Agent.
- Many artists have views on their work being used for training. Check an artist's wishes, and e621's Do Not Post list, before building a dataset from their work.
- Your e621 API key and Hugging Face token are encrypted with the operating system's credential store and are never sent anywhere except e621 and Hugging Face.

## License

Antler's source code is released under the [ISC License](LICENSE). Bundled binaries and downloadable models keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
