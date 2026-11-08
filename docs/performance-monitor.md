# Performance Monitoring Guide

## Overview
The Performance Monitor helps identify performance bottlenecks in Antler, especially when dealing with large image galleries on older hardware.

## How to Enable

### Keyboard Shortcut
Press **Ctrl+Shift+P** to toggle the performance monitor on/off.

### Console Command
Open DevTools (F12) and run:
```javascript
togglePerformanceMonitor()
```

## What It Monitors

### 1. **FPS (Frames Per Second)**
- **Current FPS**: Real-time frame rate
- **Min FPS**: Lowest FPS recorded during session
- **Green**: 30+ FPS (Good)
- **Yellow**: 20-29 FPS (Acceptable)
- **Red**: <20 FPS (Poor - indicates lag)

Low FPS indicates the renderer is struggling to keep up with animations, scrolling, or image loading.

### 2. **Memory Usage**
- **Current Memory**: Current JavaScript heap usage (used / limit)
- **Peak Memory**: Highest memory usage during session
- **Red**: >80% memory usage (risk of crashes)
- **Green**: Normal usage

High memory indicates too many images loaded or memory leaks.

### 3. **DOM Nodes**
- **Current Nodes**: Total number of HTML elements on the page
- **Peak Nodes**: Maximum DOM nodes during session
- **Red**: >5000 nodes (performance impact)
- **Yellow**: >3000 nodes (moderate)
- **Green**: <3000 nodes (optimal)

Many DOM nodes slow down rendering and scrolling.

### 4. **Images**
- **Total/Loaded**: Shows loaded/total images
- **Failed**: Number of images that failed to load
- **Avg Load Time**: Average time to load an image
- Logs warnings for images taking >500ms

### 5. **Rendering Performance**
- **Avg Render**: Average time for render operations
- Shows time taken to display posts, update UI, etc.

### 6. **Uptime**
- Time since monitoring started
- Helps correlate performance degradation over time

### 7. **Active Operations**
Shows currently running operations with duration:
- `displayPosts` - Rendering post thumbnails
- `renderAllPosts` - Creating DOM elements for posts
- `loadMorePosts` - Loading additional pages

## Copy Metrics Feature

### Quick Copy
Click the **📋 button** in the top-right of the performance monitor to copy a comprehensive report to your clipboard.

### What's Included in the Report
The report contains:
- **System Information**: Platform, CPU cores, memory, screen resolution, user agent
- **Performance Metrics**: FPS (current/min), Memory (current/peak/limit), DOM nodes, Images
- **Image Statistics**: Total loaded, failed count, average/max load times
- **Rendering Times**: Average and maximum render durations
- **Slowest Operations**: Top 10 slowest operations with durations

### Sample Report Format
```
============================================================
ANTLER - PERFORMANCE METRICS REPORT
============================================================

Timestamp: 2025-10-19T15:30:45.123Z
Uptime: 5m 23s

--- SYSTEM INFORMATION ---
Platform: Win32
CPU Cores: 4
Device Memory: 8GB
Screen: 1920x1080 (24-bit)
Viewport: 1200x680
Connection: 4g (10Mbps, 50ms RTT)
User Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)...

--- PERFORMANCE METRICS ---
FPS (current): 28
FPS (minimum): 18

Memory (current): 145MB
Memory (peak): 187MB
Memory (limit): 512MB
Memory Utilization: 28%

DOM Nodes (current): 2847
DOM Nodes (peak): 3421

Images Total: 120
Images Loaded: 118
Images Failed: 2
Total Image Loads: 120
Avg Image Load Time: 234ms
Max Image Load Time: 892ms

Avg Render Time: 145ms
Max Render Time: 1234ms

--- SLOWEST OPERATIONS ---
1. displayPosts: 1234ms
2. renderAllPosts: 892ms
3. loadMorePosts: 456ms
...
============================================================
```

## Performance Logs

The monitor logs to console every 10 seconds:
```
📊 Performance Summary:
   FPS: 28
   Memory: 145MB / 512MB
   DOM Nodes: 2847
   Images: 120
   Avg Image Load: 234ms
   Slowest Operations:
     - displayPosts: 1245ms
     - renderAllPosts: 892ms
```

## Common Performance Issues

### Issue: Low FPS when loading artist posts
**Symptoms**: FPS drops below 20, UI feels sluggish
**Causes**:
- Loading too many images at once
- High DOM node count
- Heavy CSS animations on many elements

**Solutions**:
1. Reduce number of visible posts
2. Implement image lazy loading
3. Use CSS `will-change` sparingly
4. Disable expensive animations

### Issue: High memory usage
**Symptoms**: Memory >80%, browser may become unresponsive
**Causes**:
- Too many images loaded in memory
- Not cleaning up old posts when navigating
- Memory leaks from event listeners

**Solutions**:
1. Clear previous posts before loading new ones
2. Use virtual scrolling for large datasets
3. Unload images when scrolling out of view
4. Remove event listeners when destroying elements

### Issue: Slow image loading
**Symptoms**: Images take >500ms to load
**Causes**:
- Slow network connection
- Large image files
- Too many concurrent requests

**Solutions**:
1. Use preview URLs instead of full-size images
2. Implement progressive image loading
3. Limit concurrent image requests
4. Add image caching

### Issue: High DOM node count
**Symptoms**: >5000 DOM nodes, slow scrolling
**Causes**:
- Loading hundreds of posts at once
- Not using virtual scrolling
- Complex HTML structure per post

**Solutions**:
1. Enable virtual scrolling for large datasets
2. Simplify post thumbnail HTML
3. Remove posts that are far from viewport
4. Use CSS instead of DOM elements where possible

## Developer Tips

### Track Custom Operations
```javascript
// Mark start of operation
window.performanceMonitor.markStart('myOperation');

// ... do work ...

// Mark end and get duration
const duration = window.performanceMonitor.markEnd('myOperation');
```

### Track Image Loading
```javascript
const trackLoad = window.performanceMonitor.trackImageLoad(imageUrl);

image.addEventListener('load', () => {
  trackLoad(); // Records load time
});
```

### Get Current Metrics
```javascript
const metrics = window.performanceMonitor.getMetrics();
console.log(metrics);
// {
//   fps: 28,
//   memory: { used: 145, total: 256, limit: 512 },
//   domNodes: 2847,
//   images: { total: 120, loaded: 118 },
//   avgImageLoadTime: 234
// }
```

## Optimization Strategies

### For Artist Search Tool

1. **Limit initial render**: Only show 50-100 posts initially
2. **Lazy load images**: Use `loading="lazy"` attribute
3. **Virtual scrolling**: Render only visible posts
4. **Debounce scroll events**: Don't process every scroll event
5. **Batch DOM updates**: Use DocumentFragment for multiple elements
6. **Optimize thumbnails**: Request smaller preview images
7. **Clean up on navigate**: Remove old posts before loading new ones

### For Tag Editor Tool

1. **Virtualize large tag lists**: Don't render all tags at once
2. **Debounce search/filter**: Wait for user to stop typing
3. **Limit concurrent operations**: Process images in batches
4. **Cache processed data**: Don't reprocess same images

### General Optimizations

1. **Use CSS transforms**: Instead of changing layout properties
2. **Minimize reflows**: Batch style changes
3. **RequestAnimationFrame**: For smooth animations
4. **Web Workers**: For heavy processing off main thread
5. **Intersection Observer**: For lazy loading and cleanup
6. **Remove unused listeners**: Prevent memory leaks

## Benchmarking Hardware

### Target Performance (Lenovo Carbon X1 Gen 3)
- **CPU**: Intel Core i5-5300U (2.3 GHz, dual-core)
- **RAM**: 8GB
- **Graphics**: Intel HD Graphics 5500

### Expected Performance Targets
- **FPS**: Maintain >30 FPS during normal use
- **Memory**: Stay under 400MB for typical usage
- **DOM Nodes**: Keep under 3000 nodes when possible
- **Image Load**: Average <300ms per image
- **Render Time**: 
  - Display 50 posts: <500ms
  - Display 100 posts: <1000ms

### Performance Testing Checklist
- [ ] Search for artist with 100+ posts
- [ ] Scroll through posts smoothly (>20 FPS)
- [ ] Load additional pages (infinite scroll)
- [ ] Select/deselect multiple posts
- [ ] Switch between different artists
- [ ] Check memory doesn't exceed 500MB
- [ ] Verify images load within 500ms

## Troubleshooting

### Monitor not appearing
1. Make sure you're using Ctrl+Shift+P (not just Ctrl+P)
2. Check browser console for errors
3. Verify `PerformanceMonitor.js` is loaded

### Inaccurate metrics
1. Chrome/Edge provides more accurate memory metrics
2. FPS drops during DevTools profiling (normal)
3. Other browser tabs can affect performance

### Performance still poor
1. Check for browser extensions causing issues
2. Verify GPU acceleration is enabled
3. Close other applications
4. Check for system resource usage (Task Manager)
5. Consider hardware limitations of older laptops

## Additional Resources

- [Chrome DevTools Performance](https://developer.chrome.com/docs/devtools/performance/)
- [Web Performance APIs](https://developer.mozilla.org/en-US/docs/Web/API/Performance)
- [Rendering Performance](https://web.dev/rendering-performance/)
