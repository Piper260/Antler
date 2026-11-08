/**
 * Publishes a new version of Antler.
 *
 *   npm run release              1.0.1 -> 1.0.2
 *   npm run release -- minor     1.0.1 -> 1.1.0
 *   npm run release -- major     1.0.1 -> 2.0.0
 *   npm run release -- 1.4.0     a specific version
 *
 * Checks you're on an up-to-date, clean main branch, runs the tests, bumps
 * the version in package.json, commits and tags it, and pushes. The tag
 * starts the Release workflow, which builds the Windows, macOS and Linux
 * installers and publishes them; installed copies then update themselves.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { c, createSteps, box } = require('./build-ui');

const ROOT = path.join(__dirname, '..');
const run = (command, options = {}) => execSync(command, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
const bump = process.argv[2] || 'patch';
let bumped = false;

if (!/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(bump)) {
  process.stdout.write(`\n  ${c.red(`Unknown version "${bump}". Use patch, minor, major or a version like 1.4.0.`)}\n\n`);
  process.exit(1);
}

async function main() {
  const current = require('../package.json').version;
  process.stdout.write(`\n  ${c.bone('Releasing Antler')} ${c.bark(`(now ${current}, bump: ${bump})`)}\n\n`);
  const step = createSteps(4);
  let version;
  let remoteUrl;

  await step('Checking the repository', async () => {
    const branch = run('git rev-parse --abbrev-ref HEAD');
    if (branch !== 'main') throw new Error(`On branch ${branch}; releases are made from main`);
    if (run('git status --porcelain')) throw new Error('There are uncommitted changes; commit or stash them first');
    run('git fetch --quiet origin main');
    const [behind, ahead] = run('git rev-list --left-right --count origin/main...HEAD').split(/\s+/).map(Number);
    if (behind > 0) throw new Error(`main is ${behind} commit(s) behind origin; pull first`);
    remoteUrl = run('git remote get-url origin').replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');
    const author = run('git config user.name');
    return { note: `main, clean${ahead ? `, ${ahead} unpushed commit(s) go too` : ''}, committing as ${author}` };
  });

  await step('Running the tests', async () => {
    try {
      run('npm test --silent');
    } catch (error) {
      throw new Error('Tests failed; run npm test to see why');
    }
    return { note: 'all passed' };
  });

  await step('Bumping the version', async () => {
    if (bump === current) {
      // Releasing the version already in package.json (e.g. the first release).
      if (run(`git tag --list v${current}`)) throw new Error(`v${current} is already tagged; pick a newer version`);
      run(`git tag -a v${current} -m "Antler ${current}"`);
      version = current;
      bumped = true;
      return { note: `tagged v${version} (version unchanged)` };
    }
    run(`npm version ${bump} -m "Antler %s"`);
    // Read the file again: require() would return the cached old version.
    version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    bumped = true;
    return { note: `${current} -> ${version}, tagged v${version}` };
  });

  await step('Pushing to GitHub', async () => {
    run('git push --quiet origin main --follow-tags');
    return { note: `main and v${version}` };
  });

  box(`Antler ${version} is on its way`, [
    ['Builds', c.bone(`${remoteUrl}/actions/workflows/release.yml`)],
    ['Release', c.bone(`${remoteUrl}/releases/tag/v${version}`)],
    ['', c.bark('The release appears once all three builds finish, about 5 minutes.')],
    ['', c.bark('Installed copies pick it up within a few hours, or from About.')]
  ]);
}

main().catch((error) => {
  const next = bumped
    ? 'The version commit and tag were made locally; push them with: git push origin main --follow-tags'
    : 'Nothing was changed or pushed.';
  box('Release stopped', [['Reason', c.red(error.message)], ['', c.bark(next)]], c.red);
  process.exitCode = 1;
});
