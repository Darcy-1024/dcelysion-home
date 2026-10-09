import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMusicPlayer, type AudioLike, type MusicState, type Track } from './music';

class FakeAudio extends EventTarget implements AudioLike {
  src = '';
  preload = '';
  volume = 1;
  currentTime = 0;
  duration = NaN;
  paused = true;
  error: { code: number } | null = null;
  loads = 0;
  plays = 0;
  playImpl: (() => Promise<void>) | undefined;
  play(): Promise<void> {
    this.plays++;
    if (this.playImpl) return this.playImpl();
    this.paused = false;
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  load() { this.loads++; this.error = null; }
  fire(name: string) { this.dispatchEvent(new Event(name)); }
}
const tracks: Track[] = ['a', 'b', 'c'].map(id => ({
  id, name: id, artist: 'Artist', url: `https://audio.example/${id}.mp3`, cover: `https://covers.example/${id}.jpg`,
}));
function setup() {
  const audio = new FakeAudio();
  const player = createMusicPlayer(tracks, audio);
  let state!: MusicState;
  player.subscribe(value => { state = value; });
  return { audio, player, state: () => state };
}

test('initial subscription does not request audio and unsubscribe does not stop music', async () => {
  const { audio, player, state } = setup();
  assert.equal(audio.preload, 'none');
  assert.equal(audio.src, '');
  assert.equal(audio.loads, 0);
  assert.equal(audio.plays, 0);
  assert.equal(state().volume, 0.7);
  assert.equal(state().playing, false);
  let calls = 0;
  const unsubscribe = player.subscribe(() => { calls++; });
  assert.equal(calls, 1);
  unsubscribe();
  await player.toggle();
  assert.equal(audio.src, tracks[0].url);
  assert.equal(state().playing, true);
  assert.equal(calls, 1);
});

function prefetchSetup(playlist = tracks) {
  const audio = new FakeAudio();
  const spares: FakeAudio[] = [];
  const covers: string[] = [];
  let allowed = true;
  const player = createMusicPlayer(playlist, audio, {
    createAudio() { const spare = new FakeAudio(); spares.push(spare); return spare; },
    loadCover(url) { covers.push(url); return { image: {}, ready: Promise.resolve() }; },
    canPreload: () => allowed,
  });
  let state!: MusicState;
  player.subscribe(value => { state = value; });
  function nearEnd(target = audio, time = 105, duration = 120) {
    target.currentTime = time;
    target.duration = duration;
    target.fire('durationchange');
    target.fire('timeupdate');
  }
  return { audio, player, spares, covers, nearEnd, state: () => state, allow(value: boolean) { allowed = value; } };
}

test('first preload prepares audio and cover once without playback; play reuses it', async () => {
  const { audio, player, covers, state } = prefetchSetup();
  player.preloadFirstTrack();
  player.preloadFirstTrack();
  audio.fire('waiting');
  assert.equal(audio.loads, 1);
  assert.equal(audio.plays, 0);
  assert.equal(audio.preload, 'auto');
  assert.deepEqual(covers, [tracks[0].cover]);
  assert.equal(state().playing, false);
  assert.equal(state().loading, false);
  await player.toggle();
  assert.equal(audio.loads, 1);
  assert.equal(audio.plays, 1);
  assert.deepEqual(covers, [tracks[0].cover]);
});

test('background first-track failure stays quiet and explicit play reloads; user selection wins', async () => {
  const first = prefetchSetup();
  first.player.preloadFirstTrack();
  first.audio.error = { code: 2 };
  first.audio.fire('error');
  assert.equal(first.state().error, null);
  await first.player.toggle();
  assert.equal(first.audio.loads, 2);
  assert.equal(first.state().playing, true);
  const other = prefetchSetup();
  await other.player.select(2);
  other.player.preloadFirstTrack();
  assert.equal(other.audio.src, tracks[2].url);
  assert.equal(other.audio.loads, 1);
  assert.deepEqual(other.covers, [tracks[2].cover]);
});

test('cover failure cannot block current playback or overwrite a later selection', async () => {
  const audio = new FakeAudio();
  let reject!: (reason: Error) => void;
  const player = createMusicPlayer(tracks, audio, {
    loadCover() { return { image: {}, ready: new Promise<void>((_, fail) => { reject = fail; }) }; },
  });
  let state!: MusicState;
  player.subscribe(value => { state = value; });
  player.preloadFirstTrack();
  const rejectFirst = reject;
  await player.select(2);
  rejectFirst(new Error('Old cover failed'));
  await Promise.resolve();
  assert.equal(state.index, 2);
  assert.equal(state.error, null);
  assert.equal(state.playing, true);
});

test('threshold requires finite duration, at least five seconds and at most twenty remaining', async () => {
  const { audio, player, spares, nearEnd, covers, state } = prefetchSetup();
  await player.toggle();
  nearEnd(audio, 99);
  nearEnd(audio, 4, 15);
  nearEnd(audio, 5, NaN);
  nearEnd(audio, 5, Infinity);
  nearEnd(audio, 5, 0);
  nearEnd(audio, NaN);
  nearEnd(audio, Infinity);
  assert.equal(spares.length, 0);
  nearEnd(audio, 100);
  nearEnd(audio, 110);
  assert.equal(spares.length, 1);
  assert.equal(spares[0].loads, 1);
  assert.equal(spares[0].plays, 0);
  assert.equal(audio.src, tracks[0].url);
  assert.equal(audio.currentTime, 110);
  assert.equal(state().playing, true);
  assert.deepEqual(covers, [tracks[0].cover, tracks[1].cover]);
});

test('paused, hidden/saveData and suspended conditions skip automatic loads; user actions work', async () => {
  const p = prefetchSetup();
  p.allow(false);
  p.player.preloadFirstTrack();
  assert.equal(p.audio.loads, 0);
  await p.player.toggle();
  p.nearEnd();
  assert.equal(p.spares.length, 0);
  await p.player.toggle();
  p.allow(true);
  p.nearEnd();
  assert.equal(p.spares.length, 0);
  p.player.suspendBackground();
  await p.player.toggle();
  p.nearEnd();
  assert.equal(p.spares.length, 0);
  p.player.resumeBackground();
  assert.equal(p.spares.length, 1);
  p.player.suspendBackground();
  assert.equal(p.audio.paused, false);
  assert.equal(p.spares[0].src, '');
  assert.equal(p.spares[0].paused, true);
});

test('manual next promotes an unfinished spare without another load and ignores old audio events', async () => {
  const p = prefetchSetup();
  await p.player.toggle();
  p.nearEnd();
  const spare = p.spares[0];
  spare.fire('waiting');
  spare.currentTime = 70;
  spare.fire('timeupdate');
  assert.equal(p.state().currentTime, 105);
  assert.equal(p.state().loading, false);
  spare.currentTime = 0;
  await p.player.next();
  assert.equal(spare.loads, 1);
  assert.equal(spare.plays, 1);
  assert.equal(p.audio.src, '');
  assert.equal(p.audio.paused, true);
  p.audio.error = { code: 2 };
  p.audio.fire('error');
  p.audio.fire('playing');
  assert.equal(p.state().index, 1);
  assert.equal(p.state().playing, true);
  assert.equal(p.state().error, null);
});

test('ended promotes list-wrap candidate and each promoted track can prepare just one successor', async () => {
  const p = prefetchSetup();
  await p.player.select(2);
  p.nearEnd();
  const spare = p.spares[0];
  assert.equal(spare.src, tracks[0].url);
  p.audio.fire('ended');
  await Promise.resolve();
  assert.equal(p.state().index, 0);
  assert.equal(spare.loads, 1);
  assert.equal(spare.plays, 1);
  assert.equal(p.audio.paused, true);
  p.nearEnd(spare);
  p.nearEnd(spare);
  assert.equal(p.spares.length, 2);
  assert.equal(p.spares.filter(item => !item.paused).length, 1);
});

test('random candidate is drawn once and consumed unchanged by manual next and ended', async () => {
  const original = Math.random;
  try {
    for (const ended of [false, true]) {
      let draws = 0;
      Math.random = () => { draws++; return draws === 1 ? 0.9 : 0; };
      const p = prefetchSetup();
      p.player.cycleMode();
      p.player.cycleMode();
      await p.player.toggle();
      p.nearEnd();
      p.nearEnd();
      assert.equal(draws, 1);
      assert.equal(p.spares[0].src, tracks[2].url);
      if (ended) { p.audio.fire('ended'); await Promise.resolve(); }
      else await p.player.next();
      assert.equal(draws, 1);
      assert.equal(p.state().index, 2);
      assert.equal(p.spares[0].plays, 1);
    }
  } finally { Math.random = original; }
});

test('single-track and one mode loop by reusing the current audio', async () => {
  for (const single of [false, true]) {
    const p = prefetchSetup(single ? tracks.slice(0, 1) : tracks);
    if (!single) p.player.cycleMode();
    await p.player.toggle();
    p.nearEnd();
    assert.equal(p.spares.length, 0);
    p.audio.fire('ended');
    await Promise.resolve();
    assert.equal(p.audio.loads, 1);
    assert.equal(p.audio.plays, 2);
    assert.equal(p.audio.currentTime, 0);
    assert.equal(p.state().currentTime, 0);
  }
});

test('selection, previous and mode change discard standby and its late events', async () => {
  for (const operation of ['select', 'previous', 'mode'] as const) {
    const p = prefetchSetup();
    await p.player.toggle();
    p.nearEnd();
    const old = p.spares[0];
    if (operation === 'select') await p.player.select(2);
    else if (operation === 'previous') await p.player.previous();
    else p.player.cycleMode();
    old.error = { code: 2 };
    old.fire('error');
    old.fire('playing');
    old.fire('timeupdate');
    assert.equal(old.src, '');
    assert.equal(old.paused, true);
    assert.equal(p.state().playing, true);
    assert.equal(p.state().error, null);
  }
});

test('standby error is quiet, never retries automatically, and promotion allows explicit retry', async () => {
  const p = prefetchSetup();
  await p.player.toggle();
  p.nearEnd();
  const spare = p.spares[0];
  spare.error = { code: 2 };
  spare.fire('error');
  p.nearEnd();
  assert.equal(spare.loads, 1);
  assert.equal(p.state().error, null);
  assert.equal(p.state().playing, true);
  await p.player.next();
  assert.equal(spare.loads, 2);
  spare.error = { code: 2 };
  spare.fire('error');
  assert.ok(p.state().error);
  await p.player.retry();
  assert.equal(spare.loads, 3);
  assert.equal(p.state().error, null);
});

test('pause and resume preserve a fixed candidate; no repeated preparation after invalidation', async () => {
  const p = prefetchSetup();
  await p.player.toggle();
  p.nearEnd();
  await p.player.toggle();
  await p.player.toggle();
  assert.equal(p.spares[0].src, tracks[1].url);
  assert.equal(p.spares[0].loads, 1);
  p.player.cycleMode();
  p.player.cycleMode();
  p.player.cycleMode();
  p.nearEnd();
  assert.equal(p.spares.length, 1);
});

test('selecting the prepared candidate also promotes its existing resource', async () => {
  const p = prefetchSetup();
  await p.player.toggle();
  p.nearEnd();
  await p.player.select(1);
  assert.equal(p.spares[0].loads, 1);
  assert.equal(p.spares[0].plays, 1);
  assert.equal(p.audio.paused, true);
  assert.deepEqual(p.covers, [tracks[0].cover, tracks[1].cover]);
});

test('default visibility and saveData gates recheck on restoration and detach on suspend', async () => {
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const page = Object.assign(new EventTarget(), { visibilityState: 'hidden' });
  const connection = Object.assign(new EventTarget(), { saveData: false });
  const audio = new FakeAudio();
  const spares: FakeAudio[] = [];
  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: page });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { connection } });
    const player = createMusicPlayer(tracks, audio, {
      createAudio() { const spare = new FakeAudio(); spares.push(spare); return spare; },
    });
    player.preloadFirstTrack();
    assert.equal(audio.loads, 0);
    page.visibilityState = 'visible';
    connection.saveData = true;
    player.preloadFirstTrack();
    assert.equal(audio.loads, 0);
    await player.toggle();
    audio.duration = 120;
    audio.currentTime = 105;
    audio.fire('timeupdate');
    assert.equal(spares.length, 0);
    connection.saveData = false;
    page.visibilityState = 'hidden';
    connection.dispatchEvent(new Event('change'));
    assert.equal(spares.length, 0);
    page.visibilityState = 'visible';
    page.dispatchEvent(new Event('visibilitychange'));
    assert.equal(spares.length, 1);
    player.suspendBackground();
    connection.dispatchEvent(new Event('change'));
    page.dispatchEvent(new Event('visibilitychange'));
    assert.equal(spares.length, 1);
    assert.equal(audio.paused, false);
  } finally {
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
    else Reflect.deleteProperty(globalThis, 'document');
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});

test('late successful play of a retired audio cannot leave two elements playing', async () => {
  const p = prefetchSetup();
  let resolve!: () => void;
  p.audio.playImpl = () => new Promise<void>(done => { resolve = done; });
  const pending = p.player.toggle();
  p.audio.paused = false;
  p.audio.fire('playing');
  p.nearEnd();
  await p.player.next();
  p.audio.paused = false;
  resolve();
  await pending;
  assert.equal(p.audio.paused, true);
  assert.equal(p.spares[0].paused, false);
  assert.equal(p.state().index, 1);
  assert.equal(p.state().playing, true);
});

test('cancelled play promise resolving successfully remains paused even before a playing event', async () => {
  const p = prefetchSetup();
  let resolve!: () => void;
  p.audio.playImpl = () => new Promise<void>(done => { resolve = done; });
  const pending = p.player.toggle();
  await p.player.toggle();
  p.audio.paused = false;
  resolve();
  await pending;
  assert.equal(p.audio.paused, true);
  assert.equal(p.state().playing, false);
  assert.equal(p.state().loading, false);
});

test('actual audio events determine playing, loading and progress', async () => {
  const { audio, player, state } = setup();
  audio.playImpl = () => Promise.resolve();
  await player.toggle();
  assert.equal(state().playing, false);
  audio.fire('playing');
  assert.equal(state().playing, true);
  audio.fire('waiting');
  assert.equal(state().loading, true);
  audio.fire('canplay');
  assert.equal(state().loading, false);
  audio.duration = 120;
  audio.fire('durationchange');
  player.seek(999);
  assert.equal(audio.currentTime, 120);
  audio.currentTime = 15;
  audio.fire('timeupdate');
  assert.equal(state().currentTime, 15);
  audio.pause();
  assert.equal(state().playing, false);
});

test('switching tracks discards stale play rejection', async () => {
  const { audio, player, state } = setup();
  let reject!: (reason: Error) => void;
  audio.playImpl = () => new Promise<void>((_, fail) => { reject = fail; });
  const first = player.toggle();
  audio.playImpl = undefined;
  await player.select(1);
  reject(new Error('old load failed'));
  await first;
  assert.equal(state().index, 1);
  assert.equal(state().playing, true);
  assert.equal(state().error, null);
});

test('pausing pending playback cancels its result and late playing event', async () => {
  const { audio, player, state } = setup();
  let resolve!: () => void;
  audio.playImpl = () => new Promise<void>(done => { resolve = done; });
  const pending = player.toggle();
  await player.toggle();
  resolve();
  await pending;
  audio.fire('playing');
  assert.equal(state().playing, false);
  assert.equal(state().loading, false);
  assert.equal(audio.paused, true);
});

test('media error stops without skipping and explicit retry reloads', async () => {
  const { audio, player, state } = setup();
  await player.toggle();
  audio.error = { code: 2 };
  audio.fire('error');
  audio.fire('ended');
  await Promise.resolve();
  assert.equal(state().index, 0);
  assert.equal(audio.plays, 1);
  assert.equal(state().playing, false);
  assert.ok(state().error);
  await player.retry();
  assert.equal(audio.loads, 2);
  assert.equal(state().error, null);
  assert.equal(state().playing, true);
});

test('list wraps, one loops on end, random never immediately repeats', async () => {
  const { audio, player, state } = setup();
  await player.previous();
  assert.equal(state().index, 2);
  await player.next();
  assert.equal(state().index, 0);
  player.cycleMode();
  assert.equal(state().mode, 'one');
  audio.currentTime = 100;
  audio.fire('ended');
  await Promise.resolve();
  assert.equal(state().index, 0);
  assert.equal(state().currentTime, 0);
  player.cycleMode();
  assert.equal(state().mode, 'random');
  for (let i = 0; i < 12; i++) {
    const before = state().index;
    await player.next();
    assert.notEqual(state().index, before);
  }
});

test('invalid selection and empty playlist are inert; volume and seek are bounded', async () => {
  const { audio, player, state } = setup();
  await player.select(-1);
  await player.select(1.5);
  assert.equal(audio.plays, 0);
  player.setVolume(NaN);
  assert.equal(state().volume, 0.7);
  player.setVolume(2);
  assert.equal(state().volume, 1);
  player.seek(20);
  assert.equal(audio.currentTime, 0);
  const emptyAudio = new FakeAudio();
  const empty = createMusicPlayer([], emptyAudio);
  await empty.toggle();
  await empty.next();
  await empty.retry();
  assert.equal(emptyAudio.plays, 0);
});

test('blocked storage is safe; only valid volume and mode restore', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('storage blocked'); },
    });
    const { player, state } = setup();
    player.setVolume(0.25);
    player.cycleMode();
    assert.equal(state().volume, 0.25);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem(key: string) {
          assert.equal(key, 'dcelysion-home:music-preferences:v1');
          return JSON.stringify({ volume: 0, mode: 'random', playing: true });
        },
        setItem() {},
      },
    });
    const restored = setup();
    assert.equal(restored.state().volume, 0);
    assert.equal(restored.state().mode, 'random');
    assert.equal(restored.state().playing, false);
    assert.equal(restored.audio.src, '');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
