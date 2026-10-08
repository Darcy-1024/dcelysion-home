export type Greeting = { text: string; time: string; source: 'device' };

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

// Device time stays consistent with the visitor's clock, even behind a proxy.
export class GreetingClock {
  private timer?: ReturnType<typeof setInterval>;
  private stopped = true;

  constructor(private publish: (value: Greeting) => void) {}

  start(): void {
    clearInterval(this.timer);
    this.stopped = false;
    this.update();
    this.timer = setInterval(() => this.update(), 60 * 1000);
  }

  private update(): void {
    if (this.stopped) return;
    const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timezone = validTimezone(deviceTimezone) ? deviceTimezone : 'UTC';
    this.publish({ ...greetingAt(new Date(), timezone), source: 'device' });
  }

  resume(): void {
    this.update();
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
  }
}
