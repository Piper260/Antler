// Frame readers for the Video Frames tool. Decoding is left to Chromium: a
// <video> element for video and ImageDecoder for animated images. Both read
// from a File, since a canvas drawn from a file:// URL can't be read back.

const LOAD_TIMEOUT = 20000;
const SEEK_TIMEOUT = 15000;
const ANIMATED_TYPES = { '.gif': 'image/gif', '.webp': 'image/webp', '.apng': 'image/apng' };

function waitForEvent(target, name, timeout, message) {
  return new Promise((resolve, reject) => {
    const finish = (settle, value) => {
      clearTimeout(timer);
      target.removeEventListener(name, onDone);
      target.removeEventListener('error', onError);
      settle(value);
    };
    const onDone = () => finish(resolve);
    const onError = () => finish(reject, new Error(message));
    const timer = setTimeout(() => finish(reject, new Error(message)), timeout);
    target.addEventListener(name, onDone);
    target.addEventListener('error', onError);
  });
}

class VideoSource {
  static async open(file) {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.muted = true;
    video.preload = 'auto';
    const unreadable = 'This video format can\'t be read. mp4 and webm work, as do animated GIF, WEBP and APNG.';

    try {
      const loaded = waitForEvent(video, 'loadeddata', LOAD_TIMEOUT, unreadable);
      video.src = url;
      await loaded;
      if (!video.videoWidth) throw new Error('This file has no picture.');

      // Some webm files don't state their length until the end has been reached.
      if (!Number.isFinite(video.duration)) {
        const reachedEnd = waitForEvent(video, 'seeked', SEEK_TIMEOUT, unreadable);
        video.currentTime = Number.MAX_SAFE_INTEGER;
        await reachedEnd;
      }
      return new VideoSource(video, url);
    } catch (error) {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      throw error;
    }
  }

  constructor(video, url) {
    this.video = video;
    this.url = url;
    this.width = video.videoWidth;
    this.height = video.videoHeight;
    this.summary = `${this.width} × ${this.height}, ${video.duration.toFixed(1)} s`;
    this.usesStep = true;
  }

  positions(step, limit) {
    return window.FrameSelect.sampleTimes(this.video.duration, step, limit);
  }

  async frameAt(time) {
    if (this.video.currentTime !== time) {
      const seeked = waitForEvent(this.video, 'seeked', SEEK_TIMEOUT, 'The video stopped responding while seeking.');
      this.video.currentTime = time;
      await seeked;
    }
    return { image: this.video, time };
  }

  close() {
    this.video.removeAttribute('src');
    this.video.load();
    URL.revokeObjectURL(this.url);
  }
}

class AnimatedImageSource {
  static async open(file, type) {
    if (!(await window.ImageDecoder.isTypeSupported(type))) throw new Error(`${type} can't be read.`);
    const decoder = new window.ImageDecoder({ data: await file.arrayBuffer(), type });
    try {
      await decoder.tracks.ready;
      await decoder.completed;
      const count = decoder.tracks.selectedTrack.frameCount;
      if (count < 2) throw new Error('This image isn\'t animated.');
      const source = new AnimatedImageSource(decoder, count);
      const first = await source.frameAt(0);
      source.width = first.image.displayWidth;
      source.height = first.image.displayHeight;
      source.summary = `${source.width} × ${source.height}, ${count} frames`;
      return source;
    } catch (error) {
      decoder.close();
      throw error;
    }
  }

  constructor(decoder, count) {
    this.decoder = decoder;
    this.count = count;
    this.current = null;
    this.usesStep = false;
  }

  // Every frame is already a distinct image, so `step` doesn't apply.
  positions(step, limit) {
    const stride = Math.ceil(this.count / limit);
    return Array.from({ length: Math.ceil(this.count / stride) }, (_, i) => i * stride);
  }

  async frameAt(index) {
    const { image } = await this.decoder.decode({ frameIndex: index });
    this.current?.close();
    this.current = image;
    return { image, time: image.timestamp / 1e6 };
  }

  close() {
    this.current?.close();
    this.current = null;
    this.decoder.close();
  }
}

/** Opens a video or animated image; throws a message fit to show if it can't. */
export function openFrameSource(file) {
  const extension = (file.name.match(/\.[^.]+$/)?.[0] || '').toLowerCase();
  const type = ANIMATED_TYPES[extension];
  return type ? AnimatedImageSource.open(file, type) : VideoSource.open(file);
}
