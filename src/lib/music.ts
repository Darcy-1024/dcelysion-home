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

/** Creates a player without assigning an audio URL or starting playback. */
export function createMusicPlayer(tracks: Track[], audio: AudioLike = new Audio()): MusicPlayer {
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

  async function start(index: number, reload = false): Promise<void> {
    if (!Number.isInteger(index) || index < 0 || index >= playlist.length) return;
    const version = ++generation;
    requested = false;
    audio.pause();
    const changed = loadedIndex !== index || reload || !!audio.error;
    update({
      track: playlist[index], index, playing: false, loading: true, error: null,
      ...(changed ? { currentTime: 0, duration: 0 } : {}),
    });
    requested = true;
    if (changed) {
      loadedIndex = index;
      audio.src = playlist[index].url;
      audio.load();
    }
    try {
      await audio.play();
      // Actual playing/pause events own the playback indicator. A superseded
      // promise must never replace the state of a newer user request.
      if (version !== generation) return;
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

  audio.addEventListener('playing', () => {
    if (!requested || state.error) { audio.pause(); return; }
    update({ playing: true, loading: false, error: null });
  });
  audio.addEventListener('pause', () => update({ playing: false }));
  audio.addEventListener('waiting', () => {
    if (requested && !state.error) update({ loading: true });
  });
  audio.addEventListener('canplay', () => {
    if (!state.error) update({ loading: false });
  });
  audio.addEventListener('timeupdate', () => {
    update({ currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0 });
  });
  audio.addEventListener('durationchange', () => {
    update({ duration: Number.isFinite(audio.duration) ? Math.max(0, audio.duration) : 0 });
  });
  audio.addEventListener('error', () => {
    // Stop on failure; only an explicit user retry or selection starts again.
    if (loadedIndex >= 0 && audio.error) fail('音频加载失败，请重试或选择其他歌曲。');
  });
  audio.addEventListener('ended', () => {
    if (!requested || state.error) return;
    void start(state.mode === 'one' ? state.index : adjacent(1), true);
  });

  return {
    subscribe(fn) {
      subscribers.add(fn);
      fn(snapshot());
      return () => { subscribers.delete(fn); };
    },
    async toggle() {
      if (state.playing || state.loading) {
        ++generation;
        requested = false;
        audio.pause();
        update({ playing: false, loading: false });
      } else {
        await start(state.index, !!state.error);
      }
    },
    next: () => start(adjacent(1)),
    previous: () => start(adjacent(-1)),
    select: index => start(index),
    seek(seconds) {
      if (!Number.isFinite(seconds) || loadedIndex < 0 || state.duration <= 0) return;
      const time = Math.max(0, Math.min(state.duration, seconds));
      try { audio.currentTime = time; update({ currentTime: time }); } catch { /* Not seekable yet. */ }
    },
    setVolume(volume) {
      if (!Number.isFinite(volume)) return;
      const value = Math.max(0, Math.min(1, volume));
      audio.volume = value;
      update({ volume: value });
      save();
    },
    cycleMode() {
      update({ mode: MODES[(MODES.indexOf(state.mode) + 1) % MODES.length] });
      save();
    },
    retry: () => start(state.index, true),
  };
}

let singleton: MusicPlayer | undefined;
/** The browser owns one persistent audio instance, independent of panel visibility. */
export function getMusicPlayer(tracks: Track[]): MusicPlayer {
  return singleton ??= createMusicPlayer(tracks);
}

