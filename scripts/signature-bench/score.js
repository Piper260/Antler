/**
 * Scoring signature finds against the truth marked in the bench report.
 *
 * Truth is per image: { reviewed, boxes: [{x, y, w, h}] } in image pixels.
 * A reviewed image with no boxes has no signature. Unreviewed images are
 * scored only against their e621 tags (signature/watermark), which are
 * incomplete, so those numbers are a rough guide.
 *
 * A find matches a truth box when they overlap by at least MATCH of the
 * smaller one; it covers it when it holds at least COVER of the truth box,
 * which is what healing needs.
 */
const { intersect, area } = require('../../src/main/services/signatureFind');

const MATCH = 0.25;
const COVER = 0.8;

const overlapOfSmaller = (a, b) => {
  const i = intersect(a, b);
  return i ? area(i) / Math.min(area(a), area(b)) : 0;
};
const coverage = (find, truth) => {
  const i = intersect(find, truth);
  return i ? area(i) / area(truth) : 0;
};

/** One image: which finds and truth boxes matched. */
function scoreImage(candidates, truth) {
  const boxes = truth?.boxes || [];
  const found = boxes.map(t => candidates.some(c => overlapOfSmaller(c, t) >= MATCH));
  const covered = boxes.map(t => candidates.some(c => coverage(c, t) >= COVER));
  const right = candidates.map(c => boxes.some(t => overlapOfSmaller(c, t) >= MATCH));
  return {
    truth: boxes.length,
    found: found.filter(Boolean).length,
    covered: covered.filter(Boolean).length,
    finds: candidates.length,
    right: right.filter(Boolean).length,
    wrong: right.filter(r => !r).length,
    perFind: right,
    perTruth: found
  };
}

/**
 * A whole run. `images` is [{ path, tagged, candidates }], `truth` maps
 * path to the image's truth.
 */
function scoreRun(images, truth = {}) {
  const sum = { reviewed: 0, truth: 0, found: 0, covered: 0, finds: 0, right: 0, wrong: 0, cleanImages: 0, perfect: 0 };
  const tags = { tagged: 0, taggedHit: 0, untagged: 0, untaggedFlagged: 0 };
  const perImage = {};
  for (const image of images) {
    const t = truth[image.path];
    if (t?.reviewed) {
      const s = scoreImage(image.candidates, t);
      perImage[image.path] = s;
      sum.reviewed++;
      for (const k of ['truth', 'found', 'covered', 'finds', 'right', 'wrong']) sum[k] += s[k];
      if (!s.truth) sum.cleanImages++;
      if (s.found === s.truth && s.wrong === 0) sum.perfect++;
    }
    if (image.tagged) {
      tags.tagged++;
      if (image.candidates.length) tags.taggedHit++;
    } else {
      tags.untagged++;
      if (image.candidates.length) tags.untaggedFlagged++;
    }
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  return {
    ...sum,
    recall: pct(sum.found, sum.truth),
    coverRate: pct(sum.covered, sum.truth),
    precision: pct(sum.right, sum.finds),
    perfectRate: pct(sum.perfect, sum.reviewed),
    tags: { ...tags, taggedHitRate: pct(tags.taggedHit, tags.tagged), untaggedFlagRate: pct(tags.untaggedFlagged, tags.untagged) },
    perImage
  };
}

/** One line for the console. */
function summaryLine(s) {
  const reviewed = s.reviewed
    ? `reviewed ${s.reviewed}: found ${s.found}/${s.truth} (${s.recall ?? '-'}%), fully covered ${s.coverRate ?? '-'}%, right ${s.right}/${s.finds} (${s.precision ?? '-'}%), perfect images ${s.perfectRate ?? '-'}%`
    : 'nothing reviewed yet';
  return `${reviewed} | by e621 tags: tagged with a find ${s.tags.taggedHit}/${s.tags.tagged} (${s.tags.taggedHitRate ?? '-'}%), untagged flagged ${s.tags.untaggedFlagged}/${s.tags.untagged} (${s.tags.untaggedFlagRate ?? '-'}%)`;
}

module.exports = { MATCH, COVER, scoreImage, scoreRun, summaryLine };
