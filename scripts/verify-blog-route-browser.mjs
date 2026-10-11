// Local-only fixture: production sources/config remain unchanged. No live probes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
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
      if (path.endsWith('Home.svelte')) source = source.replace(/(<!-- BLOG_ENTRY_START[^\n]*\n\s*)<!--/, '$1').replace(/-->\s*(<!-- BLOG_ENTRY_END -->)/, '$1');
      return { contents: compile(source, { filename: path, generate: 'client', css: 'injected' }).js.code, loader: 'js', resolveDir: resolve(path, '..') };
    });
    build.onLoad({ filter: /blog-route\.ts$/ }, async ({ path }) => ({ contents: (await readFile(path, 'utf8')).replace('BLOG_ROUTE_ENABLED = false', 'BLOG_ROUTE_ENABLED = true'), loader: 'ts', resolveDir: resolve(path, '..') }));
  } }],
});
const probe = Buffer.concat(Array.from({ length: 1024 }, (_, counter) => createHash('sha256').update(`dcelysion.blog-route.probe-v1:${counter}`).digest()));
let cfRequests = 0, eoRequests = 0, cors = true;
const servers = [];
const serve = async (port, handler) => { const server = createServer(handler); servers.push(server); await new Promise(resolve => server.listen(port, '127.0.0.1', resolve)); };
await serve(4390, async (req, res) => {
  try {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>'); return; }
    if (req.url === '/production/') { res.setHeader('Content-Type', 'text/html'); res.end(await readFile(resolve(root, 'dist/index.html'))); return; }
    const file = req.url.startsWith('/fixture.') ? resolve(output, req.url.slice(1)) : req.url.startsWith('/_astro/') ? resolve(root, 'dist', req.url.slice(1)) : resolve(root, 'public', req.url.slice(1));
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
  const production = await context.newPage(); let productionProbes = 0;
  production.on('request', req => { if (req.url().includes('/__route/')) productionProbes++; });
  await production.goto('http://127.0.0.1:4390/production/');
  await production.waitForFunction(() => document.querySelector('astro-island') && !document.querySelector('astro-island').hasAttribute('ssr'));
  await production.waitForTimeout(150);
  assert.equal(await production.locator('a.blog-link, .blog-route-controls').count(), 0);
  assert.equal(productionProbes, 0);
  const html = await readFile(resolve(root, 'dist/index.html'), 'utf8');
  assert.ok(!html.includes('fixture.js'));
  assert.equal(errors.length, 0, errors.join('\n'));
  evidence.push('正式 dist 完成 hydration：入口/控件不存在、无 probe 请求、无夹具引用');
  await page.screenshot({ path: resolve(output, 'fixture.png'), fullPage: true });
  await writeFile(resolve(output, 'browser-result.json'), JSON.stringify({ localFixture: true, liveProductionProbe: false, evidence, cfRequests, eoRequests, errors }, null, 2));
  console.log(JSON.stringify({ passed: evidence, output }, null, 2));
} finally {
  await browser?.close();
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
}
