export const TIMEZONE_CACHE_TTL = 30 * 60 * 1000;
export const TIMEZONE_CACHE_KEY = 'dcelysion-home:greeting:timezone';
export type Greeting = { text: string; time: string; source: 'device' | 'ip' };

export function validTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; }
  catch { return false; }
}

export function greetingAt(date: Date, timezone: string): Omit<Greeting, 'source'> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  const text = hour >= 5 && hour < 9 ? '早上好' : hour >= 9 && hour < 11 ? '上午好'
    : hour >= 11 && hour < 13 ? '中午好' : hour >= 13 && hour < 17 ? '下午好'
    : hour >= 17 && hour < 19 ? '傍晚好' : '晚上好';
  return { text, time: `${String(hour).padStart(2, '0')}:${minute}` };
}

export function readTimezoneCache(now = Date.now()): { timezone: string; savedAt: number } | null {
  try {
    const value = JSON.parse(localStorage.getItem(TIMEZONE_CACHE_KEY) ?? 'null');
    if (!value || !validTimezone(value.timezone) || typeof value.savedAt !== 'number' ||
      !Number.isFinite(value.savedAt) || value.savedAt <= 0 || value.savedAt > now ||
      now - value.savedAt >= TIMEZONE_CACHE_TTL) return null;
    return { timezone: value.timezone, savedAt: value.savedAt };
  } catch { return null; }
}

export function writeTimezoneCache(timezone: string, savedAt = Date.now()): void {
  try {
    if (validTimezone(timezone)) localStorage.setItem(TIMEZONE_CACHE_KEY, JSON.stringify({ timezone, savedAt }));
  } catch { /* Timezone storage is optional. Never store the IP. */ }
}

export async function fetchIpTimezone(signal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 8000);
  try {
    const response = await fetch('https://ipapi.co/timezone/', { signal: controller.signal });
    if (!response.ok) throw new Error('时区服务暂时不可用');
    const timezone = (await response.text()).trim();
    if (!validTimezone(timezone)) throw new Error('时区数据格式异常');
    return timezone;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

// The clock is independent of weather cities and keeps only one request in flight.
export class GreetingClock {
  private timezone = 'UTC';
  private source: Greeting['source'] = 'device';
  private savedAt = 0;
  private lastAttempt = 0;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;

  constructor(private publish: (value: Greeting) => void) {}

  start(): void {
    this.stopped = false;
    const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.timezone = validTimezone(deviceTimezone) ? deviceTimezone : 'UTC';
    const cache = readTimezoneCache();
    if (cache) { this.timezone = cache.timezone; this.savedAt = cache.savedAt; this.source = 'ip'; }
    this.update();
    void this.refresh();
    this.timer = setInterval(() => this.update(), 60 * 1000);
  }

  private update(): void {
    if (!this.stopped) this.publish({ ...greetingAt(new Date(), this.timezone), source: this.source });
  }

  resume(): void {
    this.update();
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    const now = Date.now();
    if (this.stopped || this.controller || (this.savedAt && now - this.savedAt < TIMEZONE_CACHE_TTL) ||
      (this.lastAttempt && now - this.lastAttempt < 60 * 1000)) return;
    this.lastAttempt = now;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const timezone = await fetchIpTimezone(controller.signal);
      if (this.stopped || controller.signal.aborted) return;
      this.timezone = timezone;
      this.source = 'ip';
      this.savedAt = Date.now();
      writeTimezoneCache(timezone, this.savedAt);
    } catch {
      if (!this.stopped && !controller.signal.aborted) {
        this.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        this.source = 'device';
        this.savedAt = 0;
      }
    } finally {
      if (this.controller === controller) this.controller = undefined;
      this.update();
    }
  }

  stop(): void {
    this.stopped = true;
    this.controller?.abort();
    clearInterval(this.timer);
  }
}
