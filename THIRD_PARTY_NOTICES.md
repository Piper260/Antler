# Third-party notices

Antler's own code is ISC licensed (see `LICENSE`). The components below are
not Antler's and keep their own licenses.

## Bundled with the app

| Component | Where | License |
| --- | --- | --- |
| Electron | runtime | MIT |
| ONNX Runtime (`onnxruntime-node`) | inference | MIT |
| sharp / libvips | image processing | Apache-2.0 / LGPL-3.0 |
| winston, joi, image-size | main process | MIT / BSD-3-Clause / MIT |
| Font Awesome Free 6.5.0 | `src/renderer/vendor/fontawesome` | Icons CC BY 4.0, fonts SIL OFL 1.1, code MIT (see its `LICENSE.txt`) |
| upscayl-bin (Upscayl NCNN, a fork of Real-ESRGAN-ncnn-vulkan) | `resources/win/bin/upscayl-bin.exe` | AGPL-3.0. Source: https://github.com/upscayl/upscayl-ncnn. Antler runs it as a separate program and does not link to it. |
| Microsoft OpenMP runtime | `resources/win/bin/vcomp140.dll` | Visual C++ Redistributable terms |
| ncnn upscaler models (Remacri, UltraMix, UltraSharp, Digital Art, High Fidelity, Upscayl Standard/Lite) | `resources/models/*.param, *.bin` | As published by Upscayl and the original model authors |

## Downloaded on demand

Nothing below ships with Antler. Each model is downloaded only when the user
chooses to, from the place shown.

| Model | Author and home | License | Downloaded from |
| --- | --- | --- | --- |
| Hydra 3.5 tagger | RedRocket, https://huggingface.co/RedRocket/Hydra | Apache-2.0 | ONNX conversion at https://huggingface.co/Piper260/antler-models |
| Inkwell panel detector | cedarrapidsboy, https://huggingface.co/cedarrapidsboy/inkwell-panel-models | See the model card | The author's repo |
| Comic text and bubble detector | ogkalu, https://huggingface.co/ogkalu/comic-text-and-bubble-detector | Apache-2.0 | The author's repo |
| UltraSharp V2 / V2 Lite | Kim2091, https://huggingface.co/Kim2091/UltraSharpV2 | CC BY-NC-SA 4.0 (non-commercial) | The author's repo |
| Z3D-E621-Convnext tagger | Z3D, via https://huggingface.co/toynya/Z3D-E621-Convnext | See the model card | That repo |

If you are an author of one of these models and want it credited
differently or removed, please open an issue.
