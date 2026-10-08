import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { GreetingClock, greetingAt, validTimezone, fetchIpTimezone, readTimezoneCache, writeTimezoneCache, TIMEZONE_CACHE_KEY, TIMEZONE_CACHE_TTL, type Greeting } from './greeting.ts';

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});
function storage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  return values;
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('all six greeting ranges include exact minute boundaries and midnight', () => {
  for (const [time, text] of [
    ['04:59', '晚上好'], ['05:00', '早上好'], ['08:59', '早上好'], ['09:00', '上午好'],
    ['10:59', '上午好'], ['11:00', '中午好'], ['12:59', '中午好'], ['13:00', '下午好'],
    ['16:59', '下午好'], ['17:00', '傍晚好'], ['18:59', '傍晚好'], ['19:00', '晚上好'],
    ['23:59', '晚上好'], ['00:00', '晚上好'],
  ]) assert.deepEqual(greetingAt(new Date(`2026-10-08T${time}:00Z`), 'UTC'), { time, text });
});

test('one instant uses each timezone and summer time rules, including DST jumps', () => {
  const date = new Date('2026-10-08T05:00:00Z');
  assert.deepEqual(greetingAt(date, 'Asia/Shanghai'), { time: '13:00', text: '下午好' });
  assert.deepEqual(greetingAt(date, 'America/Los_Angeles'), { time: '22:00', text: '晚上好' });
  assert.equal(greetingAt(new Date('2026-01-08T17:00:00Z'), 'America/New_York').time, '12:00');
  assert.equal(greetingAt(new Date('2026-07-08T17:00:00Z'), 'America/New_York').time, '13:00');
  assert.equal(greetingAt(new Date('2026-03-08T06:59:00Z'), 'America/New_York').time, '01:59');
  assert.equal(greetingAt(new Date('2026-03-08T07:00:00Z'), 'America/New_York').time, '03:00');
  assert.equal(greetingAt(new Date('2026-11-01T06:00:00Z'), 'America/New_York').time, '01:00');
});

test('timezone endpoint requests only timezone and validates plain text and errors', async () => {
  globalThis.fetch = async (input) => { assert.equal(input, 'https://ipapi.co/timezone/'); return new Response('Asia/Shanghai\n'); };
  assert.equal(await fetchIpTimezone(), 'Asia/Shanghai');
  for (const invalid of ['', 'not-a-zone', '{"error":true}', 'GMT+8']) {
    globalThis.fetch = async () => new Response(invalid);
    await assert.rejects(fetchIpTimezone(), /时区数据格式异常/);
  }
  globalThis.fetch = async () => new Response('', { status: 429 });
  await assert.rejects(fetchIpTimezone(), /时区服务暂时不可用/);
  assert.equal(validTimezone(null), false);
});

test('cache expires after thirty minutes, rejects corrupt or future entries, stores no IP', () => {
  const values = storage();
  writeTimezoneCache('Asia/Shanghai', 1000);
  assert.deepEqual(JSON.parse(values.get(TIMEZONE_CACHE_KEY)!), { timezone: 'Asia/Shanghai', savedAt: 1000 });
  assert.equal(readTimezoneCache(1000 + TIMEZONE_CACHE_TTL - 1)?.timezone, 'Asia/Shanghai');
  assert.equal(readTimezoneCache(1000 + TIMEZONE_CACHE_TTL), null);
  assert.equal(readTimezoneCache(999), null);
  for (const value of ['broken', '{}', '{"timezone":"bad","savedAt":1000}', '{"timezone":"UTC","savedAt":"1000"}']) {
    values.set(TIMEZONE_CACHE_KEY, value); assert.equal(readTimezoneCache(1001), null);
  }
});

test('disabled storage still permits fetching and harmless cache calls', async () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('disabled'); } });
  assert.equal(readTimezoneCache(), null);
  assert.doesNotThrow(() => writeTimezoneCache('UTC'));
  globalThis.fetch = async () => new Response('UTC');
  assert.equal(await fetchIpTimezone(), 'UTC');
});

function abortingFetch(): typeof fetch {
  return async (_input, options) => new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (options?.signal?.aborted) abort();
    else options?.signal?.addEventListener('abort', abort, { once: true });
  });
}

test('timeout and external cancellation abort pending requests', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.fetch = abortingFetch();
  const pending = assert.rejects(fetchIpTimezone(), /Aborted/);
  context.mock.timers.tick(8000); await pending;
  const controller = new AbortController();
  const canceled = assert.rejects(fetchIpTimezone(controller.signal), /Aborted/);
  controller.abort(); await canceled;
  await assert.rejects(fetchIpTimezone(controller.signal), /Aborted/);
});

test('clock updates each minute without network, refreshes expired cache on resume, prevents concurrent requests', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: 10_000_000 });
  storage(); writeTimezoneCache('UTC');
  let requests = 0;
  let resolve!: (value: Response) => void;
  globalThis.fetch = async () => { requests++; return new Promise((done) => { resolve = done; }); };
  const updates: Greeting[] = [];
  const clock = new GreetingClock((value) => updates.push(value));
  clock.start(); await settle(); assert.equal(requests, 0);
  context.mock.timers.tick(TIMEZONE_CACHE_TTL); assert.equal(requests, 0);
  assert.ok(updates.length >= 31);
  clock.resume(); clock.resume(); assert.equal(requests, 1);
  resolve(new Response('Asia/Shanghai')); await settle();
  assert.equal(updates.at(-1)?.source, 'ip');
  assert.deepEqual(updates.at(-1), { ...greetingAt(new Date(), 'Asia/Shanghai'), source: 'ip' });
  clock.stop();
  const count = updates.length;
  context.mock.timers.tick(60000); clock.resume(); assert.equal(updates.length, count);
});

test('failed fetch uses device time; stopping ignores even a late response', async () => {
  storage();
  globalThis.fetch = async () => { throw new TypeError('network'); };
  const updates: Greeting[] = [];
  const clock = new GreetingClock((value) => updates.push(value));
  clock.start(); await settle();
  assert.deepEqual(updates.at(-1), { ...greetingAt(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone), source: 'device' });
  clock.stop();
  let resolve!: (value: Response) => void;
  globalThis.fetch = async () => new Promise((done) => { resolve = done; });
  const lateUpdates: Greeting[] = [];
  const canceledClock = new GreetingClock((value) => lateUpdates.push(value));
  canceledClock.start(); canceledClock.stop();
  resolve(new Response('Asia/Shanghai')); await settle();
  assert.equal(lateUpdates.length, 1);
  assert.equal(readTimezoneCache(), null);
});

test('expired IP cache falls back to device time after a failed visibility refresh', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: 10_000_000 });
  storage(); writeTimezoneCache('America/New_York');
  globalThis.fetch = async () => { throw new TypeError('network'); };
  const updates: Greeting[] = [];
  const clock = new GreetingClock((value) => updates.push(value));
  clock.start();
  assert.equal(updates.at(-1)?.source, 'ip');
  context.mock.timers.tick(TIMEZONE_CACHE_TTL);
  clock.resume(); await settle();
  assert.deepEqual(updates.at(-1), { ...greetingAt(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone), source: 'device' });
  clock.stop();
});
