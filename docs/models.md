# Hosting the models

Antler's ONNX models are too large for git, so the app downloads them on first
launch (or from **Settings > Models**). The list of files, their sizes and
SHA-256 checksums lives in `src/shared/models.json`; the app refuses any file
that doesn't match.

Where a model's author publishes the exact ONNX file Antler uses, the app
downloads it from the author's own Hugging Face repo, pinned to a commit
(the `source` on each file). That covers UltraSharp V2, the Inkwell panel
detector, the comic bubble detector and Z3D.

Hydra 3.5 is only published as PyTorch weights, so Antler uses its own ONNX
conversion, hosted at `Piper260/antler-models`. Hydra is Apache-2.0, which
allows this with credit.

## Publishing the Hydra conversion (maintainer)

1. Put the model files in `resources/models/` (layout below).
2. Refresh the manifest and commit it:

   ```bash
   npm run models:manifest
   ```

3. Install the Hugging Face CLI and sign in with a write token:

   ```bash
   pip install -U huggingface_hub
   hf auth login
   ```

4. Create the repo once, then upload:

   ```bash
   hf repo create Piper260/antler-models --repo-type model
   hf upload Piper260/antler-models resources/models . --include "tagger/hydra-*"
   ```

5. Check from a clean machine (or after deleting `%APPDATA%\antler\models`)
   that **Settings > Models** downloads every pack.

Re-run steps 2 and 4 whenever a model changes. The manifest must be
committed together with the upload, or existing installs will reject the new
files as corrupt.

To move an upstream model to a newer version, change its `source.revision`
in `models.json` to the new commit, put the new file in `resources/models/`
and run `npm run models:manifest`.

## Layout

```
tagger/hydra-tagger.onnx, hydra-tagger.onnx.data, hydra-tags.csv, hydra-cam.onnx
tagger/z3d-e621.onnx, z3d-e621-tags.csv
comic/inkwell-panels.onnx, comic/comic-bubbles.onnx
ultrasharp-v2-4x.onnx, ultrasharp-v2-lite-4x.onnx
```

## Model card

Give the Hugging Face repo a README that says this is an ONNX conversion of
RedRocket's Hydra 3.5 (https://huggingface.co/RedRocket/Hydra, Apache-2.0)
made for Antler, with a link back to it.

## Where the app looks

`src/main/utils/modelPaths.js` searches, in order: `resources/models` in a
source checkout, `<install>/resources/models` in a packaged build, then
`%APPDATA%\antler\models`, which is where downloads go and which survives
updates.
