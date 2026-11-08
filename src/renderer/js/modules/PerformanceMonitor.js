// src/renderer/js/modules/PerformanceMonitor.js
class PerformanceMonitor {
  constructor() {
    this.metrics = {
      fps: [],
      memoryUsage: [],
      renderTimes: [],
      imageLoadTimes: [],
      domNodes: [],
      eventListeners: [],
      cpuTime: [],
      paintTime: []
    };
    
    this.isMonitoring = false;
    this.updateInterval = null;
    this.fpsInterval = null;
    this.lastFrameTime = performance.now();
    this.frameCount = 0;
    this.startTime = Date.now();
    this.peakMemory = 0;
    this.peakDOMNodes = 0;
    this.minFPS = Infinity;
    this.totalImageLoads = 0;
    this.failedImageLoads = 0;
    
    // Performance marks for tracking operations
    this.operations = new Map();
    this.completedOperations = [];
    
    // System info
    this.systemInfo = this.getSystemInfo();
    
    console.log('📊 Performance Monitor initialized');
  }
  
  /**
   * Get system information
   */
  getSystemInfo() {
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      cores: navigator.hardwareConcurrency || 'unknown',
      memory: navigator.deviceMemory || 'unknown',
      connection: navigator.connection ? {
        effectiveType: navigator.connection.effectiveType,
        downlink: navigator.connection.downlink,
        rtt: navigator.connection.rtt
      } : 'unknown',
      screen: {
        width: window.screen.width,
        height: window.screen.height,
        colorDepth: window.screen.colorDepth
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      }
    };
  }

  /**
   * Start monitoring performance
   */
  startMonitoring() {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    console.log('🔍 Starting performance monitoring...');
    
    // Create monitoring UI
    this.createMonitorUI();
    
    // Monitor FPS
    this.startFPSMonitoring();
    
    // Monitor memory and DOM every second
    this.updateInterval = setInterval(() => {
      this.updateMetrics();
    }, 1000);
    
    // Log summary every 10 seconds
    setInterval(() => {
      this.logPerformanceSummary();
    }, 10000);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (!this.isMonitoring) return;
    
    this.isMonitoring = false;
    console.log('🛑 Stopping performance monitoring...');
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    if (this.fpsInterval) {
      cancelAnimationFrame(this.fpsInterval);
      this.fpsInterval = null;
    }
    
    this.removeMonitorUI();
  }

  /**
   * Create floating performance monitor UI
   */
  createMonitorUI() {
    // Remove existing if present
    this.removeMonitorUI();
    
    const monitor = document.createElement('div');
    monitor.id = 'performance-monitor';
    monitor.style.cssText = `
      position: fixed;
      top: 60px;
      right: 10px;
      background: rgba(0, 0, 0, 0.9);
      color: #00ff00;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      padding: 10px;
      border-radius: 4px;
      z-index: 999999;
      min-width: 200px;
      border: 1px solid #00ff00;
      user-select: none;
    `;
    
    monitor.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; border-bottom: 1px solid #00ff00; padding-bottom: 5px;">
        <strong>Performance Monitor</strong>
        <div>
          <button id="perf-copy" style="background: #00aa00; border: 1px solid #00ff00; color: #fff; cursor: pointer; font-size: 10px; padding: 2px 6px; margin-right: 4px; border-radius: 2px;" title="Copy metrics to clipboard">📋</button>
          <button id="perf-close" style="background: none; border: none; color: #ff0000; cursor: pointer; font-size: 14px; padding: 0; line-height: 1;">×</button>
        </div>
      </div>
      <div id="perf-fps">FPS: --</div>
      <div id="perf-fps-min">Min FPS: --</div>
      <div id="perf-memory">Memory: --</div>
      <div id="perf-memory-peak">Peak Memory: --</div>
      <div id="perf-dom">DOM Nodes: --</div>
      <div id="perf-dom-peak">Peak Nodes: --</div>
      <div id="perf-images">Images: --</div>
      <div id="perf-images-failed">Failed: --</div>
      <div id="perf-render">Avg Render: --</div>
      <div id="perf-uptime">Uptime: --</div>
      <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #00ff00;">
        <div id="perf-operations"></div>
      </div>
    `;
    
    document.body.appendChild(monitor);
    
    // Copy button handler
    document.getElementById('perf-copy').addEventListener('click', () => {
      this.copyMetricsToClipboard();
    });
    
    // Close button handler
    document.getElementById('perf-close').addEventListener('click', () => {
      this.stopMonitoring();
    });
    
    // Make it draggable
    this.makeDraggable(monitor);
  }

  /**
   * Make monitor UI draggable
   */
  makeDraggable(element) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    
    element.onmousedown = dragMouseDown;
    
    function dragMouseDown(e) {
      if (e.target.id === 'perf-close') return;
      
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    }
    
    function elementDrag(e) {
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      element.style.top = (element.offsetTop - pos2) + 'px';
      element.style.right = 'auto';
      element.style.left = (element.offsetLeft - pos1) + 'px';
    }
    
    function closeDragElement() {
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }

  /**
   * Remove monitor UI
   */
  removeMonitorUI() {
    const existing = document.getElementById('performance-monitor');
    if (existing) {
      existing.remove();
    }
  }

  /**
   * Start FPS monitoring
   */
  startFPSMonitoring() {
    const measureFPS = () => {
      const now = performance.now();
      const delta = now - this.lastFrameTime;
      this.lastFrameTime = now;
      this.frameCount++;
      
      const fps = Math.round(1000 / delta);
      this.metrics.fps.push(fps);
      
      // Keep only last 60 frames
      if (this.metrics.fps.length > 60) {
        this.metrics.fps.shift();
      }
      
      if (this.isMonitoring) {
        this.fpsInterval = requestAnimationFrame(measureFPS);
      }
    };
    
    this.fpsInterval = requestAnimationFrame(measureFPS);
  }

  /**
   * Update metrics display
   */
  updateMetrics() {
    // Calculate average FPS
    const avgFPS = this.metrics.fps.length > 0
      ? Math.round(this.metrics.fps.reduce((a, b) => a + b, 0) / this.metrics.fps.length)
      : 0;
    
    // Track min FPS
    if (avgFPS > 0 && avgFPS < this.minFPS) {
      this.minFPS = avgFPS;
    }
    
    // Get memory usage
    const memory = performance.memory ? {
      used: Math.round(performance.memory.usedJSHeapSize / 1048576),
      total: Math.round(performance.memory.totalJSHeapSize / 1048576),
      limit: Math.round(performance.memory.jsHeapSizeLimit / 1048576)
    } : null;
    
    // Track peak memory
    if (memory && memory.used > this.peakMemory) {
      this.peakMemory = memory.used;
    }
    
    // Count DOM nodes
    const domNodes = document.getElementsByTagName('*').length;
    
    // Track peak DOM nodes
    if (domNodes > this.peakDOMNodes) {
      this.peakDOMNodes = domNodes;
    }
    
    // Count images
    const images = document.querySelectorAll('img').length;
    const loadedImages = document.querySelectorAll('img[complete]').length;
    
    // Calculate average render time
    const avgRenderTime = this.metrics.renderTimes.length > 0
      ? Math.round(this.metrics.renderTimes.reduce((a, b) => a + b, 0) / this.metrics.renderTimes.length)
      : 0;
    
    // Calculate uptime
    const uptime = Math.round((Date.now() - this.startTime) / 1000);
    const uptimeStr = uptime >= 60 
      ? `${Math.floor(uptime / 60)}m ${uptime % 60}s`
      : `${uptime}s`;
    
    // Update UI
    const fpsColor = avgFPS >= 30 ? '#00ff00' : avgFPS >= 20 ? '#ffff00' : '#ff0000';
    document.getElementById('perf-fps').innerHTML = 
      `<span style="color: ${fpsColor}">FPS: ${avgFPS}</span>`;
    
    const minFpsColor = this.minFPS >= 30 ? '#00ff00' : this.minFPS >= 20 ? '#ffff00' : '#ff0000';
    document.getElementById('perf-fps-min').innerHTML = 
      `<span style="color: ${minFpsColor}">Min FPS: ${this.minFPS === Infinity ? '--' : this.minFPS}</span>`;
    
    if (memory) {
      const memColor = memory.used / memory.limit > 0.8 ? '#ff0000' : '#00ff00';
      document.getElementById('perf-memory').innerHTML = 
        `<span style="color: ${memColor}">Memory: ${memory.used}MB / ${memory.limit}MB</span>`;
      
      const peakMemColor = this.peakMemory / memory.limit > 0.8 ? '#ff0000' : '#00ff00';
      document.getElementById('perf-memory-peak').innerHTML = 
        `<span style="color: ${peakMemColor}">Peak Memory: ${this.peakMemory}MB</span>`;
    } else {
      document.getElementById('perf-memory').innerHTML = 'Memory: N/A';
      document.getElementById('perf-memory-peak').innerHTML = 'Peak Memory: N/A';
    }
    
    const domColor = domNodes > 5000 ? '#ff0000' : domNodes > 3000 ? '#ffff00' : '#00ff00';
    document.getElementById('perf-dom').innerHTML = 
      `<span style="color: ${domColor}">DOM Nodes: ${domNodes}</span>`;
    
    const peakDomColor = this.peakDOMNodes > 5000 ? '#ff0000' : this.peakDOMNodes > 3000 ? '#ffff00' : '#00ff00';
    document.getElementById('perf-dom-peak').innerHTML = 
      `<span style="color: ${peakDomColor}">Peak Nodes: ${this.peakDOMNodes}</span>`;
    
    document.getElementById('perf-images').textContent = 
      `Images: ${loadedImages}/${images}`;
    
    const failedColor = this.failedImageLoads > 0 ? '#ff0000' : '#00ff00';
    document.getElementById('perf-images-failed').innerHTML = 
      `<span style="color: ${failedColor}">Failed: ${this.failedImageLoads}</span>`;
    
    document.getElementById('perf-render').textContent = 
      `Avg Render: ${avgRenderTime}ms`;
    
    document.getElementById('perf-uptime').textContent = 
      `Uptime: ${uptimeStr}`;
    
    // Show active operations
    this.updateOperationsDisplay();
    
    // Log warnings
    if (avgFPS < 20) {
      console.warn('⚠️ Low FPS detected:', avgFPS);
    }
    if (memory && memory.used / memory.limit > 0.8) {
      console.warn('⚠️ High memory usage:', memory.used, 'MB');
    }
    if (domNodes > 5000) {
      console.warn('⚠️ High DOM node count:', domNodes);
    }
  }

  /**
   * Update operations display
   */
  updateOperationsDisplay() {
    const opsDiv = document.getElementById('perf-operations');
    if (!opsDiv) return;
    
    const activeOps = Array.from(this.operations.entries())
      .filter(([_, data]) => !data.endTime)
      .map(([name, data]) => {
        const duration = performance.now() - data.startTime;
        return `${name}: ${Math.round(duration)}ms`;
      });
    
    if (activeOps.length > 0) {
      opsDiv.innerHTML = '<strong>Active:</strong><br>' + activeOps.join('<br>');
    } else {
      opsDiv.innerHTML = '<em style="color: #666;">No active operations</em>';
    }
  }

  /**
   * Mark the start of an operation
   */
  markStart(operationName) {
    this.operations.set(operationName, {
      startTime: performance.now(),
      endTime: null
    });
    console.log(`⏱️ Started: ${operationName}`);
  }

  /**
   * Mark the end of an operation
   */
  markEnd(operationName) {
    const operation = this.operations.get(operationName);
    if (!operation) {
      console.warn(`⚠️ No start mark found for: ${operationName}`);
      return;
    }
    
    operation.endTime = performance.now();
    const duration = operation.endTime - operation.startTime;
    
    // Store completed operation
    this.completedOperations.push({
      name: operationName,
      duration: duration,
      timestamp: Date.now()
    });
    
    // Keep only last 50 completed operations
    if (this.completedOperations.length > 50) {
      this.completedOperations.shift();
    }
    
    // Track render times for display operations
    if (operationName.includes('render') || operationName.includes('display')) {
      this.metrics.renderTimes.push(duration);
      if (this.metrics.renderTimes.length > 20) {
        this.metrics.renderTimes.shift();
      }
    }
    
    console.log(`✅ Completed: ${operationName} (${Math.round(duration)}ms)`);
    
    // Warn if operation took too long
    if (duration > 1000) {
      console.warn(`⚠️ Slow operation: ${operationName} took ${Math.round(duration)}ms`);
    }
    
    return duration;
  }

  /**
   * Track image loading performance
   */
  trackImageLoad(imageUrl, isError = false) {
    const startTime = performance.now();
    this.totalImageLoads++;
    
    return (failed = false) => {
      const loadTime = performance.now() - startTime;
      
      if (failed) {
        this.failedImageLoads++;
      }
      
      this.metrics.imageLoadTimes.push(loadTime);
      
      // Keep only last 100 measurements
      if (this.metrics.imageLoadTimes.length > 100) {
        this.metrics.imageLoadTimes.shift();
      }
      
      if (loadTime > 500) {
        console.warn(`⚠️ Slow image load: ${imageUrl} (${Math.round(loadTime)}ms)`);
      }
    };
  }

  /**
   * Copy comprehensive metrics to clipboard
   */
  async copyMetricsToClipboard() {
    const metrics = this.getDetailedMetrics();
    
    const report = this.formatMetricsReport(metrics);
    
    try {
      await navigator.clipboard.writeText(report);
      console.log('✅ Metrics copied to clipboard');
      
      // Visual feedback
      const btn = document.getElementById('perf-copy');
      if (btn) {
        const originalText = btn.textContent;
        btn.textContent = '✓';
        btn.style.background = '#00ff00';
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.background = '#00aa00';
        }, 1000);
      }
    } catch (error) {
      console.error('❌ Failed to copy metrics:', error);
      alert('Failed to copy metrics to clipboard');
    }
  }

  /**
   * Get detailed metrics for export
   */
  getDetailedMetrics() {
    const avgFPS = this.metrics.fps.length > 0
      ? Math.round(this.metrics.fps.reduce((a, b) => a + b, 0) / this.metrics.fps.length)
      : 0;
    
    const memory = performance.memory ? {
      used: Math.round(performance.memory.usedJSHeapSize / 1048576),
      total: Math.round(performance.memory.totalJSHeapSize / 1048576),
      limit: Math.round(performance.memory.jsHeapSizeLimit / 1048576)
    } : null;
    
    const avgImageLoad = this.metrics.imageLoadTimes.length > 0
      ? Math.round(this.metrics.imageLoadTimes.reduce((a, b) => a + b, 0) / this.metrics.imageLoadTimes.length)
      : 0;
    
    const avgRenderTime = this.metrics.renderTimes.length > 0
      ? Math.round(this.metrics.renderTimes.reduce((a, b) => a + b, 0) / this.metrics.renderTimes.length)
      : 0;
    
    const maxImageLoad = this.metrics.imageLoadTimes.length > 0
      ? Math.max(...this.metrics.imageLoadTimes)
      : 0;
    
    const maxRenderTime = this.metrics.renderTimes.length > 0
      ? Math.max(...this.metrics.renderTimes)
      : 0;
    
    // Get slowest operations
    const slowestOps = this.completedOperations
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10)
      .map(op => ({
        name: op.name,
        duration: Math.round(op.duration)
      }));
    
    const uptime = Math.round((Date.now() - this.startTime) / 1000);
    
    return {
      timestamp: new Date().toISOString(),
      uptime: uptime,
      system: this.systemInfo,
      performance: {
        fps: {
          current: avgFPS,
          min: this.minFPS === Infinity ? 0 : this.minFPS
        },
        memory: memory ? {
          current: memory.used,
          peak: this.peakMemory,
          limit: memory.limit,
          utilization: Math.round((memory.used / memory.limit) * 100)
        } : null,
        dom: {
          current: document.getElementsByTagName('*').length,
          peak: this.peakDOMNodes
        },
        images: {
          total: document.querySelectorAll('img').length,
          loaded: document.querySelectorAll('img[complete]').length,
          failed: this.failedImageLoads,
          totalLoaded: this.totalImageLoads,
          avgLoadTime: avgImageLoad,
          maxLoadTime: Math.round(maxImageLoad)
        },
        rendering: {
          avgTime: avgRenderTime,
          maxTime: Math.round(maxRenderTime)
        }
      },
      operations: {
        total: this.completedOperations.length,
        slowest: slowestOps
      }
    };
  }

  /**
   * Format metrics as readable report
   */
  formatMetricsReport(metrics) {
    const lines = [];
    
    lines.push('='.repeat(60));
    lines.push('ANTLER - PERFORMANCE METRICS REPORT');
    lines.push('='.repeat(60));
    lines.push('');
    
    lines.push(`Timestamp: ${metrics.timestamp}`);
    lines.push(`Uptime: ${Math.floor(metrics.uptime / 60)}m ${metrics.uptime % 60}s`);
    lines.push('');
    
    lines.push('--- SYSTEM INFORMATION ---');
    lines.push(`Platform: ${metrics.system.platform}`);
    lines.push(`CPU Cores: ${metrics.system.cores}`);
    lines.push(`Device Memory: ${metrics.system.memory}GB`);
    lines.push(`Screen: ${metrics.system.screen.width}x${metrics.system.screen.height} (${metrics.system.screen.colorDepth}-bit)`);
    lines.push(`Viewport: ${metrics.system.viewport.width}x${metrics.system.viewport.height}`);
    if (metrics.system.connection !== 'unknown') {
      lines.push(`Connection: ${metrics.system.connection.effectiveType} (${metrics.system.connection.downlink}Mbps, ${metrics.system.connection.rtt}ms RTT)`);
    }
    lines.push(`User Agent: ${metrics.system.userAgent}`);
    lines.push('');
    
    lines.push('--- PERFORMANCE METRICS ---');
    lines.push(`FPS (current): ${metrics.performance.fps.current}`);
    lines.push(`FPS (minimum): ${metrics.performance.fps.min}`);
    lines.push('');
    
    if (metrics.performance.memory) {
      lines.push(`Memory (current): ${metrics.performance.memory.current}MB`);
      lines.push(`Memory (peak): ${metrics.performance.memory.peak}MB`);
      lines.push(`Memory (limit): ${metrics.performance.memory.limit}MB`);
      lines.push(`Memory Utilization: ${metrics.performance.memory.utilization}%`);
      lines.push('');
    }
    
    lines.push(`DOM Nodes (current): ${metrics.performance.dom.current}`);
    lines.push(`DOM Nodes (peak): ${metrics.performance.dom.peak}`);
    lines.push('');
    
    lines.push(`Images Total: ${metrics.performance.images.total}`);
    lines.push(`Images Loaded: ${metrics.performance.images.loaded}`);
    lines.push(`Images Failed: ${metrics.performance.images.failed}`);
    lines.push(`Total Image Loads: ${metrics.performance.images.totalLoaded}`);
    lines.push(`Avg Image Load Time: ${metrics.performance.images.avgLoadTime}ms`);
    lines.push(`Max Image Load Time: ${metrics.performance.images.maxLoadTime}ms`);
    lines.push('');
    
    lines.push(`Avg Render Time: ${metrics.performance.rendering.avgTime}ms`);
    lines.push(`Max Render Time: ${metrics.performance.rendering.maxTime}ms`);
    lines.push('');
    
    if (metrics.operations.slowest.length > 0) {
      lines.push('--- SLOWEST OPERATIONS ---');
      metrics.operations.slowest.forEach((op, i) => {
        lines.push(`${i + 1}. ${op.name}: ${op.duration}ms`);
      });
      lines.push('');
    }
    
    lines.push('='.repeat(60));
    
    return lines.join('\n');
  }

  /**
   * Log performance summary
   */
  logPerformanceSummary() {
    if (!this.isMonitoring) return;
    
    const avgFPS = this.metrics.fps.length > 0
      ? Math.round(this.metrics.fps.reduce((a, b) => a + b, 0) / this.metrics.fps.length)
      : 0;
    
    const avgImageLoad = this.metrics.imageLoadTimes.length > 0
      ? Math.round(this.metrics.imageLoadTimes.reduce((a, b) => a + b, 0) / this.metrics.imageLoadTimes.length)
      : 0;
    
    const memory = performance.memory ? {
      used: Math.round(performance.memory.usedJSHeapSize / 1048576),
      total: Math.round(performance.memory.totalJSHeapSize / 1048576)
    } : null;
    
    console.log('📊 Performance Summary:');
    console.log(`   FPS: ${avgFPS}`);
    if (memory) {
      console.log(`   Memory: ${memory.used}MB / ${memory.total}MB`);
    }
    console.log(`   DOM Nodes: ${document.getElementsByTagName('*').length}`);
    console.log(`   Images: ${document.querySelectorAll('img').length}`);
    console.log(`   Avg Image Load: ${avgImageLoad}ms`);
    
    // Show completed operations
    const completedOps = Array.from(this.operations.entries())
      .filter(([_, data]) => data.endTime)
      .map(([name, data]) => ({
        name,
        duration: data.endTime - data.startTime
      }))
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5);
    
    if (completedOps.length > 0) {
      console.log('   Slowest Operations:');
      completedOps.forEach(op => {
        console.log(`     - ${op.name}: ${Math.round(op.duration)}ms`);
      });
    }
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return {
      fps: this.metrics.fps.length > 0
        ? Math.round(this.metrics.fps.reduce((a, b) => a + b, 0) / this.metrics.fps.length)
        : 0,
      memory: performance.memory ? {
        used: Math.round(performance.memory.usedJSHeapSize / 1048576),
        total: Math.round(performance.memory.totalJSHeapSize / 1048576),
        limit: Math.round(performance.memory.jsHeapSizeLimit / 1048576)
      } : null,
      domNodes: document.getElementsByTagName('*').length,
      images: {
        total: document.querySelectorAll('img').length,
        loaded: document.querySelectorAll('img[complete]').length
      },
      avgImageLoadTime: this.metrics.imageLoadTimes.length > 0
        ? Math.round(this.metrics.imageLoadTimes.reduce((a, b) => a + b, 0) / this.metrics.imageLoadTimes.length)
        : 0
    };
  }

  /**
   * Profile a function
   */
  profile(fn, name) {
    return async (...args) => {
      this.markStart(name);
      try {
        const result = await fn(...args);
        this.markEnd(name);
        return result;
      } catch (error) {
        this.markEnd(name);
        throw error;
      }
    };
  }
}

// Create global instance
window.performanceMonitor = new PerformanceMonitor();

// Expose toggle function
window.togglePerformanceMonitor = () => {
  if (window.performanceMonitor.isMonitoring) {
    window.performanceMonitor.stopMonitoring();
  } else {
    window.performanceMonitor.startMonitoring();
  }
};

console.log('📊 Performance Monitor loaded. Use togglePerformanceMonitor() to start/stop monitoring.');
