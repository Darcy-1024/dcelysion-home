import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { BlogRouter, BLOG_ROUTE_KEY, BLOG_ROUTE_VERSION, BLOG_ORIGINS, PROBE_PATH, PROBE_SHA256, blogHref, chooseBlogSource } from './blog-route';

const bytes = new Uint8Array(Buffer.concat(Array.from({ length: 1024 }, (_, counter) => createHash('sha256').update(`dcelysion.blog-route.probe-v1:${counter}`).digest())));
const digest = async (body: Uint8Array) => createHash('sha256').update(body).digest('hex');
const response = (body: Uint8Array = bytes, status = 200, headers: Record<string, string> = {}) => new Response(Uint8Array.from(body), { status, headers: { 'content-type': 'application/octet-stream', ...headers } });
const wait = (ms = 0) => new Promise<void>(resolve => setTimeout(resolve, ms));
function fixture(fetcher: typeof fetch, options: Record<string, unknown> = {}) {
  const stored = new Map<string, string>();
  const storage = () => ({ getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); } });
  const router = new BlogRouter(true, { fetch: fetcher, digest, storage, timeoutMs: 25, ...options });
  return { router, stored, storage };
}
function hanging(): Promise<Response> { return new Promise(() => {}); }

test('probe fixture matches contract; exact 20% boundary and single/zero successes', async () => {
  assert.equal(await digest(bytes), PROBE_SHA256);
  const cf = { source: 'cloudflare' as const, elapsed: 1000 };
  assert.equal(chooseBlogSource(cf, { source: 'edgeone', elapsed: 800 }), 'edgeone');
  assert.equal(chooseBlogSource(cf, { source: 'edgeone', elapsed: 801 }), 'cloudflare');
  assert.equal(chooseBlogSource(undefined, { source: 'edgeone', elapsed: 900 }), 'edgeone');
  assert.equal(chooseBlogSource(cf), 'cloudflare');
  assert.equal(chooseBlogSource(), 'cloudflare');
});
test('request allowlist/options, full-stream time and hash excluded from duration', async () => {
  let clockCalls = 0;
  const calls: { url: string; options?: RequestInit }[] = [];
  const { router } = fixture(async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 100)); controller.enqueue(bytes.slice(100)); controller.close(); } }), { headers: { 'content-type': 'application/octet-stream' } });
  }, { timeoutMs: 250, now: () => [0, 10, 8, 100, 100][clockCalls++] ?? 100, digest });
  const unmount = router.mount(() => {});
  await router.retest();
  assert.equal(router.snapshot.measured, true);
  assert.equal(router.snapshot.source, 'edgeone'); // EOF at 8/10, despite validation finishing at 100.
  assert.deepEqual(calls.map(call => call.url), Object.values(BLOG_ORIGINS).map(origin => origin + PROBE_PATH));
  for (const { options } of calls) {
    assert.equal(options?.method, 'GET'); assert.equal(options?.credentials, 'omit'); assert.equal(options?.redirect, 'error'); assert.equal(options?.cache, 'no-store');
  }
  unmount();
});
test('single success survives peer failure or timeout, including nonsettling transport', async () => {
  for (const success of ['cloudflare', 'edgeone'] as const) {
    for (const timeout of [false, true]) {
      const { router } = fixture(async url => String(url).startsWith(BLOG_ORIGINS[success]) ? response() : timeout ? hanging() : Promise.reject(new Error('offline')));
      const unmount = router.mount(() => {}); await router.retest();
      assert.equal(router.snapshot.source, success); assert.equal(router.snapshot.measured, true); unmount();
    }
  }
});
test('both failures fall back without retry; enabled mount runs exactly once', async () => {
  let calls = 0;
  const { router } = fixture(async () => { calls++; throw new Error('offline'); });
  const unmount = router.mount(() => {}); await wait(10);
  assert.equal(router.snapshot.source, 'cloudflare'); assert.equal(router.snapshot.measured, false);
  unmount(); const unmountAgain = router.mount(() => {}); await wait(10);
  assert.equal(calls, 2); unmountAgain();
});
test('wrong status/MIME/hash/size/length/compression and never-ending body are rejected', async () => {
  const bad = [
    () => response(bytes, 404), () => response(bytes, 200, { 'content-type': 'text/html' }),
    () => response(new Uint8Array(32768)), () => response(bytes.slice(1)),
    () => response(new Uint8Array(32769)), () => response(bytes, 200, { 'content-length': '32769' }),
    () => response(bytes, 200, { 'content-encoding': 'gzip' }),
    () => new Response(new ReadableStream({ start(c) { c.enqueue(bytes); } }), { headers: { 'content-type': 'application/octet-stream' } }),
  ];
  for (const make of bad) {
    const { router } = fixture(async () => make()); const unmount = router.mount(() => {});
    await router.retest(); assert.equal(router.snapshot.measured, false); assert.equal(router.snapshot.source, 'cloudflare'); unmount();
  }
});
test('hard deadline retains verified side and ignores hash completing after deadline', async () => {
  let resolveHash!: (hash: string) => void; let hashes = 0;
  const { router } = fixture(async () => response(), { digest: async () => ++hashes === 1 ? PROBE_SHA256 : new Promise<string>(resolve => { resolveHash = resolve; }) });
  const unmount = router.mount(() => {}); await router.retest();
  assert.equal(router.snapshot.source, 'cloudflare'); assert.equal(router.snapshot.measured, true);
  resolveHash(PROBE_SHA256); await wait(); assert.equal(router.snapshot.source, 'cloudflare'); unmount();
});
test('storage exceptions use tab memory; same callback mounts deduplicate and last unmount aborts', async () => {
  let calls = 0; const signals: AbortSignal[] = [];
  const { router } = fixture(async (_url, init) => { calls++; signals.push(init!.signal!); return hanging(); }, { storage: () => { throw new Error('SecurityError'); } });
  const callback = () => {}; const first = router.mount(callback), second = router.mount(callback);
  await wait(5); assert.equal(calls, 2); first(); assert.equal(signals.some(signal => signal.aborted), false);
  second(); assert.equal(signals.every(signal => signal.aborted), true);
  const third = router.mount(callback); await wait(5); assert.equal(calls, 2); assert.equal(router.snapshot.status, 'ready'); third();
});
test('read works but write quota failure still reuses in-memory result', async () => {
  let calls = 0;
  const { router } = fixture(async () => { calls++; return response(); }, { storage: () => ({ getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } }) });
  const unmount = router.mount(() => {}); await router.retest(); unmount();
  const again = router.mount(() => {}); await wait(5); assert.equal(calls, 2); assert.equal(router.snapshot.measured, true); again();
});
test('old pending refresh consumes attempt; invalid version/source never supplies arbitrary URL', async () => {
  for (const invalid of [false, true]) {
    let calls = 0;
    const { router, stored } = fixture(async () => { calls++; return response(); });
    stored.set(BLOG_ROUTE_KEY, JSON.stringify({ version: invalid ? 'old-version' : BLOG_ROUTE_VERSION, mode: 'auto', source: invalid ? 'https://evil.test' : 'edgeone', automaticSource: 'edgeone', status: 'pending', measured: false }));
    const unmount = router.mount(() => {}); await wait(10);
    assert.equal(calls, invalid ? 2 : 0); if (!invalid) { assert.equal(router.snapshot.source, 'cloudflare'); await router.retest(); assert.equal(calls, 2); }
    assert.ok(Object.values(BLOG_ORIGINS).some(origin => blogHref(router.snapshot.source).startsWith(origin))); unmount();
  }
});
test('manual selection and new round invalidate old hash; auto reuses recommendation', async () => {
  let oldHash!: (hash: string) => void; let hold = true; let calls = 0;
  const { router } = fixture(async () => { calls++; return response(); }, { digest: async () => hold ? new Promise<string>(resolve => { oldHash = resolve; }) : PROBE_SHA256 });
  const unmount = router.mount(() => {}); const old = router.retest(); await wait(1);
  router.select('edgeone'); oldHash(PROBE_SHA256); await old; await wait();
  assert.equal(router.snapshot.mode, 'manual'); assert.equal(router.snapshot.source, 'edgeone');
  router.select('auto'); assert.equal(router.snapshot.source, 'cloudflare'); assert.equal(calls, 2);
  hold = false; await router.retest(); assert.equal(calls, 4); assert.equal(router.snapshot.mode, 'auto'); unmount();
});
test('cancelled round cannot overwrite fresh round or unmounted state', async () => {
  const resolvers: ((value: Response) => void)[] = []; let calls = 0;
  const { router } = fixture(async () => ++calls <= 2 ? new Promise<Response>(resolve => resolvers.push(resolve)) : response());
  const unmount = router.mount(() => {}); const old = router.retest(); await wait(1);
  await router.retest(); const expected = router.snapshot;
  resolvers.forEach(resolve => resolve(response())); await old; await wait(); assert.deepEqual(router.snapshot, expected); unmount();
});
test('production disabled starts no traffic, even explicit retest; href is always CF before results', async () => {
  let calls = 0;
  const router = new BlogRouter(false, { fetch: async () => { calls++; return response(); }, storage: () => { throw new Error('blocked'); } });
  const unmount = router.mount(() => {}); await wait(5); await router.retest();
  assert.equal(calls, 0); assert.equal(blogHref(router.snapshot.source), 'https://blog.dcelysion.cn/'); unmount();
});
