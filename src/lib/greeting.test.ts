import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { GreetingClock, greetingAt, type Greeting } from './greeting.ts';

const originalTimezone = process.env.TZ;
const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

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

test('Guangzhou device time ignores a proxy timezone and old IP cache without network', (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval'], now: Date.parse('2026-10-08T11:13:00Z') });
  process.env.TZ = 'Asia/Shanghai';
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response('America/Los_Angeles'); };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => JSON.stringify({ timezone: 'America/Los_Angeles', savedAt: Date.now() }),
  } });
  const updates: Greeting[] = [];
  const clock = new GreetingClock((value) => updates.push(value));
  try {
    clock.start();
    assert.deepEqual(updates.at(-1), { text: '晚上好', time: '19:13', source: 'device' });
    context.mock.timers.tick(60000);
    assert.equal(updates.at(-1)?.time, '19:14');
    assert.equal(requests, 0);
    clock.stop();
    const count = updates.length;
    context.mock.timers.tick(60000); clock.resume();
    assert.equal(updates.length, count);
  } finally { clock.stop(); }
});

test('resume updates immediately and picks up changes to the device timezone', (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval'], now: Date.parse('2026-10-08T11:13:00Z') });
  process.env.TZ = 'Asia/Shanghai';
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('disabled'); } });
  const updates: Greeting[] = [];
  const clock = new GreetingClock((value) => updates.push(value));
  try {
    clock.start();
    context.mock.timers.tick(30000);
    process.env.TZ = 'America/Los_Angeles';
    clock.resume();
    assert.deepEqual(updates.at(-1), { text: '晚上好', time: '04:13', source: 'device' });
    clock.start();
    const count = updates.length;
    context.mock.timers.tick(60000);
    assert.equal(updates.length, count + 1);
  } finally { clock.stop(); }
});
