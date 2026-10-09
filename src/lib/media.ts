export function backgroundAllowed(): boolean {
  return document.visibilityState === 'visible'
    && (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData !== true;
}

/** Only background work waits for load and idle; foreground media never uses this. */
export function afterLoadIdle(run: () => void): () => void {
  let cancelled = false;
  let cancelIdle = () => {};
  const loaded = () => {
    if (cancelled) return;
    if (window.requestIdleCallback) {
      const id = window.requestIdleCallback(() => { if (!cancelled) run(); });
      cancelIdle = () => window.cancelIdleCallback(id);
    } else {
      const id = setTimeout(() => { if (!cancelled) run(); }, 300);
      cancelIdle = () => clearTimeout(id);
    }
  };
  if (document.readyState === 'complete') loaded();
  else window.addEventListener('load', loaded, { once: true });
  return () => { cancelled = true; window.removeEventListener('load', loaded); cancelIdle(); };
}

export function loadWallpaper(url: string): { image: HTMLImageElement; ready: Promise<void>; cancel?: () => void } {
  const image = new Image();
  let cancel = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout); image.onload = null; image.onerror = null;
      error ? reject(error) : resolve();
    };
    const timeout = setTimeout(() => finish(new Error('timeout')), 10000);
    cancel = () => finish(new Error('cancelled'));
    image.onload = () => { void image.decode().then(() => finish(), () => finish(new Error('decode'))); };
    image.onerror = () => finish(new Error('load'));
    image.src = url;
  });
  return { image, ready, cancel };
}

/** One fixed candidate. Invalidated work may finish but cannot replace a newer candidate. */
export class WallpaperCandidate {
  private candidate?: { url: string; image: HTMLImageElement; ready: Promise<void>; failed: boolean; cancel?: () => void };
  constructor(private load = loadWallpaper, private random = Math.random) {}
  prepare(list: string[], current: string) {
    if (this.candidate) return this.candidate;
    const choices = list.filter(url => url !== current);
    const url = choices[Math.floor(this.random() * choices.length)];
    if (!url) return;
    const candidate = { url, ...this.load(url), failed: false };
    this.candidate = candidate;
    void candidate.ready.catch(() => { candidate.failed = true; });
    return candidate;
  }
  take(list: string[], current: string) {
    if (this.candidate?.failed) this.clear();
    return this.prepare(list, current);
  }
  clear() { this.candidate?.cancel?.(); this.candidate = undefined; }
}

/** Each attachment owns its callbacks and promise; detached media cannot affect its successor. */
export function attachVideo(video: HTMLVideoElement, ready: (playing: boolean) => void, failed: () => void, canPlay = () => true) {
  let active = true;
  let pending = false;
  let attempt = 0;
  const playing = () => { if (active) { if (canPlay()) ready(true); else video.pause(); } };
  const waiting = () => { if (active) ready(false); };
  const error = () => { if (active) failed(); };
  video.addEventListener('playing', playing);
  video.addEventListener('waiting', waiting);
  video.addEventListener('stalled', waiting);
  video.addEventListener('error', error);
  const resume = () => {
    if (!active || !canPlay() || pending || !video.paused) return;
    pending = true;
    const version = ++attempt;
    void video.play().then(() => { if (!active || !canPlay()) video.pause(); }).catch(() => {
      if (active && version === attempt && canPlay()) failed();
    }).finally(() => { if (version === attempt) pending = false; });
  };
  resume();
  return {
    resume,
    pause: () => { ++attempt; pending = false; video.pause(); },
    destroy() {
      active = false;
      ++attempt;
      video.removeEventListener('playing', playing);
      video.removeEventListener('waiting', waiting);
      video.removeEventListener('stalled', waiting);
      video.removeEventListener('error', error);
      video.pause(); video.removeAttribute('src'); video.load();
    },
  };
}
