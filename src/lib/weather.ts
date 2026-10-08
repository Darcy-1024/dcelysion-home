export type Weather = {
  city: string;
  description: string;
  temperature: number;
  humidity: number;
  windDirection: string;
  windPower: string;
  updatedAt: string;
};

export const CACHE_TTL = 30 * 60 * 1000;
const TIMEOUT = 8000;
const SELECTED_CITY_KEY = 'dcelysion-home:weather:selected-city';
const cacheKey = (city?: string) =>
  `dcelysion-home:weather:${city?.trim() ? `manual:${encodeURIComponent(city.trim())}` : 'auto'}`;

function parseWeather(raw: unknown): Weather {
  if (!raw || typeof raw !== 'object') throw new Error('天气数据格式异常');
  const value = raw as Record<string, unknown>;
  const strings = ['city', 'weather', 'wind_direction', 'wind_power', 'report_time'];
  if (strings.some((key) => typeof value[key] !== 'string' || !(value[key] as string).trim()) ||
    typeof value.temperature !== 'number' || !Number.isFinite(value.temperature) ||
    typeof value.humidity !== 'number' || !Number.isFinite(value.humidity) ||
    value.humidity < 0 || value.humidity > 100) {
    throw new Error('天气数据格式异常');
  }
  return {
    city: value.city as string,
    description: value.weather as string,
    temperature: value.temperature,
    humidity: value.humidity,
    windDirection: value.wind_direction as string,
    windPower: value.wind_power as string,
    updatedAt: value.report_time as string,
  };
}

export async function fetchWeather(city?: string, signal?: AbortSignal): Promise<Weather> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT);
  try {
    const url = new URL('https://uapis.cn/api/v1/misc/weather');
    if (city?.trim()) url.searchParams.set('city', city.trim());
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`天气服务暂时不可用（${response.status}）`);
    let raw: unknown;
    try { raw = await response.json(); }
    catch { throw new Error('天气数据格式异常'); }
    return parseWeather(raw);
  } catch (error) {
    if (timedOut) throw new Error('天气请求超时，请稍后重试');
    if (signal?.aborted) throw new Error('天气请求已取消');
    if (error instanceof Error && error.message.startsWith('天气')) throw error;
    throw new Error('天气加载失败，请检查网络后重试');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function isWeather(value: unknown): value is Weather {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return ['city', 'description', 'windDirection', 'windPower', 'updatedAt'].every(
    (key) => typeof data[key] === 'string' && (data[key] as string).trim().length > 0,
  ) && typeof data.temperature === 'number' && Number.isFinite(data.temperature) &&
    typeof data.humidity === 'number' && Number.isFinite(data.humidity) &&
    data.humidity >= 0 && data.humidity <= 100;
}

export function readWeatherCache(city?: string): { data: Weather; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(cacheKey(city));
    if (!raw) return null;
    const cached: unknown = JSON.parse(raw);
    if (!cached || typeof cached !== 'object') return null;
    const value = cached as Record<string, unknown>;
    if (!isWeather(value.data) || typeof value.savedAt !== 'number' ||
      !Number.isFinite(value.savedAt) || value.savedAt <= 0 || value.savedAt > Date.now()) return null;
    return { data: value.data, savedAt: value.savedAt };
  } catch { return null; }
}

export function writeWeatherCache(city: string | undefined, data: Weather): void {
  try {
    if (isWeather(data)) localStorage.setItem(cacheKey(city), JSON.stringify({ data, savedAt: Date.now() }));
  } catch { /* Storage may be disabled or full. */ }
}

export function readSelectedCity(): string {
  try { return localStorage.getItem(SELECTED_CITY_KEY)?.trim() ?? ''; }
  catch { return ''; }
}

export function saveSelectedCity(city: string): void {
  try { localStorage.setItem(SELECTED_CITY_KEY, city.trim()); }
  catch { /* Storage is optional. */ }
}

export function weatherSymbol(description: string): string {
  if (/雷/.test(description)) return '⛈';
  if (/雪/.test(description)) return '❄';
  if (/雨/.test(description)) return '☂';
  if (/雾|霾|沙|尘/.test(description)) return '≋';
  if (/多云/.test(description)) return '⛅';
  if (/阴|云/.test(description)) return '☁';
  if (/晴/.test(description)) return '☀';
  return '☁';
}
