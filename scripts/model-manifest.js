#!/usr/bin/env node
/**
 * Fills in the size and SHA-256 of every file in src/shared/models.json from
 * the copies in resources/models, so the in-app downloader can check what it
 * fetched. Run it after changing any model, then upload the same files to the
 * Hugging Face repo named in models.json (see docs/models.md).
 *
 *   node scripts/model-manifest.js          update models.json
 *   node scripts/model-manifest.js --check  only report files that differ
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'src', 'shared', 'models.json');
const MODELS = path.join(ROOT, 'resources', 'models');
const checkOnly = process.argv.includes('--check');

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', chunk => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  let missing = 0;
  let changed = 0;

  for (const pack of manifest.packs) {
    for (const entry of pack.files) {
      const file = path.join(MODELS, entry.path);
      if (!fs.existsSync(file)) {
        console.error(`missing  ${entry.path}`);
        missing++;
        continue;
      }
      const size = fs.statSync(file).size;
      const digest = await sha256(file);
      if (entry.size === size && entry.sha256 === digest) {
        console.log(`same     ${entry.path}`);
        continue;
      }
      console.log(`${checkOnly ? 'differs' : 'updated'}  ${entry.path}  ${(size / 1e6).toFixed(1)} MB`);
      changed++;
      if (!checkOnly) {
        entry.size = size;
        entry.sha256 = digest;
      }
    }
  }

  if (!checkOnly && changed) fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n${changed} ${checkOnly ? 'differ' : 'updated'}, ${missing} missing`);
  if (missing || (checkOnly && changed)) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
