# Enhanced Performance Monitoring - Quick Guide

## New Features Added

### 📋 **Copy Button**
- Click the green **📋** button in the performance monitor
- Instantly copies a comprehensive metrics report to clipboard
- Button shows ✓ confirmation when copied successfully

### 📊 **Additional Metrics**

**FPS Tracking:**
- Current FPS (real-time)
- **Min FPS** (lowest recorded during session)

**Memory Tracking:**
- Current memory usage
- **Peak Memory** (highest usage during session)
- Memory limit and utilization percentage

**DOM Tracking:**
- Current DOM node count
- **Peak DOM Nodes** (highest count during session)

**Image Tracking:**
- Total images / Loaded images
- **Failed image count** (images that failed to load)
- Average load time
- Maximum load time
- Total images loaded during session

**Render Tracking:**
- **Average render time** for display operations
- Maximum render time

**Session Info:**
- **Uptime** (time since monitoring started)

**System Info (in exported report):**
- Platform and CPU cores
- Device memory
- Screen resolution and color depth
- Viewport size
- Network connection type and speed
- Full user agent string

### 📈 **Enhanced Operations Tracking**
- Now tracks last 50 completed operations
- Shows top 10 slowest operations in report
- Better tracking of render-specific operations

## How to Use

1. **Start the app** and press **Ctrl+Shift+P**
2. **Perform actions** that cause lag (search artist, load images, scroll)
3. **Click the 📋 button** when lag occurs
4. **Paste the report** here or in an issue

## What the Report Tells Us

The report will help identify:
- **If it's an FPS problem** → Look at Min FPS
- **If it's a memory problem** → Look at Peak Memory and utilization
- **If it's too many DOM nodes** → Look at Peak Nodes
- **If images are slow** → Look at Avg/Max Image Load Time
- **If specific operations are slow** → Look at Slowest Operations list
- **If it's your hardware** → System info shows CPU cores, memory, etc.

## Example Usage Scenario

```
1. Press Ctrl+Shift+P to start monitoring
2. Search for "eyeball6300_chiv" (has 60+ posts in your downloads)
3. Wait for all images to load
4. Notice if it's lagging
5. Click 📋 button
6. Paste report here
```

This will show us exactly what's happening when the lag occurs!

## Quick Interpretation

**Good Performance:**
- FPS: 30+ (min 25+)
- Memory: <50% utilization
- DOM Nodes: <3000
- Image Load: <300ms average

**Acceptable Performance:**
- FPS: 20-29 (min 15+)
- Memory: 50-80% utilization
- DOM Nodes: 3000-5000
- Image Load: 300-500ms average

**Poor Performance (needs optimization):**
- FPS: <20 (min <15)
- Memory: >80% utilization
- DOM Nodes: >5000
- Image Load: >500ms average
- Render operations: >1000ms
