/**
 * Terminal UI for the build script: the animated banner, the build menu,
 * numbered steps with a live spinner, and the summary box.
 *
 * Colours are the app's Moss and Bone theme. Everything degrades cleanly:
 * no colour with NO_COLOR, and no animation (just plain lines) when the
 * output isn't an interactive terminal, in CI, or with --no-anim.
 */
const path = require('path');
const readline = require('readline');

const out = process.stdout;
const INTERACTIVE = Boolean(out.isTTY) && !process.env.CI;
const COLOR = !process.env.NO_COLOR && (INTERACTIVE || process.env.FORCE_COLOR);
const ANIMATE = INTERACTIVE && !process.argv.includes('--no-anim');

// Moss and Bone, from src/renderer/styles/themes.css.
const PALETTE = {
  moss: [143, 168, 110],
  bone: [235, 230, 221],
  bark: [133, 125, 113],
  teal: [95, 174, 154],
  amber: [217, 137, 74],
  red: [220, 101, 97]
};

const paint = (rgb, text) => (COLOR ? `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text}\x1b[0m` : text);
const c = Object.fromEntries(Object.entries(PALETTE).map(([name, rgb]) => [name, (text) => paint(rgb, text)]));
c.bold = (text) => (COLOR ? `\x1b[1m${text}\x1b[22m` : text);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hideCursor = () => INTERACTIVE && out.write('\x1b[?25l');
const showCursor = () => INTERACTIVE && out.write('\x1b[?25h');
const clearLine = () => out.write('\r\x1b[2K');
// Visible width of a string, ignoring colour codes.
const visible = (text) => text.replace(/\x1b\[[0-9;]*m/g, '').length;

process.on('exit', showCursor);

/* ---------- banner ---------- */

const ICON_SVG = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'icon.svg');
const ICON_BG = [0x1e, 0x1c, 0x19];

// "ANTLER" in block letters, five rows tall.
const WORDMARK = [
  ' █████  ███    ██ ████████ ██      ███████ ██████ ',
  '██   ██ ████   ██    ██    ██      ██      ██   ██',
  '███████ ██ ██  ██    ██    ██      █████   ██████ ',
  '██   ██ ██  ██ ██    ██    ██      ██      ██   ██',
  '██   ██ ██   ████    ██    ███████ ███████ ██   ██'
];

/**
 * The app icon as rows of half-block characters: each character is two
 * pixels, the top one as the text colour and the bottom one as the
 * background. The icon's dark tile is left out so only the antlers show.
 */
async function iconRows(size = 40) {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    return [];
  }
  const { data, info } = await sharp(ICON_SVG, { density: 300 })
    .resize(size, size)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixel = (x, y) => {
    if (x >= info.width || y >= info.height) return null;
    const i = (y * info.width + x) * 4;
    if (data[i + 3] < 128) return null;
    const rgb = [data[i], data[i + 1], data[i + 2]];
    const distance = Math.abs(rgb[0] - ICON_BG[0]) + Math.abs(rgb[1] - ICON_BG[1]) + Math.abs(rgb[2] - ICON_BG[2]);
    return distance < 60 ? null : rgb;
  };

  // Trim to the antlers themselves.
  let [minX, minY, maxX, maxY] = [size, size, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (pixel(x, y)) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  if (minX > maxX) return [];
  if ((maxY - minY) % 2 === 0) maxY++; // even number of pixel rows

  const rows = [];
  for (let y = minY; y <= maxY; y += 2) {
    let row = '';
    for (let x = minX; x <= maxX; x++) {
      const top = pixel(x, y);
      const bottom = pixel(x, y + 1);
      if (!top && !bottom) row += ' ';
      else if (!COLOR) row += top && bottom ? '█' : top ? '▀' : '▄';
      else if (top && bottom) row += `\x1b[38;2;${top.join(';')};48;2;${bottom.join(';')}m▀\x1b[0m`;
      else if (top) row += `\x1b[38;2;${top.join(';')}m▀\x1b[0m`;
      else row += `\x1b[38;2;${bottom.join(';')}m▄\x1b[0m`;
    }
    rows.push(row);
  }
  return rows;
}

/** The wordmark with a bright band at column `shine` (or none). */
function wordmarkRows(shine = null) {
  return WORDMARK.map((line) => {
    if (!COLOR) return line;
    let row = '';
    for (let x = 0; x < line.length; x++) {
      const ch = line[x];
      if (ch === ' ') { row += ' '; continue; }
      const glow = shine === null ? 0 : Math.max(0, 1 - Math.abs(x - shine) / 4);
      const rgb = PALETTE.moss.map((m, i) => Math.round(m + (PALETTE.bone[i] - m) * glow));
      row += `\x1b[38;2;${rgb.join(';')}m${ch}`;
    }
    return row + '\x1b[0m';
  });
}

/**
 * Draws the banner: the antlers grow up from the bottom, then a shine runs
 * across the wordmark. About 0.8 s in total; drawn at once without animation.
 */
async function banner({ version, subtitle }) {
  const icon = await iconRows();
  const iconWidth = icon.length ? visible(icon[0]) : 0;
  const sideBySide = icon.length && (out.columns || 80) >= iconWidth + WORDMARK[0].length + 8;
  const tagline = `${c.bone('Build')} ${c.bark('·')} ${c.bark(`v${version}`)} ${c.bark('·')} ${c.bark(subtitle)}`;

  // Compose one frame: icon rows revealed from the bottom, wordmark beside it.
  const frame = (iconShown, word) => {
    const lines = [];
    // Stacked: icon, a gap, the wordmark, a gap, the tagline.
    const height = sideBySide ? icon.length : icon.length + WORDMARK.length + 3;
    const wordTop = sideBySide ? Math.max(0, Math.floor((icon.length - WORDMARK.length - 2) / 2)) : icon.length + 1;
    for (let row = 0; row < height; row++) {
      const fromBottom = icon.length - row;
      const iconPart = row < icon.length
        ? (fromBottom <= iconShown ? icon[row] : ' '.repeat(iconWidth))
        : ' '.repeat(iconWidth);
      const w = row - wordTop;
      let wordPart = '';
      if (word && w >= 0 && w < WORDMARK.length) wordPart = word[w];
      else if (word && w === WORDMARK.length + 1) wordPart = tagline;
      lines.push(sideBySide ? `  ${iconPart}    ${wordPart}` : `  ${row < icon.length ? iconPart : wordPart}`);
    }
    return lines;
  };

  out.write('\n');
  if (!ANIMATE || !icon.length) {
    const lines = icon.length ? frame(icon.length, wordmarkRows()) : [...wordmarkRows().map((l) => `  ${l}`), '', `  ${tagline}`];
    out.write(lines.join('\n') + '\n\n');
    return;
  }

  hideCursor();
  let previous = 0;
  const draw = (lines) => {
    if (previous) out.write(`\x1b[${previous}A`);
    out.write(lines.map((l) => `\r\x1b[2K${l}`).join('\n') + '\n');
    previous = lines.length;
  };

  for (let shown = 1; shown <= icon.length; shown++) {
    draw(frame(shown, null));
    await sleep(22);
  }
  const width = WORDMARK[0].length;
  for (let shine = -4; shine <= width + 4; shine += 4) {
    draw(frame(icon.length, wordmarkRows(shine)));
    await sleep(24);
  }
  draw(frame(icon.length, wordmarkRows()));
  out.write('\n');
  showCursor();
}

/* ---------- menu ---------- */

/**
 * Asks which build to make. Arrow keys and Enter, or 1-3 as shortcuts; Esc
 * cancels (returns null). Without a terminal it picks the first option.
 */
async function menu(question, options) {
  if (!INTERACTIVE || !process.stdin.isTTY) return options[0].value;

  let selected = 0;
  const labelWidth = Math.max(...options.map((o) => o.label.length));
  const render = (first) => {
    if (!first) out.write(`\x1b[${options.length + 4}A`);
    const lines = [
      `  ${c.bold(c.bone(question))}`,
      '',
      ...options.map((o, i) => (i === selected
        ? `  ${c.moss('›')} ${c.bold(c.bone(o.label.padEnd(labelWidth)))}   ${c.bone(o.hint)}`
        : `    ${c.bark(o.label.padEnd(labelWidth))}   ${c.bark(o.hint)}`)),
      '',
      `  ${c.bark(`↑/↓ to choose · Enter to build · 1-${options.length} shortcut · Esc to cancel`)}`
    ];
    out.write(lines.map((l) => `\r\x1b[2K${l}`).join('\n') + '\n');
  };

  hideCursor();
  render(true);
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  const choice = await new Promise((resolve) => {
    const onKey = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') return resolve(null);
      if (key.name === 'escape') return resolve(null);
      if (key.name === 'up') selected = (selected + options.length - 1) % options.length;
      else if (key.name === 'down') selected = (selected + 1) % options.length;
      else if (key.name === 'return') return resolve(options[selected].value);
      else if (/^[1-9]$/.test(str || '') && Number(str) <= options.length) {
        selected = Number(str) - 1;
        render(false);
        return resolve(options[selected].value);
      } else return;
      render(false);
    };
    process.stdin.on('keypress', onKey);
    process.stdin.once('pause', () => process.stdin.off('keypress', onKey));
  });

  process.stdin.setRawMode(false);
  process.stdin.pause();
  showCursor();
  out.write('\n');
  return choice;
}

/* ---------- steps ---------- */

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function formatTime(ms) {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
}

/**
 * Runs numbered steps with a live spinner. Each step's function gets
 * `update(detail)` to show what it's doing and may return
 * { status: 'skipped' | 'warn', note } instead of the default 'done'.
 * A thrown error marks the step failed and is rethrown.
 */
function createSteps(total) {
  let index = 0;
  const titleWidth = 28;

  return async function step(title, fn) {
    index++;
    const label = `${c.bark(`[${index}/${total}]`)} ${c.bone(title.padEnd(titleWidth))}`;
    const started = Date.now();
    let detail = '';
    let frame = 0;
    let timer = null;

    const render = () => {
      const elapsed = c.bark(formatTime(Date.now() - started).padStart(7));
      const max = Math.max(10, (out.columns || 100) - titleWidth - 24);
      const shown = detail.length > max ? `${detail.slice(0, max - 1)}…` : detail;
      clearLine();
      out.write(`  ${label} ${c.moss(SPINNER[frame++ % SPINNER.length])} ${elapsed}  ${c.bark(shown)}`);
    };

    if (INTERACTIVE) {
      hideCursor();
      render();
      timer = setInterval(render, 80);
    }

    const finish = (mark, text) => {
      if (timer) clearInterval(timer);
      if (INTERACTIVE) clearLine();
      const elapsed = c.bark(formatTime(Date.now() - started).padStart(7));
      out.write(`  ${label} ${mark} ${elapsed}  ${text}\n`);
      showCursor();
    };

    try {
      const result = (await fn((text) => { detail = String(text || ''); })) || {};
      if (result.status === 'skipped') finish(c.bark('–'), c.bark(result.note || 'skipped'));
      else if (result.status === 'warn') finish(c.amber('!'), c.amber(result.note || ''));
      else finish(c.teal('✓'), c.bark(result.note || ''));
      return result;
    } catch (error) {
      finish(c.red('✗'), c.red(error.message));
      throw error;
    }
  };
}

/* ---------- summary ---------- */

/** A rounded box of label/value rows, in the given accent colour. */
function box(title, rows, accent = c.moss) {
  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  const lines = [c.bold(c.bone(title)), '', ...rows.map(([label, value]) => `${c.bark(label.padEnd(labelWidth))}  ${value}`)];
  const width = Math.max(...lines.map(visible)) + 4;
  out.write(`\n  ${accent(`╭${'─'.repeat(width)}╮`)}\n`);
  for (const line of lines) out.write(`  ${accent('│')}  ${line}${' '.repeat(width - visible(line) - 2)}${accent('│')}\n`);
  out.write(`  ${accent(`╰${'─'.repeat(width)}╯`)}\n\n`);
}

module.exports = { c, banner, menu, createSteps, box, formatTime, showCursor, INTERACTIVE };
