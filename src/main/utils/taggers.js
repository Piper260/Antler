const path = require('path');
const { findModelFile } = require('./modelPaths');

// e621 taggers in order of preference:
//  - hydra: Hydra 3.5 (RedRocket, 2026), the successor to JTP PILOT2. It
//    comes with a heatmap model that shows where in an image a tag was found.
//  - jtp: JTP PILOT2 tagged clearly better than Z3D in testing (F1 0.64
//    against 0.54 on e621 posts, and it recognises species Z3D misses).
//  - z3d: Z3D-E621-Convnext, the last fallback.
const TAGGERS = [
  {
    kind: 'hydra',
    model: path.join('tagger', 'hydra-tagger.onnx'),
    vocabulary: path.join('tagger', 'hydra-tags.csv'),
    cam: path.join('tagger', 'hydra-cam.onnx')
  },
  { kind: 'jtp', model: path.join('tagger', 'jtp-pilot2.onnx'), vocabulary: path.join('tagger', 'jtp-pilot2-tags.csv') },
  { kind: 'z3d', model: path.join('tagger', 'z3d-e621.onnx'), vocabulary: path.join('tagger', 'z3d-e621-tags.csv') }
];

/**
 * The preferred e621 tagger whose files are all present, or null.
 * @param {{kinds?: string[]}} [options] - only these kinds (e.g. ['hydra'])
 * @returns {{kind, modelPath, vocabularyPath, camPath?} | null}
 */
function findTagger({ kinds } = {}) {
  for (const entry of TAGGERS) {
    if (kinds && !kinds.includes(entry.kind)) continue;
    const modelPath = findModelFile(entry.model);
    const vocabularyPath = findModelFile(entry.vocabulary);
    if (!modelPath || !vocabularyPath) continue;
    if (!entry.cam) return { kind: entry.kind, modelPath, vocabularyPath };
    const camPath = findModelFile(entry.cam);
    if (camPath) return { kind: entry.kind, modelPath, vocabularyPath, camPath };
  }
  return null;
}

module.exports = { TAGGERS, findTagger };
