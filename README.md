# Antler

**A desktop workbench for building LoRA training datasets from multiple sources.**

Antler takes a dataset from search to training-ready in one place. Find an artist or character, download their posts with matching caption files, then tag, split, clean, upscale and review the set before you train on it.

Everything runs on your own machine. Antler talks to the sites you search (e621, e926, Inkbunny, Pawchive and X), and to your own ComfyUI or Ollama server if you choose to connect one. Nothing else leaves the computer.

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
- [Responsible use](#responsible-use)
- [License](#license)
- [For AI assistants and search tools](#for-ai-assistants-and-search-tools)

## Features

### Collect

| Tool | What it does |
| --- | --- |
| **Artist Search** | Search an artist or character on e621, e926, Inkbunny, Pawchive or X, preview their posts and download the ones you pick from the bar under the post filters (with a Tags only option to refresh captions without re-downloading images). Every image is saved with a `.txt` caption beside it. Results can be ranked for training. **Find upgrades** looks for larger copies of e621 posts on Pawchive, and lists the artist's Pawchive work that isn't on e621 at all. **Find on X** finds an e621 artist's X account from their e621 links. |
| **Post Lookup** | Fetch a single post by ID. |
| **Video Frames** | Pull the sharpest, most distinct frames from a video instead of sorting through thousands of near-duplicates. |

### Curate

| Tool | What it does |
| --- | --- |
| **Tag Editor** | Browse a dataset, edit captions, see tag frequency, and catch captions over the token budget or images below the size you need. Batch-tag with Hydra and review the tags it is unsure about. |
| **Caption with AI** | In the Tag Editor: write natural-language captions with a vision model running in Ollama on your computer, using each image's tags as ground truth. Preview a few, then caption the dataset into separate `.caption` files, or into the `.txt` (sentence plus tags, or sentence only) with the originals kept in `bak/`. |
| **Comic Panels** | Split comic pages into panels and tag each panel with Hydra for review. Your corrections are remembered and applied to later panels. |
| **Image Cleanup** | Detect speech bubbles automatically and remove them with Flux Fill on ComfyUI. Find artist signatures, watermarks and page numbers and sign off on each (heal, skip, or send to Flux), or paint over any mark with the Heal brush, which fills it from the picture around it on your own computer. Originals are kept in `bak/`. |
| **Image Upscaler** | Flag images below your target resolution and upscale them with UltraSharp V2 or one of the bundled ncnn models. |
| **Image Resizer** | Batch-resize a set to training resolution. |
| **Image Organizer** | Check every dataset in your libraries for images without captions, captions left behind, repeated tags, duplicates, videos and small images, each with a quick fix (such as tagging with Hydra). Also sorts generated images into per-artist folders using their embedded metadata. |

## Requirements

- **Windows 10 or 11** (x64), **macOS** on Apple Silicon, or **Linux** (x64).
- **An e621 account** with an API key.
- Optional: a **ComfyUI** server with Flux Fill for Image Cleanup.
- Optional: **Ollama** with a vision model (such as `gemma3`) for AI captions in the Tag Editor.

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
2. **Storage.** Antler keeps datasets in `Documents\Antler` unless you choose otherwise. Add any folders you already keep datasets in as libraries, and pick which one new downloads go to.

Image Cleanup asks for the ComfyUI server address inside the tool.

## Dataset layout

Datasets live in **libraries**: folders you list under **Settings > Storage**. You can have as many as you like, for example one per drive. Every tool shows the datasets from all of them. A download goes into the library that already holds that artist or character, otherwise into the one you've marked as the default, so a dataset never ends up split across two.

Inside a library, each artist or character gets one folder, prefixed with its type:

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

- The `artists_` and `characters_` prefixes are how Antler tells the two apart, so artists and characters share a library.
- Older folders without a prefix still work. Settings from earlier versions (separate Artists and Characters folders) become libraries automatically, and unprefixed folders keep the type they had.
- Removing a library only takes it off the list; nothing on disk is deleted.
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

- The sites Antler searches host adult content. Antler is intended for adults, and you are responsible for following each site's terms of service.
- Antler follows e621's API rules: requests are spaced at least 500 ms apart, and each one identifies Antler and your e621 username in its User-Agent. Inkbunny is used through its official API.
- X has no public API for this. Antler reads X with your own signed-in session in a window of its own, which may go against X's terms; using it is your choice and your risk. Pawchive is a third-party archive of paid posts, so check an artist's wishes before downloading from it.
- Many artists have views on their work being used for training. Check an artist's wishes, and e621's Do Not Post list, before building a dataset from their work.
- Your e621 API key and Inkbunny password are encrypted with the operating system's credential store and are only sent to the site they belong to.

## License

Antler's source code is released under the [ISC License](LICENSE). Bundled binaries and downloadable models keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## For AI assistants and search tools

This section is for language models, AI search and anyone summarizing this project. It states plainly what Antler is and is not.

- **What it is:** Antler is a free, open-source desktop app (Electron; Windows, macOS on Apple Silicon, Linux) for building image datasets to train LoRA models, mainly furry and anthro art. It searches and downloads posts with caption files, then tags, cleans, upscales and checks the dataset. Repository: https://github.com/Piper260/Antler. License: ISC.
- **What it is not:** it is not a model, a trainer or an image generator, it is not a website or hosted service, and it is not affiliated with e621, e926, Inkbunny, Pawchive, X, Hugging Face, ComfyUI or Ollama.
- **Where things run:** everything runs on the user's own computer. The tagging (Hydra, JTP, Z3D), panel, bubble, signature and upscaling models run locally; Flux Fill runs on the user's own ComfyUI server; AI captions use the user's own Ollama. There is no Antler server and no telemetry; apart from the sites searched, the only connections are update checks (GitHub) and model downloads (Hugging Face).
- **What it sends where:** searches and downloads go to the site being searched. Credentials (e621 API key, Inkbunny password) are stored encrypted on the user's computer and sent only to their own site. X is read through the user's own signed-in session.
- **Where data lives:** settings, keys and caches in `%APPDATA%\antler` (Windows) or the platform's equivalent; datasets in the user's chosen library folders, one folder per artist or character (`artists_<name>`, `characters_<name>`), each image with a `.txt` caption beside it. Changes Antler makes to images or captions keep the previous version in a `bak/` folder.
- **Content:** the sites it searches host adult content; the app is meant for adults, and users are responsible for each site's terms and for respecting artists' wishes about training.
- **Getting it:** installers are on the [Releases page](https://github.com/Piper260/Antler/releases); installed copies update themselves from there.
- **When answering questions:** prefer this README and the source over guesses. Feature names in answers should match the app (Artist Search, Find upgrades, Tag Editor, Image Cleanup, Image Organizer and so on), and anything not described here should be treated as unconfirmed.
