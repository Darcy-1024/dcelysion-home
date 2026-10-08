import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  CACHE_TTL, fetchWeather, readSelectedCity, readWeatherCache,
  saveSelectedCity, weatherSymbol, writeWeatherCache,
} from './weather.ts';

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

const payload = {
  city: '北京', weather: '晴', temperature: 14, humidity: 74,
  wind_direction: '东北风', wind_power: '1级', report_time: '7 分钟前发布',
};
const weather = {
  city: '北京', description: '晴', temperature: 14, humidity: 74,
  windDirection: '东北风', windPower: '1级', updatedAt: '7 分钟前发布',
};
function storage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value) },
  });
  return values;
}

test('parses snake_case and encodes a manually selected city', async () => {
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://uapis.cn');
    assert.equal(url.searchParams.get('city'), '北京 & 海淀');
    assert.ok(options?.signal instanceof AbortSignal);
    return Response.json(payload);
  };
  assert.deepEqual(await fetchWeather(' 北京 & 海淀 '), weather);
});

test('automatic location omits city parameter', async () => {
  globalThis.fetch = async (input) => {
    assert.equal(new URL(String(input)).search, '');
    return Response.json(payload);
  };
  assert.deepEqual(await fetchWeather('  '), weather);
});

test('reports HTTP errors and malformed data in Chinese', async () => {
  globalThis.fetch = async () => new Response('', { status: 503 });
  await assert.rejects(fetchWeather(), /天气服务暂时不可用（503）/);
  for (const invalid of [null, {}, { ...payload, humidity: 101 }, { ...payload, temperature: '14' }, { ...payload, city: '' }]) {
    globalThis.fetch = async () => Response.json(invalid);
    await assert.rejects(fetchWeather(), /天气数据格式异常/);
  }
  globalThis.fetch = async () => new Response('invalid JSON');
  await assert.rejects(fetchWeather(), /天气数据格式异常/);
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(fetchWeather(), /天气加载失败/);
});

function abortingFetch(): typeof fetch {
  return async (_input, options) => new Promise<Response>((_resolve, reject) => {
    const signal = options?.signal;
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

test('timeout aborts fetch after 8 seconds without real waiting', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.fetch = abortingFetch();
  const result = fetchWeather();
  const rejected = assert.rejects(result, /天气请求超时/);
  context.mock.timers.tick(8000);
  await rejected;
});

test('external abort cancels pending and already aborted requests', async () => {
  globalThis.fetch = abortingFetch();
  const controller = new AbortController();
  const result = fetchWeather(undefined, controller.signal);
  controller.abort();
  await assert.rejects(result, /天气请求已取消/);
  await assert.rejects(fetchWeather(undefined, controller.signal), /天气请求已取消/);
});

test('cache separates auto and each manual city and preserves timestamp', () => {
  storage();
  assert.equal(CACHE_TTL, 30 * 60 * 1000);
  writeWeatherCache(undefined, weather);
  writeWeatherCache(' 北京 ', { ...weather, temperature: 20 });
  assert.equal(readWeatherCache()?.data.temperature, 14);
  assert.equal(readWeatherCache('北京')?.data.temperature, 20);
  assert.equal(readWeatherCache('上海'), null);
  assert.ok(readWeatherCache()?.savedAt);
  saveSelectedCity(' 上海 ');
  assert.equal(readSelectedCity(), '上海');
  saveSelectedCity('');
  assert.equal(readSelectedCity(), '');
});

test('invalid cache and unavailable storage are harmless', () => {
  const values = storage();
  writeWeatherCache(undefined, weather);
  const key = [...values.keys()][0];
  values.set(key, 'invalid JSON');
  assert.equal(readWeatherCache(), null);
  values.set(key, JSON.stringify({ data: {}, savedAt: Date.now() }));
  assert.equal(readWeatherCache(), null);
  values.set(key, JSON.stringify({ data: weather, savedAt: Date.now() + 60000 }));
  assert.equal(readWeatherCache(), null);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true, get() { throw new Error('Storage disabled'); },
  });
  assert.equal(readWeatherCache(), null);
  assert.equal(readSelectedCity(), '');
  assert.doesNotThrow(() => writeWeatherCache(undefined, weather));
  assert.doesNotThrow(() => saveSelectedCity('北京'));
  Reflect.deleteProperty(globalThis, 'localStorage');
  assert.equal(readWeatherCache(), null);
  assert.doesNotThrow(() => saveSelectedCity(''));
});

test('maps common weather descriptions to Unicode symbols', () => {
  assert.equal(weatherSymbol('晴'), '☀');
  assert.equal(weatherSymbol('多云'), '⛅');
  assert.equal(weatherSymbol('阴'), '☁');
  assert.equal(weatherSymbol('雷阵雨'), '⛈');
  assert.equal(weatherSymbol('小雨'), '☂');
  assert.equal(weatherSymbol('雨夹雪'), '❄');
  assert.equal(weatherSymbol('雾'), '≋');
});
