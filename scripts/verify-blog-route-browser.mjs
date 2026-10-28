// Local-only fixture: production sources/config remain unchanged. No live probes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile } from 'svelte/compiler';

const require = createRequire(import.meta.url);
const esbuild = require(createRequire(require.resolve('tsx')).resolve('esbuild'));
// Pass the installed runtime package directory; do not install browser dependencies.
const runtime = process.env.BLOG_ROUTE_BROWSER_RUNTIME;
if (!runtime) throw new Error('Set BLOG_ROUTE_BROWSER_RUNTIME to the bundled node/node_modules directory');
const { chromium } = await import(pathToFileURL(resolve(runtime, 'playwright/index.mjs')).href);
const root = process.cwd();
const output = resolve(root, '.validation/blog-route-b');
await mkdir(output, { recursive: true });
const entry = `import { mount } from 'svelte';
import Home from ${JSON.stringify(resolve(root, 'src/components/Home.svelte'))};
import data from ${JSON.stringify(resolve(root, 'src/data/home.json'))};
import ${JSON.stringify(resolve(root, 'src/styles/global.css'))};
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
 const url = String(input);
 if (url === 'https://blog.dcelysion.cn/__route/probe-v1.bin') return originalFetch('http://127.0.0.1:4391/__route/probe-v1.bin', options);
 if (url === 'https://blog-eo.dcelysion.cn/__route/probe-v1.bin') return originalFetch('http://127.0.0.1:4392/__route/probe-v1.bin', options);
 return originalFetch(input, options);
};
mount(Home, { target: document.getElementById('app'), props: { data, icons: {} } });`;
await esbuild.build({
  stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'browser', format: 'esm', conditions: ['browser'], external: ['/assets/*'], outfile: resolve(output, 'fixture.js'),
  plugins: [{ name: 'local-blog-route-fixture', setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
      let source = await readFile(path, 'utf8');
      // Expose manual controls only in this compiled fixture, never in production.
      if (path.endsWith('Home.svelte')) {
        assert.match(source, /class="blog-route-controls"[^>]* hidden/);
        source = source.replace(/(class="blog-route-controls"[^>]*) hidden/, '$1');
      }
      return { contents: compile(source, { filename: path, generate: 'client', css: 'injected' }).js.code, loader: 'js', resolveDir: resolve(path, '..') };
    });
  } }],
});
const probe = Buffer.concat(Array.from({ length: 1024 }, (_, counter) => createHash('sha256').update(`dcelysion.blog-route.probe-v1:${counter}`).digest()));
let cfRequests = 0, eoRequests = 0, cors = true;
const servers = [];
const serve = async (port, handler) => { const server = createServer(handler); servers.push(server); await new Promise(resolve => server.listen(port, '127.0.0.1', resolve)); };
await serve(4390, async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://127.0.0.1:4390').pathname;
    if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>'); return; }
    if (pathname === '/production/') { res.setHeader('Content-Type', 'text/html'); res.end(await readFile(resolve(root, 'dist/index.html'))); return; }
    const file = pathname.startsWith('/fixture.') ? resolve(output, pathname.slice(1)) : pathname.startsWith('/_astro/') ? resolve(root, 'dist', pathname.slice(1)) : resolve(root, 'public', pathname.slice(1));
    res.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end(); }
});
for (const [port, delay] of [[4391, 650], [4392, 300]]) await serve(port, (req, res) => {
  if (port === 4391) cfRequests++; else eoRequests++;
  assert.equal(req.url, '/__route/probe-v1.bin');
  assert.equal(req.headers.origin, 'http://127.0.0.1:4390');
  assert.equal(req.headers.cookie, undefined);
  setTimeout(() => {
    res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', probe.length);
    res.setHeader('Cache-Control', 'no-store, no-transform');
    if (cors) res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Encoding');
    res.end(probe);
  }, delay);
});
let browser;
const evidence = [];
try {
  browser = await chromium.launch({ headless: true, channel: process.env.BLOG_ROUTE_BROWSER_CHANNEL || 'msedge' });
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.route('https://**/*', route => {
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<title>Navigation fixture</title>' });
    return route.abort(); // Existing media/weather are outside this fixture's scope.
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4390/');
  const anchor = page.locator('a.blog-link');
  await anchor.waitFor();
  assert.equal(await anchor.getAttribute('href'), 'https://blog.dcelysion.cn/');
  assert.equal(await anchor.getAttribute('target'), '_blank');
  assert.equal(await anchor.getAttribute('rel'), 'noopener noreferrer');
  // Immediate click opens the default native anchor, before the slow probe finishes.
  const early = page.waitForEvent('popup'); await anchor.click(); const popup = await early;
  await popup.waitForLoadState(); assert.equal(popup.url(), 'https://blog.dcelysion.cn/'); await popup.close();
  evidence.push('早点击默认 Cloudflare；普通 target=_blank 锚点立即打开');
  await page.waitForFunction(() => document.querySelector('a.blog-link')?.getAttribute('href') === 'https://blog-eo.dcelysion.cn/');
  assert.equal(cfRequests, 1); assert.equal(eoRequests, 1);
  evidence.push('两个本地不同 origin 真实 CORS 读取和 SHA-256 校验，EO 优势达到阈值后更新 href');
  await page.getByRole('button', { name: 'Cloudflare', exact: true }).click();
  assert.equal(await anchor.getAttribute('href'), 'https://blog.dcelysion.cn/');
  assert.equal(await page.getByRole('button', { name: 'Cloudflare', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '自动', exact: true }).click();
  assert.equal(await anchor.getAttribute('href'), 'https://blog-eo.dcelysion.cn/');
  assert.equal(cfRequests, 1); assert.equal(eoRequests, 1);
  const keyboardPopup = page.waitForEvent('popup'); await anchor.focus(); await page.keyboard.press('Enter');
  const keyboardTab = await keyboardPopup; await keyboardTab.waitForLoadState(); assert.equal(keyboardTab.url(), 'https://blog-eo.dcelysion.cn/'); await keyboardTab.close();
  const middlePopup = context.waitForEvent('page', { timeout: 10000 }); await anchor.click({ button: 'middle' });
  const middleTab = await middlePopup; await middleTab.waitForLoadState(); assert.equal(middleTab.url(), 'https://blog-eo.dcelysion.cn/'); await middleTab.close();
  const ctrlPopup = context.waitForEvent('page', { timeout: 10000 }); await anchor.click({ modifiers: ['Control'] });
  const ctrlTab = await ctrlPopup; await ctrlTab.waitForLoadState(); assert.equal(ctrlTab.url(), 'https://blog-eo.dcelysion.cn/'); await ctrlTab.close();
  evidence.push('手动/自动复用、aria-pressed、Enter、中键、Ctrl 点击保留新标签语义');
  await page.getByRole('button', { name: '重新测速', exact: true }).click();
  await page.getByRole('button', { name: 'Cloudflare', exact: true }).click();
  await page.waitForTimeout(800);
  assert.equal(await anchor.getAttribute('href'), 'https://blog.dcelysion.cn/');
  await page.reload(); await anchor.waitFor(); await page.waitForTimeout(100);
  assert.equal(await anchor.getAttribute('href'), 'https://blog.dcelysion.cn/');
  assert.ok(cfRequests <= 2 && eoRequests <= 2);
  evidence.push('显式重测期间手动选择保持优先，刷新复用手动结果');
  // Browser must reject missing CORS; no no-cors or synthetic success.
  cors = false;
  await page.evaluate(() => sessionStorage.clear()); await page.reload(); await anchor.waitFor();
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('dcelysion.blog-route.v1') || '{}').status === 'ready');
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('dcelysion.blog-route.v1')).measured), false);
  assert.equal(await anchor.getAttribute('href'), 'https://blog.dcelysion.cn/');
  evidence.push('撤掉本地 CORS 头后浏览器双失败降级 CF');
  const production = await context.newPage(); const productionProbes = [];
  const fontResponses = [];
  production.on('response', response => {
    if (new URL(response.url()).pathname.endsWith('.woff2')) fontResponses.push(response.body().then(body => ({ url: response.url(), status: response.status(), bytes: body.length })));
  });
  production.on('pageerror', error => errors.push(error.message));
  await production.route('https://**/*', async route => {
    const url = new URL(route.request().url());
    if (['blog.dcelysion.cn', 'blog-eo.dcelysion.cn'].includes(url.hostname) && url.pathname === '/__route/probe-v1.bin') {
      productionProbes.push(url.href);
      await new Promise(resolve => setTimeout(resolve, url.hostname === 'blog.dcelysion.cn' ? 650 : 300));
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(probe.length), 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length, Content-Encoding' }, body: probe });
    }
    return route.abort();
  });
  await production.goto('http://127.0.0.1:4390/production/');
  await production.waitForFunction(() => document.querySelector('astro-island') && !document.querySelector('astro-island').hasAttribute('ssr'));
  assert.equal(await production.locator('a.blog-link').isVisible(), true);
  assert.equal(await production.locator('.blog-route-controls').count(), 1);
  assert.equal(await production.locator('.blog-route-controls').isHidden(), true);
  assert.equal(await production.locator('.blog-route-controls').getAttribute('hidden'), '');
  await production.waitForFunction(() => document.querySelector('a.blog-link')?.getAttribute('href') === 'https://blog-eo.dcelysion.cn/');
  assert.deepEqual(productionProbes.sort(), ['https://blog-eo.dcelysion.cn/__route/probe-v1.bin', 'https://blog.dcelysion.cn/__route/probe-v1.bin'].sort());
  const html = await readFile(resolve(root, 'dist/index.html'), 'utf8');
  assert.ok(!html.includes('fixture.js'));
  assert.ok(!html.includes('127.0.0.1:439'));
  for (const file of await readdir(resolve(root, 'dist/_astro'))) {
    if (!file.endsWith('.js')) continue;
    const chunk = await readFile(resolve(root, 'dist/_astro', file), 'utf8');
    assert.ok(!chunk.includes('127.0.0.1:439') && !chunk.includes('fixture.js'), `fixture leaked into ${file}`);
  }
  await production.evaluate(() => document.fonts.ready);
  const fonts = await Promise.all(fontResponses);
  assert.ok(fonts.every(font => font.status === 200 && font.bytes > 0), 'all requested fonts should load successfully');
  assert.ok(!fonts.some(font => font.url.endsWith('/MiSansVF.woff2')));
  assert.ok(fonts.some(font => /common[^/]*\.woff2/.test(font.url)), 'production should load the common MiSans subset');
  await production.setViewportSize({ width: 1440, height: 900 });
  await production.screenshot({ path: resolve(output, 'production-desktop.png'), fullPage: true });
  await production.setViewportSize({ width: 390, height: 844 });
  await production.screenshot({ path: resolve(output, 'production-mobile.png'), fullPage: true });
  // U+6F90 belongs to a non-common subset; exercise dynamic text loading too.
  const loadedFaces = await production.evaluate(async () => {
    const span = document.createElement('span');
    span.textContent = '\u6f90';
    span.style.fontFamily = '"MiSans VF"';
    document.body.append(span);
    const faces = await document.fonts.load('400 20px "MiSans VF"', span.textContent);
    await document.fonts.ready;
    span.remove();
    return faces.length;
  });
  const baselineFontUrls = new Set(fonts.map(font => font.url));
  const onDemandFonts = (await Promise.all(fontResponses)).filter(font => !baselineFontUrls.has(font.url));
  assert.ok(loadedFaces > 0 && onDemandFonts.some(font => /\/misans\/\d{3}-[^/]+\.woff2/.test(font.url) && font.bytes > 0), 'dynamic text should load an additional MiSans subset');
  const bio = JSON.parse(await readFile(resolve(root, 'src/data/home.json'), 'utf8')).profile.bio;
  const fallback = await context.newPage();
  fallback.on('pageerror', error => errors.push(error.message));
  await fallback.addInitScript(() => {
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });
    localStorage.removeItem('dcelysion-home:weather:selected-city');
    localStorage.setItem('dcelysion-home:weather:auto', JSON.stringify({ savedAt: Date.now(), data: { city: '测试城市', description: '晴', temperature: 25, humidity: 50, windDirection: '东风', windPower: '1级', updatedAt: '本地夹具' } }));
  });
  await fallback.goto('http://127.0.0.1:4390/production/');
  await fallback.waitForFunction(() => document.querySelector('astro-island') && !document.querySelector('astro-island').hasAttribute('ssr'));
  assert.equal(await fallback.locator('.bio-text').textContent(), bio);
  // Both start after bio initialization in onMount: cached weather selection and clock.
  await fallback.waitForFunction(() => localStorage.getItem('dcelysion-home:weather:selected-city') !== null);
  await fallback.locator('.weather-trigger').click();
  assert.match(await fallback.locator('.weather-time').textContent(), /\d{2}:\d{2}/);
  await fallback.locator('#weather-city').fill('广州');
  await fallback.locator('.city-submit').click();
  await fallback.waitForFunction(() => localStorage.getItem('dcelysion-home:weather:selected-city') === '广州');
  await fallback.getByRole('button', { name: '关闭面板', exact: true }).last().click();
  await fallback.emulateMedia({ reducedMotion: 'no-preference' });
  await fallback.waitForFunction(expected => document.querySelector('.bio-text')?.textContent !== expected, bio);
  await fallback.waitForFunction(expected => document.querySelector('.bio-text')?.textContent === expected, bio, { timeout: Math.max(10000, Array.from(bio).length * 200) });
  assert.equal(errors.length, 0, errors.join('\n'));
  evidence.push('正式 dist 完成 hydration：入口可见、控件隐藏，自动发起两个被拦截探针并选择 EO，无真实生产请求、无夹具引用');
  evidence.push('正式 dist 缺少 Intl.Segmenter：bio 完整，天气初始化与城市选择继续工作，动态切换动效后打字仍能显示全文');
  await page.screenshot({ path: resolve(output, 'fixture.png'), fullPage: true });
  await writeFile(resolve(output, 'browser-result.json'), JSON.stringify({ localFixture: true, liveProductionProbe: false, evidence, cfRequests, eoRequests, productionProbes, fonts, fontBytes: fonts.reduce((sum, font) => sum + font.bytes, 0), onDemandFonts, errors }, null, 2));
  console.log(JSON.stringify({ passed: evidence, output }, null, 2));
} finally {
  await browser?.close();
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
}
