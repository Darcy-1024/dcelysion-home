export interface Track {
  id: string;
  name: string;
  artist: string;
  url: string;
  cover: string;
  lrc?: string;
}

export type PlayMode = 'list' | 'one' | 'random';
export interface MusicState {
  track: Track | null;
  index: number;
  playing: boolean;
  loading: boolean;
  error: string | null;
  currentTime: number;
  duration: number;
  volume: number;
  mode: PlayMode;
}
export type State = MusicState;

export interface MusicPlayer {
  subscribe(fn: (state: MusicState) => void): () => void;
  toggle(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  select(index: number): Promise<void>;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  cycleMode(): void;
  retry(): Promise<void>;
  preloadFirstTrack(): void;
  suspendBackground(): void;
  resumeBackground(): void;
}

export interface AudioLike {
  src: string;
  preload: string;
  volume: number;
  currentTime: number;
  duration: number;
  paused: boolean;
  error: { code: number; message?: string } | null;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  removeAttribute?(name: string): void;
}

const STORAGE_KEY = 'dcelysion-home:music-preferences:v1';
const MODES: PlayMode[] = ['list', 'one', 'random'];

function preferences(): { volume: number; mode: PlayMode } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return {
      volume: typeof saved?.volume === 'number' && Number.isFinite(saved.volume)
        ? Math.max(0, Math.min(1, saved.volume)) : 0.7,
      mode: MODES.includes(saved?.mode) ? saved.mode : 'list',
    };
  } catch {
    return { volume: 0.7, mode: 'list' };
  }
}

export interface CoverLoad {
  image: unknown;
  ready: Promise<void>;
  status?: 'loading' | 'ready' | 'failed';
}
export interface MusicPlayerOptions {
  createAudio?: () => AudioLike;
  loadCover?: (url: string) => CoverLoad;
  canPreload?: () => boolean;
}

function loadCover(url: string): CoverLoad {
  const image = new Image();
  const ready = new Promise<void>((resolve, reject) => {
    image.onload = () => {
      if (image.decode) void image.decode().then(resolve, reject);
      else resolve();
    };
    image.onerror = () => reject(new Error('Cover unavailable'));
    image.src = url;
  });
  return { image, ready };
}

/** Construction does not request media; automatic loading has an explicit entry point. */
export function createMusicPlayer(
  tracks: Track[], initialAudio: AudioLike = new Audio(), options: MusicPlayerOptions = {},
): MusicPlayer {
  let audio = initialAudio;
  const playlist = tracks.map(track => ({ ...track }));
  const saved = preferences();
  let state: MusicState = {
    track: playlist[0] ?? null, index: playlist.length ? 0 : -1,
    playing: false, loading: false, error: null, currentTime: 0, duration: 0,
    ...saved,
  };
  const subscribers = new Set<(state: MusicState) => void>();
  let generation = 0;
  let requested = false;
  let loadedIndex = -1;
  let userRequested = false;
  let firstAttempted = false;
  let backgroundEnabled = true;
  let cycleAttempted = false;
  let backgroundFailed = false;
  let candidateVersion = 0;
  let currentCover: { index: number; resource?: CoverLoad } | undefined;
  let candidate: { index: number; audio: AudioLike; failed: boolean; cover?: CoverLoad; cleanup: () => void } | undefined;
  let unbindCurrent = () => {};
  let unbindEnvironment = () => {};
  audio.preload = 'none';
  audio.volume = state.volume;

  function snapshot(): MusicState {
    return { ...state, track: state.track ? { ...state.track } : null };
  }
  function update(patch: Partial<MusicState>) {
    state = { ...state, ...patch };
    for (const fn of subscribers) fn(snapshot());
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: state.volume, mode: state.mode }));
    } catch { /* Playback also works when browser storage is unavailable. */ }
  }
  function fail(message: string) {
    requested = false;
    audio.pause();
    update({ playing: false, loading: false, error: message });
  }

  function canPreload() {
    if (!backgroundEnabled) return false;
    if (options.canPreload) return options.canPreload();
    const connection = typeof navigator !== 'undefined'
      ? (navigator as Navigator & { connection?: { saveData?: boolean } }).connection : undefined;
    return (typeof document === 'undefined' || document.visibilityState === 'visible') && !connection?.saveData;
  }
  function cover(index: number): CoverLoad | undefined {
    if (!playlist[index]?.cover) return undefined;
    try {
      if (!options.loadCover && typeof Image === 'undefined') return undefined;
      const resource: CoverLoad = { ...(options.loadCover ?? loadCover)(playlist[index].cover), status: 'loading' };
      // Keep the image alive; late cover completion never changes track state.
      void resource.ready.then(() => { resource.status = 'ready'; }, () => { resource.status = 'failed'; });
      return resource;
    } catch { return undefined; }
  }
  function ensureCover(index: number) {
    if (currentCover?.index === index) return;
    currentCover = { index, resource: cover(index) };
  }
  function release(target: AudioLike) {
    target.pause();
    if (target.removeAttribute) target.removeAttribute('src');
    else target.src = '';
    target.load();
  }
  function discardCandidate() {
    ++candidateVersion;
    if (candidate) {
      candidate.cleanup();
      release(candidate.audio);
      candidate = undefined;
    }
  }
  function prepareNext() {
    if (!canPreload() || cycleAttempted || !requested || !state.playing || audio.paused
      || state.mode === 'one' || playlist.length <= 1 || !Number.isFinite(audio.duration)
      || audio.duration <= 0 || !Number.isFinite(audio.currentTime)
      || audio.currentTime < 5 || audio.duration - audio.currentTime > 20) return;
    cycleAttempted = true;
    const index = adjacent(1);
    const version = ++candidateVersion;
    let spare: AudioLike;
    try { spare = options.createAudio ? options.createAudio() : new Audio(); }
    catch { return; }
    spare.preload = 'auto';
    spare.volume = state.volume;
    const prepared = { index, audio: spare, failed: false, cover: cover(index), cleanup: () => {} };
    const onError: EventListener = () => {
      if (candidate === prepared && version === candidateVersion) prepared.failed = true;
    };
    spare.addEventListener('error', onError);
    prepared.cleanup = () => spare.removeEventListener('error', onError);
    candidate = prepared;
    try { spare.src = playlist[index].url; spare.load(); }
    catch { prepared.failed = true; }
  }

  async function start(index: number, reload = false, ended = false): Promise<void> {
    if (!Number.isInteger(index) || index < 0 || index >= playlist.length) return;
    const version = ++generation;
    userRequested = true;
    requested = false;
    unbindCurrent();
    audio.pause();
    const prepared = candidate?.index === index && !reload ? candidate : undefined;
    if (prepared) {
      prepared.cleanup();
      candidate = undefined;
      ++candidateVersion;
      release(audio);
      audio = prepared.audio;
      loadedIndex = index;
      backgroundFailed = prepared.failed;
      currentCover = { index, resource: prepared.cover };
    } else if (loadedIndex !== index || reload || ended) discardCandidate();
    const changed = loadedIndex !== index || reload || !!audio.error || backgroundFailed;
    const newCycle = changed || !!prepared || ended;
    if (newCycle) cycleAttempted = false;
    backgroundFailed = false;
    update({
      track: playlist[index], index, playing: false, loading: true, error: null,
      ...(newCycle ? { currentTime: 0, duration: prepared && Number.isFinite(audio.duration) ? Math.max(0, audio.duration) : 0 } : {}),
    });
    requested = true;
    audio.volume = state.volume;
    bindCurrent();
    ensureCover(index);
    if (changed) {
      loadedIndex = index;
      audio.preload = 'auto';
      audio.src = playlist[index].url;
      audio.load();
    } else if (ended) {
      try { audio.currentTime = 0; } catch { /* Media may not yet be seekable. */ }
    }
    const playingAudio = audio;
    try {
      await playingAudio.play();
      // Actual playing/pause events own the playback indicator. A superseded
      // promise must never replace the state of a newer user request.
      if (version !== generation) {
        if (playingAudio !== audio || !requested) playingAudio.pause();
        return;
      }
    } catch (error) {
      if (version !== generation) return;
      const name = error instanceof Error ? error.name : '';
      fail(name === 'NotAllowedError'
        ? '浏览器阻止了播放，请再次点击播放。'
        : '音频暂时无法播放，请重试。');
    }
  }

  function adjacent(direction: 1 | -1): number {
    if (playlist.length <= 1) return state.index;
    if (state.mode === 'random') {
      return (state.index + 1 + Math.floor(Math.random() * (playlist.length - 1))) % playlist.length;
    }
    return (state.index + direction + playlist.length) % playlist.length;
  }

  function bindCurrent() {
    unbindCurrent();
    const target = audio;
    const version = generation;
    const listeners: [string, EventListener][] = [];
    const on = (name: string, fn: () => void) => {
      const handler: EventListener = () => { if (target === audio && version === generation) fn(); };
      target.addEventListener(name, handler);
      listeners.push([name, handler]);
    };
    on('playing', () => {
      if (!requested || state.error) { target.pause(); return; }
      update({ playing: true, loading: false, error: null });
      prepareNext();
    });
    on('pause', () => update({ playing: false }));
    on('waiting', () => { if (requested && !state.error) update({ loading: true }); });
    on('canplay', () => { if (!state.error) update({ loading: false }); });
    on('timeupdate', () => {
      update({ currentTime: Number.isFinite(target.currentTime) ? target.currentTime : 0 });
      prepareNext();
    });
    on('durationchange', () => {
      update({ duration: Number.isFinite(target.duration) ? Math.max(0, target.duration) : 0 });
    });
    on('error', () => {
      if (loadedIndex < 0 || !target.error) return;
      if (!userRequested) { backgroundFailed = true; update({ loading: false }); }
      else fail('音频加载失败，请重试或选择其他歌曲。');
    });
    on('ended', () => {
      if (!requested || state.error) return;
      const index = state.mode === 'one' ? state.index : candidate?.index ?? adjacent(1);
      void start(index, false, true);
    });
    unbindCurrent = () => { for (const [name, handler] of listeners) target.removeEventListener(name, handler); };
  }
  function bindEnvironment() {
    unbindEnvironment();
    const recheck = () => prepareNext();
    const connection = typeof navigator !== 'undefined'
      ? (navigator as Navigator & { connection?: EventTarget }).connection : undefined;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', recheck);
    connection?.addEventListener('change', recheck);
    unbindEnvironment = () => {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', recheck);
      connection?.removeEventListener('change', recheck);
    };
  }
  bindCurrent();
  bindEnvironment();

  return {
    subscribe(fn) {
      subscribers.add(fn);
      fn(snapshot());
      return () => { subscribers.delete(fn); };
    },
    preloadFirstTrack() {
      if (firstAttempted || userRequested || loadedIndex >= 0 || !playlist.length || !canPreload()) return;
      firstAttempted = true;
      loadedIndex = 0;
      audio.preload = 'auto';
      ensureCover(0);
      try { audio.src = playlist[0].url; audio.load(); }
      catch { backgroundFailed = true; }
    },
    suspendBackground() { backgroundEnabled = false; unbindEnvironment(); discardCandidate(); },
    resumeBackground() { backgroundEnabled = true; bindEnvironment(); prepareNext(); },
    async toggle() {
      if (state.playing || state.loading) {
        ++generation;
        requested = false;
        audio.pause();
        bindCurrent();
        update({ playing: false, loading: false });
      } else {
        await start(state.index, !!state.error);
      }
    },
    next: () => start(candidate?.index ?? adjacent(1)),
    previous() { const index = adjacent(-1); discardCandidate(); return start(index); },
    select(index) {
      if (!Number.isInteger(index) || index < 0 || index >= playlist.length) return Promise.resolve();
      return start(index);
    },
    seek(seconds) {
      if (!Number.isFinite(seconds) || loadedIndex < 0 || state.duration <= 0) return;
      const time = Math.max(0, Math.min(state.duration, seconds));
      try { audio.currentTime = time; update({ currentTime: time }); } catch { /* Not seekable yet. */ }
    },
    setVolume(volume) {
      if (!Number.isFinite(volume)) return;
      const value = Math.max(0, Math.min(1, volume));
      audio.volume = value;
      if (candidate) candidate.audio.volume = value;
      update({ volume: value });
      save();
    },
    cycleMode() {
      discardCandidate();
      update({ mode: MODES[(MODES.indexOf(state.mode) + 1) % MODES.length] });
      save();
    },
    retry: () => start(state.index, true),
  };
}

let singleton: MusicPlayer | undefined;
/** One persistent player owns a current audio and at most one spare, independent of panel visibility. */
export function getMusicPlayer(tracks: Track[]): MusicPlayer {
  return singleton ??= createMusicPlayer(tracks);
}

