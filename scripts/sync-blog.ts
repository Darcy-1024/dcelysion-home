import { copyFile, lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** Explicit snapshot sync; normal builds use the checked-in snapshot only. */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((arg) => arg !== '--');
if (args.length > 1) throw new Error('Usage: pnpm sync:blog -- [blog-source-directory]');
const requestedSource = path.resolve(args[0] ?? 'F:/DcElysion-blog');
type ObjectValue = { [key: string]: Value };
type Value = string | number | boolean | null | Value[] | ObjectValue;
type Copy = { source: string; destination: string; bytes: number };
const copies: Copy[] = [];

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function sourceFile(root: string, relative: string): Promise<string> {
  const target = path.resolve(root, relative);
  if (!inside(root, target)) throw new Error(`Source path escapes its directory: ${relative}`);
  const canonical = await realpath(target).catch(() => { throw new Error(`Missing source file: ${relative}`); });
  if (!inside(root, canonical)) throw new Error(`Source symlink escapes its directory: ${relative}`);
  if (!(await stat(canonical)).isFile()) throw new Error(`Expected a file: ${relative}`);
  return canonical;
}

function unwrap(node: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) return unwrap(node.expression);
  return node;
}

function propertyName(node: ts.PropertyName): string {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  throw new Error('Computed config property names are unsupported');
}

function literal(expression: ts.Expression, label: string): Value {
  const node = unwrap(expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((item, index) => literal(item, `${label}[${index}]`));
  if (ts.isObjectLiteralExpression(node)) {
    const value: ObjectValue = Object.create(null);
    for (const member of node.properties) {
      if (!ts.isPropertyAssignment(member)) throw new Error(`Expected literal properties at ${label}`);
      const name = propertyName(member.name);
      if (Object.hasOwn(value, name)) throw new Error(`Duplicate property at ${label}.${name}`);
      value[name] = literal(member.initializer, `${label}.${name}`);
    }
    return value;
  }
  throw new Error(`Expected a static literal at ${label}; calls, identifiers and spreads are not evaluated`);
}

async function config(root: string, filename: string, exportName: string) {
  const filenamePath = await sourceFile(root, `src/config/${filename}`);
  const parsed = ts.createSourceFile(filename, await readFile(filenamePath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = (parsed as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (diagnostics.length) throw new Error(`Invalid TypeScript syntax in ${filename}`);
  let initializer: ts.Expression | undefined;
  for (const statement of parsed.statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === exportName) initializer = declaration.initializer;
    }
  }
  if (!initializer) throw new Error(`Missing export ${exportName} in ${filename}`);
  return (keys: string[]): Value => {
    let current: ts.Expression = initializer!;
    for (const key of keys) {
      const node = unwrap(current);
      if (!ts.isObjectLiteralExpression(node)) throw new Error(`Expected literal object in ${filename}: ${keys.join('.')}`);
      const matches = node.properties.filter((member): member is ts.PropertyAssignment => ts.isPropertyAssignment(member) && propertyName(member.name) === key);
      if (matches.length !== 1) throw new Error(`Missing or duplicate property ${key} in ${filename}`);
      current = matches[0].initializer;
    }
    return literal(current, `${filename}:${keys.join('.')}`);
  };
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Expected nonempty string at ${label}`);
  return value;
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected object at ${label}`);
  return value as Record<string, unknown>;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || !value.length) throw new Error(`Expected nonempty array at ${label}`);
  return value;
}
function httpUrl(value: unknown, label: string): string {
  const text = string(value, label);
  let url: URL;
  try { url = new URL(text); } catch { throw new Error(`Invalid URL at ${label}`); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error(`Expected HTTP(S) URL without credentials at ${label}`);
  return text;
}

async function planCopy(source: string, relativeDestination: string): Promise<string> {
  const destination = path.resolve(projectRoot, relativeDestination);
  if (!inside(projectRoot, destination)) throw new Error('Output path escapes project directory');
  const bytes = (await stat(source)).size;
  copies.push({ source, destination, bytes });
  return `/${relativeDestination.replace(/^public\//, '')}`;
}

async function asset(root: string, value: unknown, category: string): Promise<string> {
  const configured = string(value, category);
  if (/^https?:\/\//i.test(configured)) return httpUrl(configured, category);
  if (configured.includes('\\') || configured.includes('\0') || configured.includes('?') || configured.includes('#')) throw new Error(`Invalid local asset path at ${category}`);
  const parts = configured.replace(/^\//, '').split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes(':'))) throw new Error(`Unsafe local asset path at ${category}`);
  const source = await sourceFile(root, `${configured.startsWith('/') ? 'public' : 'src'}/${parts.join('/')}`);
  const basename = parts.at(-1)!;
  return planCopy(source, `public/assets/blog/${category}/${basename}`);
}

async function safeOutput(destination: string): Promise<void> {
  // Refuse existing symlinks in output ancestry, including an existing target file.
  let current = projectRoot;
  for (const part of path.relative(projectRoot, destination).split(path.sep)) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Refusing output symlink: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

async function main() {
  const homeOverrides = JSON.parse(await readFile(path.join(projectRoot, 'src/data/home.json'), 'utf8'));
  const source = await realpath(requestedSource).catch(() => { throw new Error(`Blog source directory does not exist: ${requestedSource}`); });
  if (!(await stat(source)).isDirectory()) throw new Error('Blog source must be a directory');
  const packagePath = await sourceFile(source, 'package.json');
  const sourcePackage = JSON.parse(await readFile(packagePath, 'utf8'));
  if (!sourcePackage.dependencies?.astro && !sourcePackage.devDependencies?.astro) throw new Error('Source is not an Astro blog: missing astro dependency');
  const profile = await config(source, 'profileConfig.ts', 'profileConfig');
  const wallpapers = await config(source, 'backgroundWallpaper.ts', 'backgroundWallpaper');
  const site = await config(source, 'siteConfig.ts', 'siteConfig');
  const links = array(profile(['links']), 'profile.links').map((value) => object(value, 'profile.links[]'));
  const socials = ['QQ', 'Email', 'Bilibili'].map((name) => {
    const matches = links.filter((link) => link.name === name);
    if (matches.length !== 1) throw new Error(`Expected exactly one social link: ${name}`);
    const link = matches[0];
    const icon = string(link.icon, `${name}.icon`);
    if (name === 'Email') {
      const emailUrl = string(link.url, 'Email.url');
      if (!/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(emailUrl) || /[?#]/.test(emailUrl)) throw new Error('Expected a plain mailto address for Email');
      return { name, icon, encodedEmail: Buffer.from(emailUrl.slice(7), 'utf8').toString('base64') };
    }
    return { name, icon, url: httpUrl(link.url, `${name}.url`) };
  });
  const music = object(JSON.parse(await readFile(await sourceFile(source, 'src/config/manifests/music.json'), 'utf8')), 'music manifest');
  const ids = new Set<string>();
  const tracks = array(music.tracks, 'music.tracks').map((value, index) => {
    const item = object(value, `tracks[${index}]`);
    const id = string(item.id, 'track.id');
    if (ids.has(id)) throw new Error(`Duplicate music track id: ${id}`);
    ids.add(id);
    return { id, name: string(item.name, 'track.name'), artist: string(item.artist, 'track.artist'), url: httpUrl(item.url, 'track.url'), cover: httpUrl(item.cover, 'track.cover'), ...(item.lrc === undefined ? {} : { lrc: string(item.lrc, 'track.lrc') }) };
  });
  const accentHue = site(['themeColor', 'hue']);
  if (typeof accentHue !== 'number' || !Number.isFinite(accentHue) || accentHue < 0 || accentHue > 360) throw new Error('themeColor.hue must be between 0 and 360');
  const wall = async (device: string, category: string) => {
    const value = wallpapers(['src', device]);
    return Promise.all((typeof value === 'string' ? [value] : array(value, `wallpapers.${device}`)).map((item) => asset(source, item, category)));
  };
  const home = {
    profile: { name: string(homeOverrides.profile.name, 'home.profile.name'), bio: string(profile(['bio']), 'profile.bio'), avatar: await asset(source, profile(['avatar']), 'profile') },
    logo: homeOverrides.logo,
    defaultWallpaper: homeOverrides.defaultWallpaper,
    socials, blogUrl: httpUrl(site(['site_url']), 'site_url'),
    wallpapers: { desktop: await wall('desktop', 'DesktopWallpaper'), mobile: await wall('mobile', 'MobileWallpaper') }, tracks, accentHue,
  };
  const favicons = array(site(['favicon']), 'site.favicon').map((item) => object(item, 'favicon[]'));
  const favicon = favicons.find((item) => item.sizes === '64x64') ?? favicons[0];
  const faviconSrc = string(favicon.src, 'favicon.src');
  if (!faviconSrc.startsWith('/') || path.extname(faviconSrc).toLowerCase() !== '.png') throw new Error('Configured favicon must be a local public PNG');
  await planCopy(await sourceFile(source, `public/${faviconSrc.slice(1)}`), 'public/favicon.png');
  const targets = new Map<string, string>();
  for (const copy of copies) {
    const previous = targets.get(copy.destination);
    if (previous && previous !== copy.source) throw new Error(`Asset filename collision: ${copy.destination}`);
    targets.set(copy.destination, copy.source);
  }
  const output = path.join(projectRoot, 'src/data/home.json');
  for (const target of [...targets.keys(), output]) await safeOutput(target);
  // All input is validated before any writes; no directory cleanup or unrelated deletion.
  for (const [destination, input] of targets) {
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(input, destination);
  }
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(home, null, 2)}\n`, 'utf8');
  console.log(`Synced ${home.wallpapers.desktop.length} desktop wallpapers, ${home.wallpapers.mobile.length} mobile wallpapers, ${tracks.length} tracks; ${targets.size} local files (${copies.reduce((sum, item) => sum + item.bytes, 0)} bytes).`);
}
main().catch((error: unknown) => { console.error(`sync:blog failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });

