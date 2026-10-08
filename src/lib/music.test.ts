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
  id, name: id, artist: 'Artist', url: `https://audio.example/${id}.mp3`, cover: '',
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
