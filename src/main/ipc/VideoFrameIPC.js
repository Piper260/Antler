const { ipcMain } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const { IMAGE_EXTENSIONS, requireFileName, requireLocalPath } = require('../utils/pathGuard');
const { writeFileSafe } = require('../utils/safeWrite');

class VideoFrameIPC {
  constructor() {
    ipcMain.handle('video-frames:save-frame', async (event, folder, fileName, data) => {
      try {
        const directory = requireLocalPath(folder, 'folder');
        const filePath = path.join(directory, requireFileName(fileName, IMAGE_EXTENSIONS));
        await fs.mkdir(directory, { recursive: true });

        // A frame already there is left alone, never replaced.
        try {
          await fs.access(filePath);
          return { success: true, existed: true };
        } catch {
          await writeFileSafe(filePath, Buffer.from(data));
          return { success: true, existed: false };
        }
      } catch (error) {
        console.error('❌ Video frame save error:', error);
        return { success: false, message: error.message };
      }
    });
  }
}

module.exports = VideoFrameIPC;
