// This switch is deliberately independent of media routing and entry visibility.
export const BLOG_ROUTE_ENABLED = true;
export const BLOG_ROUTE_KEY = 'dcelysion.blog-route.v1';
export const BLOG_ROUTE_VERSION = 'probe-v1-32k-policy-v1';
export const BLOG_ORIGINS = {
  cloudflare: 'https://blog.dcelysion.cn',
  edgeone: 'https://blog-eo.dcelysion.cn',
} as const;
export const PROBE_PATH = '/__route/probe-v1.bin';
export const PROBE_BYTES = 32768;
export const PROBE_SHA256 = '9ab5674dfb044ce308d393fc756a895a5808b8651dc9b5c6c506886369559d26';
export type BlogSource = keyof typeof BLOG_ORIGINS;
export type BlogMode = 'auto' | 'manual';
export interface BlogRouteState {
  version: typeof BLOG_ROUTE_VERSION;
  mode: BlogMode;
  source: BlogSource;
  automaticSource: BlogSource;
  status: 'pending' | 'ready';
  measured: boolean;
}
export interface ProbeResult { source: BlogSource; elapsed: number }
interface Dependencies {
  fetch: typeof fetch;
  now: () => number;
  digest: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>;
  storage: () => Pick<Storage, 'getItem' | 'setItem'>;
  timeoutMs: number;
}
const initialState = (): BlogRouteState => ({ version: BLOG_ROUTE_VERSION, mode: 'auto', source: 'cloudflare', automaticSource: 'cloudflare', status: 'ready', measured: false });
const isSource = (value: unknown): value is BlogSource => value === 'cloudflare' || value === 'edgeone';
export function blogHref(source: BlogSource): string { return `${BLOG_ORIGINS[source]}/`; }
export function chooseBlogSource(cf?: ProbeResult, eo?: ProbeResult): BlogSource {
  if (!cf) return eo ? 'edgeone' : 'cloudflare';
  return eo && eo.elapsed <= cf.elapsed * 0.8 ? 'edgeone' : 'cloudflare';
}
const defaults: Dependencies = {
  fetch: (...args) => globalThis.fetch(...args),
  now: () => performance.now(),
  digest: async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join(''),
  storage: () => sessionStorage,
  timeoutMs: 2500,
};
// Also bounds injected/failed transports that do not settle on abort.
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Probe cancelled'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
async function probe(source: BlogSource, controller: AbortController, started: number, deadline: number, deps: Dependencies, bodyDone: () => void): Promise<ProbeResult> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let complete = false;
  try {
    const response = await abortable(deps.fetch(`${BLOG_ORIGINS[source]}${PROBE_PATH}`, {
      method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
    }), controller.signal);
    reader = response.body?.getReader();
    if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/octet-stream') throw new Error('Invalid probe response');
    const length = response.headers.get('content-length');
    const encoding = response.headers.get('content-encoding');
    if ((length !== null && length !== String(PROBE_BYTES)) || (encoding && encoding.toLowerCase() !== 'identity') || !response.body) throw new Error('Invalid probe body');
    if (!reader) throw new Error('Missing probe stream');
    const bytes = new Uint8Array(PROBE_BYTES);
    let size = 0;
    for (;;) {
      const { done, value } = await abortable(reader.read(), controller.signal);
      if (done) break;
      if (size + value.byteLength > PROBE_BYTES) throw new Error('Oversized probe');
      bytes.set(value, size); size += value.byteLength;
    }
    const finished = deps.now(); // Includes stream EOF, excludes SHA-256 work.
    if (size !== PROBE_BYTES || finished > deadline || controller.signal.aborted) throw new Error('Incomplete or late probe');
    complete = true;
    bodyDone(); // Shared deadline cancels only bodies still pending, never completed bodies.
    if (await deps.digest(bytes) !== PROBE_SHA256) throw new Error('Probe hash mismatch');
    return { source, elapsed: Math.max(0, finished - started) };
  } finally {
    bodyDone();
    if (!complete) { controller.abort(); void reader?.cancel().catch(() => {}); }
    else reader?.releaseLock();
  }
}

export class BlogRouter {
  private deps: Dependencies;
  private state = initialState();
  private loaded = false;
  private attempted = false;
  private listeners = new Set<(state: BlogRouteState) => void>();
  private generation = 0;
  private cancelRound: (() => void) | undefined;
  private scheduled: ReturnType<typeof setTimeout> | undefined;
  constructor(private enabled = false, deps: Partial<Dependencies> = {}) { this.deps = { ...defaults, ...deps }; }
  get snapshot(): BlogRouteState { return { ...this.state }; }
  private save() {
    try { this.deps.storage().setItem(BLOG_ROUTE_KEY, JSON.stringify(this.state)); } catch { /* Tab-memory fallback. */ }
    for (const listener of this.listeners) listener(this.snapshot);
  }
  private load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = this.deps.storage().getItem(BLOG_ROUTE_KEY);
      if (!raw) return;
      const value = JSON.parse(raw);
      if (value?.version !== BLOG_ROUTE_VERSION || !isSource(value.source) || !isSource(value.automaticSource) || !['auto', 'manual'].includes(value.mode) || !['pending', 'ready'].includes(value.status) || typeof value.measured !== 'boolean') return;
      this.attempted = true;
      this.state = value.status === 'pending' ? initialState() : { version: BLOG_ROUTE_VERSION, mode: value.mode, source: value.source, automaticSource: value.automaticSource, status: 'ready', measured: value.measured };
      if (value.status === 'pending') this.save();
    } catch { /* Invalid storage is treated as absent. */ }
  }
  mount(listener: (state: BlogRouteState) => void): () => void {
    this.load();
    // Wrap subscriptions so repeated use of the same callback still has separate leases.
    const subscription = (state: BlogRouteState) => listener(state);
    this.listeners.add(subscription); listener(this.snapshot);
    if (this.enabled && !this.attempted && this.scheduled === undefined) {
      this.scheduled = setTimeout(() => { this.scheduled = undefined; void this.retest(); }, 0);
    }
    let disposed = false;
    return () => {
      if (disposed) return; disposed = true;
      this.listeners.delete(subscription);
      if (!this.listeners.size) {
        clearTimeout(this.scheduled); this.scheduled = undefined;
        this.invalidate();
        if (this.state.status === 'pending') { this.state.status = 'ready'; this.save(); }
      }
    };
  }
  private invalidate() { this.generation++; this.cancelRound?.(); this.cancelRound = undefined; }
  select(mode: 'auto' | BlogSource) {
    clearTimeout(this.scheduled); this.scheduled = undefined;
    this.invalidate(); this.attempted = true;
    this.state = { ...this.state, mode: mode === 'auto' ? 'auto' : 'manual', source: mode === 'auto' ? this.state.automaticSource : mode, status: 'ready' };
    this.save();
  }
  async retest(): Promise<void> {
    if (!this.enabled || !this.listeners.size) return;
    clearTimeout(this.scheduled); this.scheduled = undefined;
    this.invalidate(); this.attempted = true;
    const generation = this.generation;
    this.state = { ...initialState(), status: 'pending' }; this.save();
    const started = this.deps.now(), deadline = started + this.deps.timeoutMs;
    const pending = new Set<AbortController>();
    const controllers = [new AbortController(), new AbortController()];
    controllers.forEach(controller => pending.add(controller));
    let finish!: () => void;
    const stopped = new Promise<void>(resolve => { finish = resolve; });
    let closed = false;
    const results: (ProbeResult | undefined)[] = [undefined, undefined];
    const timer = setTimeout(() => { closed = true; for (const controller of pending) controller.abort(); finish(); }, this.deps.timeoutMs);
    this.cancelRound = () => { closed = true; clearTimeout(timer); controllers.forEach(controller => controller.abort()); finish(); };
    const tasks = controllers.map((controller, index) => probe(index === 0 ? 'cloudflare' : 'edgeone', controller, started, deadline, this.deps, () => pending.delete(controller)).then(result => {
      if (!closed && this.deps.now() <= deadline) results[index] = result;
    }, () => {}));
    await Promise.race([Promise.all(tasks), stopped]);
    closed = true;
    clearTimeout(timer);
    if (generation !== this.generation) return;
    this.cancelRound = undefined;
    const [cf, eo] = results;
    const source = chooseBlogSource(cf, eo);
    this.state = { ...initialState(), source, automaticSource: source, measured: !!(cf || eo) }; this.save();
  }
}
let clientRouter: BlogRouter | undefined;
export function getBlogRouter(): BlogRouter {
  // Called only from onMount; no shared server-rendered visitor state.
  return clientRouter ??= new BlogRouter(BLOG_ROUTE_ENABLED);
}
