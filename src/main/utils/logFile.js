// src/main/utils/logFile.js - the main process's console, also written to
// <user data>/logs/antler.log, so an installed copy can be debugged: what
// every e621 request got back, and why a search failed. About > Open Logs
// opens the folder. At 5 MB the log becomes antler.old.log and starts again.
const fs = require('fs');
const path = require('path');
const util = require('util');

const MAX_BYTES = 5 * 1024 * 1024;

let stream = null;
let file = null;

function rotate() {
  try {
    if (fs.statSync(file).size < MAX_BYTES) return;
    stream?.end();
    fs.renameSync(file, file.replace(/\.log$/, '.old.log'));
    stream = fs.createWriteStream(file, { flags: 'a' });
  } catch { /* first write */ }
}

/** Starts copying console output from this process into the log. */
function startLogFile(userDataDir) {
  if (stream) return file;
  const dir = path.join(userDataDir, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'antler.log');
  rotate();
  stream = fs.createWriteStream(file, { flags: 'a' });
  let written = 0;
  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      try {
        const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${util.format(...args)}\n`;
        stream.write(line);
        written += line.length;
        if (written > 256 * 1024) {
          written = 0;
          rotate();
        }
      } catch { /* logging must never break the app */ }
    };
  }
  console.log(`📝 Logging to ${file}`);
  return file;
}

const logDir = () => (file ? path.dirname(file) : null);

module.exports = { startLogFile, logDir };
