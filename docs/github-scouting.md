# GitHub scouting: projects worth building in

Checked 2026-11-06, with a second pass on 2026-11-07 (items 14 to 18), against GitHub and Hugging Face (read only). Star counts, likes and dates are as of that day. "Node" means it can run inside Antler as it stands today (onnxruntime-node, sharp, plain JS). "Python" means it would need a Python runtime, or the model would first have to be exported to ONNX.

## Top 3

1. **Hydra 3.5 tagger (RedRocket).** This is the current e621 tagger from the people behind JTP PILOT2, released in August 2026 as the successor to JTP-3. It predicts 8,886 tags and is Apache-2.0. Panel tagging and the Tag Editor would both get better tags. It only ships as PyTorch, so we would export it to ONNX ourselves (community ONNX ports of JTP-3 already exist). Effort: medium.
2. **Duplicate and near-duplicate finder (our own tool).** Artist and character folders pick up reposts, crops, edits and alternate versions. Nothing in the app catches these today. Perceptual hashing on top of sharp is a few hundred lines of JS. A second pass using embeddings (CCIP, CLIP) could group "same image, different edit". Effort: low to medium.
3. **Character check with deepghs CCIP.** CCIP is an ONNX model that scores whether two images show the same character. It could flag images in a `characters_<name>` folder that look like someone else, and the duplicate finder could use the same embeddings. The same library also has face/person detection and aesthetic scores. Effort: low to medium.

## Shortlist (best fit first)

| # | Project | Stars / likes | Last update | License | Runs in |
|---|---|---|---|---|---|
| 1 | RedRocket Hydra 3.5 | 47 likes (HF) | 2026-08-23 | Apache-2.0 | Python, needs ONNX export |
| 2 | Duplicate finder (refs: czkawka, imagededup, sharp-phash) | 34.9k / 5.7k / 67 | 2026-11 / 2025-08 / 2024-10 | refs only; sharp-phash MIT | Node |
| 3 | deepghs anime ONNX models (imgutils) | 427 (imgutils) | models 2024; lib 2025-10 | MIT code; models MIT / OpenRAIL | Node |
| 4 | Florence-2 / Qwen3-VL ONNX via transformers.js | 16.4k (transformers.js) | 2026-10 | Apache-2.0 / MIT models | Node |
| 5 | e621 / Danbooru tag lists archive | 113 | 2026-11-03 | Unlicense | Node (data) |
| 6 | Character segmentation (skytnt anime-seg, BiRefNet) | 856 / 4.4k | 2026-08 (model) / 2026-10 | Apache-2.0 / MIT | Node |
| 7 | Text detection for signatures and captions | comic-text-detector ONNX; PaddleOCR 92k | 2025-05 / 2026-09 | Apache-2.0 | Node |
| 8 | @stable-canvas/comfyui-client | 151 | 2026-10-25 | MIT | Node |
| 9 | SeedVR2 restoration through ComfyUI | 2.9k (ComfyUI node) / 1.4k | 2025-12 / 2026-01 | Apache-2.0 | ComfyUI (existing connection) |
| 10 | OpenModelDB upscaler catalogue | 561 | 2026-08-14 | GPL-3.0 (site data) | Node (download ONNX) |
| 11 | Shot detection: TransNetV2 / PySceneDetect | 1.1k / 5.4k | 2023-12 / 2026-11 | MIT / BSD-3 | Node (ONNX or reimplement) |
| 12 | Tail Tagger (UX reference) | 19 | 2026-10-23 | MIT | Python (reference only) |
| 13 | LoRA Dataset Studio (feature reference) | 339 | 2026-11-06 | PolyForm Noncommercial | Python (reference only) |
| 14 | Trainer export (sd-scripts, musubi-tuner, ai-toolkit, diffusion-pipe) | 7.3k / 2.1k / 12.6k / 2.0k | 2026-10 / 11 | refs only | Node |
| 15 | Embedding index with sqlite-vec | 8.2k | 2026-05-18 | Apache-2.0 / MIT | Node |
| 16 | NAFNet restoration ONNX (deepghs/image_restoration) | 20 likes (HF) | 2025-11-17 | MIT | Node |
| 17 | PixAI Tagger v1.0 | 158 likes (HF) | 2026-09-22 | Apache-2.0 | Python, needs ONNX export |
| 18 | Grabber (imgbrd-grabber), download reference | 3.2k | 2026-10-15 | Apache-2.0 | C++ (reference only) |

## Details

### 1. Hydra 3.5 tagger
- https://huggingface.co/RedRocket/Hydra (model and inference code). Community JTP-3 ONNX ports: https://huggingface.co/0xk1ru/jtp-3-onnx, https://huggingface.co/inflatebot/jtp-3-ONNX-akasha (both Apache-2.0, July 2026).
- What it is: a SigLIP2 so400m finetune with a custom classifier head, trained to predict 8,886 e621 tags. It replaces JTP PILOT2 (`resources/models/tagger/jtp-pilot2.onnx`, which comes from the older `RedRocket/JointTaggerProject` repo) and could also replace Z3D-E621.
- Improves: panel tagging in Comic Panels (`tagMerge.js`, `comicVisionWorker.js`), the Tag Editor, and an auto-tag step after downloads.
- Fit: the base model uses SigLIP2 "naflex" (variable patch count), so the export has to fix an input size or a small set of sizes. The custom head (`hydra/head.py`, `glu.py`) has to be exported with it. Try the JTP-3 ONNX ports first to see what export problems came up. The model is about 400M parameters and needs the GPU, which the existing ONNX worker already handles.
- Effort: medium. Most of the work is the export, plus checking it against the PyTorch output. The tag CSV ships with the model.
- Extra: the Hydra repo can produce a heatmap (CAM) per tag that shows which part of the image caused it. Shown in the Tag Editor, it makes a doubtful tag quick to check. This is optional and needs the full model, not only the scores.

### 2. Duplicate and near-duplicate finder (new tool)
- References: https://github.com/qarmin/czkawka (Rust, MIT/GPL mix, 34.9k), https://github.com/idealo/imagededup (Python, Apache-2.0, 5.7k), https://github.com/btd/sharp-phash (MIT, npm `sharp-phash`).
- What it would do: hash every image in a dataset folder (pHash or dHash on a sharp grayscale thumbnail), group pairs under a Hamming threshold, then show each group so the user can keep one image and send the rest to `bak/` (same idea as Image Cleanup's backups). A second pass could compare CLIP or CCIP embeddings (item 3) to catch crops and colour edits that hashing misses.
- Improves: a new "Duplicates" tool, or a step inside Image Organizer. It also helps Artist Search downloads, which often pull variants of the same post.
- Fit: Node only. sharp is already a dependency. Write our own version rather than depend on czkawka.
- Effort: low for hashing and the review UI, medium with embeddings.

### 3. deepghs anime ONNX models
- Library: https://github.com/deepghs/imgutils (MIT, 427). Models: `deepghs/ccip_onnx` (character similarity), `deepghs/anime_face_detection`, `anime_head_detection`, `anime_person_detection` (MIT, YOLO), `deepghs/anime_aesthetic` (OpenRAIL), `deepghs/anime_rating`.
- What it gives us:
  - CCIP scores whether two images show the same character. That helps check `characters_<name>` folders for wrong-character images, and it feeds the duplicate finder.
  - Face, head and person boxes give subject-aware crops for the Image Resizer and comic panels.
  - Aesthetic scores let the user sort a folder and drop the weakest images.
  - Filters for a "check this folder" pass, each a small ONNX classifier:
    - `deepghs/anime_ai_check` (MIT) flags images that look AI-generated, which matters for style LoRAs built from an artist's folder.
    - `deepghs/anime_censor_detection` (MIT, YOLO) finds mosaic and bar censoring.
    - `deepghs/anime_completeness` (OpenRAIL) separates rough sketches from finished pieces.
    - `deepghs/anime_classification` (MIT) labels an image as illustration, comic, 3D and so on. That could send comic pages to Comic Panels automatically.
- Fit: Node. All of these are plain ONNX. Pre- and post-processing are short Python functions in imgutils that can be ported to JS. They are trained on anime and may be weaker on furry art, so test on real folders first.
- Effort: low to medium per model. CCIP plus a "check this character folder" view is the most useful one.

### 4. Natural-language captions: Florence-2 / Qwen3-VL through transformers.js
- https://github.com/huggingface/transformers.js (Apache-2.0, 16.4k, npm `@huggingface/transformers` 4.3.2). Models: `onnx-community/Florence-2-base-ft` (MIT), `onnx-community/Qwen3-VL-2B-Instruct-ONNX` (October 2026). JoyCaption (https://github.com/fpgaminer/joycaption, Apache-2.0, 1.3k) is the best captioner for this kind of art, but it is an 8B LLaVA, so it is better reached through the Ollama integration that already exists than run in-process.
- Improves: the Tag Editor and Auto Prompter. Newer base models (Flux, Qwen-Image, Anima) train better on tags plus a short sentence.
- Fit: transformers.js runs in Node on top of onnxruntime. Florence-2 base (about 230M) works on CPU. Qwen3-VL 2B needs the GPU.
- Effort: medium. Running the model is easy. Turning captions into training text that agrees with the tags is the real work.

### 5. e621 / Danbooru tag lists archive
- https://github.com/DraconicDragon/dbr-e621-lists-archive (Unlicense, updated 2026-11-03). Processor: https://github.com/DraconicDragon/danbooru-e621-tag-list-processor (GPL-3.0, so use its output rather than its code).
- What it is: regularly updated tag lists with categories, counts and aliases.
- Improves: Tag Editor autocomplete, alias normalisation (for example `wolf_girl` to the canonical tag) and category lookups in `tagMerge.js` without calling the e621 API.
- Better source for e621: e621 publishes daily CSV dumps at https://e621.net/db_export/ (tags, tag aliases, tag implications, pools, wiki pages). Those let the app apply implications (for example `wolf` implies `canine`) and aliases offline, straight from the source. The archive above is mostly built from these dumps.
- Fit: data only. Load the CSV.
- Effort: low.

### 6. Character segmentation and background removal
- https://huggingface.co/skytnt/anime-seg (`isnetis.onnx`, Apache-2.0, updated 2026-08), code https://github.com/SkyTNT/anime-segmentation. Also https://github.com/ZhengPeng7/BiRefNet (MIT, 4.4k, has ONNX exports).
- Use: subject masks for transparent-background versions, background-only cleanup, and finding the subject when cropping.
- Fit: Node, single ONNX model.
- Effort: medium (mostly UI for what to do with the mask).

### 7. Text detection for signatures and captions
- `mayocream/comic-text-detector-onnx` (Apache-2.0), used by koharu (https://github.com/koharu-rs/koharu, Apache-2.0, 6.6k, Rust). PaddleOCR (https://github.com/PaddlePaddle/PaddleOCR, Apache-2.0, 92k) detection models also export to ONNX.
- Improves: Image Cleanup currently marks signatures and captions by hand. A text detector could suggest those marks automatically. The bubble model already bundled is ogkalu's comic-text-and-bubble-detector. It was updated in May 2026 with a smaller `detector-v4-s_int8.onnx`, so check which version we ship.
- Fit: Node.
- Effort: low to medium.

### 8. @stable-canvas/comfyui-client
- https://github.com/StableCanvas/comfyui-client (MIT, 151, npm 1.5.9, no dependencies).
- What it is: a typed REST and WebSocket client for ComfyUI that works in Node. It can also turn a workflow into code.
- Improves: `comfyCleanup.js` has its own upload, queue and poll code. Only worth switching if more ComfyUI workflows get added (item 9). For a single workflow, the current code is fine.
- Effort: low.

### 9. SeedVR2 restoration through ComfyUI
- https://github.com/ByteDance-Seed/SeedVR (Apache-2.0), ComfyUI node https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler (Apache-2.0, 2.9k).
- What it is: diffusion-based restoration and upscaling. On low-resolution or JPEG-damaged posts it does much better than ESRGAN-style models.
- Improves: a "Restore (ComfyUI)" mode in Image Upscaler that uses the ComfyUI connection Image Cleanup already has.
- Fit: runs on the user's ComfyUI, not in Node. It needs a lot of VRAM.
- Effort: medium (workflow, tiling settings, result review).

### 10. OpenModelDB upscaler catalogue
- https://github.com/OpenModelDB/open-model-database (561, updated 2026-08) and https://openmodeldb.info. Example model: Kim2091 2x-AnimeSharpV4 (fp16 ONNX available, CC-BY-NC-SA).
- Use: a model picker in Image Upscaler that downloads ONNX upscalers from the catalogue instead of bundling a fixed set. Check each model's license before listing it, because many are non-commercial.
- Fit: Node, using the existing `OnnxUpscaleService`.
- Effort: low to medium.

### 11. Shot detection for Video Frames
- https://github.com/soCzech/TransNetV2 (MIT, 1.1k, community ONNX exports), https://github.com/Breakthrough/PySceneDetect (BSD-3, 5.4k, active).
- Use: Video Frames already keeps frames by a difference threshold. PySceneDetect's adaptive content detector (HSV deltas against a rolling average) is easy to rewrite in JS and handles fades and camera pans better. TransNetV2 would be a model-based alternative.
- Effort: low (rewrite the algorithm) to medium (TransNetV2).

### 12. Tail Tagger (UX reference)
- https://github.com/renfald/tail-tagger (MIT, PySide6, 2026-10).
- A manual e621 tag curation app built around JTP models, with favourites, usage stats and bulk prepend/append. Worth reading for Tag Editor workflow ideas. Nothing to integrate.

### 13. LoRA Dataset Studio (feature reference only)
- https://github.com/perfectgf/lora-dataset-studio (339, very active).
- Its features overlap ours a lot: an image bank with quality scoring, duplicate and person grouping, composition checks, text detection and cleaning, captioning. The license is PolyForm Noncommercial, so do not copy code. Use it only as a checklist of features.

## Second pass (2026-11-07)

### 14. Trainer export (new tool)
- References: https://github.com/kohya-ss/sd-scripts (Apache-2.0, 7.3k), https://github.com/kohya-ss/musubi-tuner (no license file, 2.1k), https://github.com/ostris/ai-toolkit (MIT, 12.6k), https://github.com/tdrussell/diffusion-pipe (GPL-3.0, 2.0k). All four are active this month.
- What it would do: take a finished dataset folder and write it out the way a chosen trainer expects:
  - sd-scripts `N_name` repeat folders, or a dataset TOML;
  - a musubi-tuner or diffusion-pipe TOML;
  - an ai-toolkit YAML.
  It would also check that every image has a caption file and report the resolution buckets the images will land in.
- Improves: the step after the Tag Editor. Right now the user has to arrange folders and configs by hand.
- Fit: Node. These are file layouts and small config files, so we write our own. Don't depend on the trainers themselves.
- Effort: low to medium.

### 15. Embedding index with sqlite-vec
- https://github.com/asg017/sqlite-vec (Apache-2.0 / MIT, 8.2k, npm `sqlite-vec`). LanceDB (https://github.com/lancedb/lancedb, Apache-2.0) is a heavier alternative.
- What it would do: store one embedding per image (CCIP from item 3, or SigLIP) across the whole storage root. That gives "find images like this one", duplicate checks across folders, and "which character folder does this image belong in".
- Fit: Node, one SQLite file next to the settings.
- Effort: medium. Only worth it after items 2 and 3 exist.

### 16. NAFNet restoration ONNX
- https://huggingface.co/deepghs/image_restoration (MIT, re-exported November 2025): NAFNet models for deblurring (GoPro, REDS) and denoising (SIDD).
- Use: an optional pass before upscaling, for blurry or noisy sources and screenshots. It can run through the same tiled ONNX path as `OnnxUpscaleService`.
- Fit: Node.
- Effort: low. These models were trained on photos, so try them on real posts before adding them.

### 17. PixAI Tagger v1.0
- https://huggingface.co/pixai-labs/pixai-tagger-v1.0 (Apache-2.0, September 2026, 30,877 Danbooru tags, data up to May 2026). deepghs publishes an ONNX version of the older v0.9 (`deepghs/pixai-tagger-v0.9-onnx`).
- Use: a second tagger for anime characters and Danbooru-style datasets, where the e621 taggers are weak. Lower priority than Hydra while the app stays focused on e621.
- Fit: Python today. v1.0 needs its own ONNX export, but v0.9 runs now.
- Effort: low for v0.9, medium for v1.0.

### 18. Grabber (download reference)
- https://github.com/Bionus/imgbrd-grabber (Apache-2.0, 3.2k, C++/Qt). gallery-dl (https://github.com/mikf/gallery-dl, GPL-2.0, 20.4k) is the command-line equivalent.
- Worth reading for Artist Search: filename templates built from post fields, blacklist handling, "skip if already downloaded" checks by MD5, and writing post metadata to sidecar files. Nothing to integrate.

### Gaps
- Glaze and Nightshade: protected images can poison a LoRA, so flagging them would be useful. No open, documented detector turned up on GitHub or Hugging Face. One app (x-CK-x/Dataset-Curation-Tool, GPL-3.0, 39 stars) mentions an "integrity classifier" but doesn't say which model it uses. Worth checking again later.

## Looked at and not recommended
- Real-ESRGAN, waifu2x (nunif) and Upscayl: the app already covers this with UltraSharp V2 ONNX and the ncnn models.
- manga-image-translator, BallonsTranslator and comic-translate: whole translation pipelines. Only their text detection matters here (item 7).
- SAM 2 / SAM 3: large, and the license for SAM 3 is custom. anime-seg covers the need more cheaply.
- Ultralytics YOLO: AGPL-3.0. Use exported ONNX weights from permissively licensed models (deepghs, ogkalu) instead.
- imgly background-removal-js: AGPL-3.0.
- PanelCleaner (https://github.com/VoxelCubes/PanelCleaner, GPL-3.0, 489, 2026-09): a manga bubble cleaner built from the same kinds of parts as item 7. Read it for its mask-refinement ideas, but don't copy the code because of the GPL.
- jpeg-quantsmooth (https://github.com/ilyakurdyukov/jpeg-quantsmooth, LGPL-2.1, 564): non-AI JPEG artifact removal. It's a C library, and SeedVR2 or an ONNX restoration model fits the app better.
- LaMa ONNX inpainting (https://huggingface.co/Carve/LaMa-ONNX, Apache-2.0): would let Image Cleanup work without ComfyUI. Left out because cleanup stays on Flux Fill.
- Frame interpolation (Practical-RIFE, ComfyUI-Frame-Interpolation, Flowframes): it makes in-between frames, which are synthetic images and not good training data.
- NudeNet (AGPL-3.0): the e621 rating and tags already cover this.
- ffmpeg-static: GPL-3.0 binaries. Video Frames already decodes in the renderer, so it isn't needed.
