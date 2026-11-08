const { ipcMain } = require('electron');
const GpuMonitor = require('../services/GpuMonitor');

class SystemIPC {
  constructor() {
    this.gpu = new GpuMonitor();
    this.setupHandlers();
    console.log('🔗 System IPC handlers registered');
  }

  setupHandlers() {
    ipcMain.handle('system:gpu-status', async () => {
      try {
        return { success: true, ...await this.gpu.status() };
      } catch (error) {
        console.error('❌ GPU status error:', error);
        return { success: false, available: false, message: error.message };
      }
    });
  }
}

module.exports = SystemIPC;
