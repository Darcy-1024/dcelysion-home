import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WallpaperCandidate, attachVideo, afterLoadIdle, backgroundAllowed } from './media';

test('wallpaper clicks reuse a fixed pending candidate and invalidation isolates completion', async () => {
  let calls = 0;
  let resolve!: () => void;
  const cache = new WallpaperCandidate(() => {
    calls++;
    return { image: {} as HTMLImageElement, ready: new Promise<void>(done => { resolve = done; }) };
  }, () => 0);
  const first = cache.prepare(['a', 'b'], 'a')!;
  assert.equal(first.url, 'b');
  assert.equal(cache.take(['a', 'b'], 'a'), first);
  assert.equal(calls, 1);
  const oldResolve = resolve;
  cache.clear();
  const mobile = cache.prepare(['m'], '')!;
  oldResolve(); await first.ready;
  assert.equal(cache.take(['m'], ''), mobile);
  assert.equal(calls, 2);
});

test('wallpaper background failure stays fixed until explicit click retries', async () => {
  let calls = 0;
  const cache = new WallpaperCandidate(() => ({ image: {} as HTMLImageElement, ready: (++calls, Promise.reject(new Error('network'))) }));
  const first = cache.prepare(['a'], '')!;
  await first.ready.catch(() => {});
  assert.equal(cache.prepare(['a'], ''), first);
  cache.take(['a'], '');
  assert.equal(calls, 2);
});

test('video starts immediately, deduplicates pending play, releases resources and isolates old events', async () => {
  class Video extends EventTarget {
    paused = true; plays = 0; loads = 0; removed = false;
    reject!: (error: Error) => void;
    play() { this.plays++; return new Promise<void>((_, reject) => { this.reject = reject; }); }
    pause() { this.paused = true; }
    load() { this.loads++; }
    removeAttribute() { this.removed = true; }
  }
  const video = new Video(); let events = 0; let errors = 0;
  const control = attachVideo(video as unknown as HTMLVideoElement, () => { events++; }, () => { errors++; });
  assert.equal(video.plays, 1);
  control.resume(); assert.equal(video.plays, 1);
  video.dispatchEvent(new Event('playing')); assert.equal(events, 1);
  control.destroy();
  video.dispatchEvent(new Event('playing')); video.dispatchEvent(new Event('error'));
  video.reject(new Error('late')); await Promise.resolve();
  assert.equal(events, 1); assert.equal(errors, 0);
  assert.equal(video.removed, true); assert.equal(video.loads, 1);
});

test('hidden video never starts, resume reuses it and cancelled play rejection is isolated', async () => {
  class Video extends EventTarget {
    paused = true; plays = 0; rejects: ((error: Error) => void)[] = [];
    play() { this.plays++; return new Promise<void>((_, reject) => { this.rejects.push(reject); }); }
    pause() { this.paused = true; }
    load() {}
    removeAttribute() {}
  }
  const video = new Video(); let visible = false; let failures = 0;
  const control = attachVideo(video as unknown as HTMLVideoElement, () => {}, () => { failures++; }, () => visible);
  assert.equal(video.plays, 0);
  visible = true; control.resume(); assert.equal(video.plays, 1);
  visible = false; control.pause();
  visible = true; control.resume(); assert.equal(video.plays, 2);
  video.rejects[0](new Error('old aborted play')); await Promise.resolve(); await Promise.resolve();
  assert.equal(failures, 0);
  video.rejects[1](new Error('blocked')); await Promise.resolve(); await Promise.resolve();
  assert.equal(failures, 1);
  control.destroy();
});

test('background work waits for load then idle, is cancellable, and observes saveData/visibility', () => {
  const descriptors = ['window', 'document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const target = new EventTarget(); let callback: (() => void) | undefined; let cancelled = 0; let runs = 0;
  const doc = { readyState: 'loading', visibilityState: 'visible' };
  const connection = { saveData: false };
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(target, {
      requestIdleCallback(fn: () => void) { callback = fn; return 1; }, cancelIdleCallback() { cancelled++; },
    }) });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { connection } });
    const cancel = afterLoadIdle(() => { runs++; });
    assert.equal(callback, undefined); target.dispatchEvent(new Event('load'));
    assert.equal(runs, 0); cancel(); callback!();
    assert.equal(runs, 0); assert.equal(cancelled, 1);
    doc.readyState = 'complete';
    const second = afterLoadIdle(() => { runs++; }); callback!(); assert.equal(runs, 1); second();
    assert.equal(backgroundAllowed(), true);
    connection.saveData = true; assert.equal(backgroundAllowed(), false);
    connection.saveData = false; doc.visibilityState = 'hidden'; assert.equal(backgroundAllowed(), false);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
