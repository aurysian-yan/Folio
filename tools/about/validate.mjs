import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = (path) => readFileSync(resolve(root, path));
const catalog = JSON.parse(read('shared/about/licenses.json'));
const assert = (value, message) => { if (!value) throw new Error(message); };
assert(catalog.schemaVersion === 1, '许可目录版本错误');
for (const [path, hash] of Object.entries(catalog.fingerprints)) assert(createHash('sha256').update(read(path)).digest('hex') === hash, `许可目录已过期：${path}`);
for (const [hash, text] of Object.entries(catalog.texts)) assert(text.length && createHash('sha256').update(text).digest('hex') === hash, `许可原文损坏：${hash}`);
assert(catalog.entries.find((entry) => entry.name === 'Folio')?.version === JSON.parse(read('apps/desktop-ui/package.json')).version, '许可目录中的应用版本已过期');
const ids = new Set();
for (const entry of catalog.entries) {
  assert(!ids.has(entry.id), `重复许可：${entry.name}`); ids.add(entry.id);
  assert(entry.name && entry.license && entry.platforms.length, `不完整许可：${entry.name}`);
  assert(entry.source.startsWith('https://'), `来源地址必须为 HTTPS：${entry.name}`);
  assert(entry.declarationOnly || entry.documents.length, `缺少许可正文：${entry.name}`);
  for (const doc of entry.documents) assert(catalog.texts[doc.text], `缺少原始许可：${entry.name}`);
}
for (const [path, platforms] of [['apps/desktop-ui/package.json', ['windows','linux']], ['experiments/mobile/package.json', ['android','ios']]]) {
  const pkg = JSON.parse(read(path));
  for (const [name, version] of Object.entries(pkg.dependencies)) for (const platform of platforms)
    assert(catalog.entries.some((entry) => entry.name === name && entry.platforms.includes(platform) && (entry.version === version || version.startsWith('~') && entry.version.startsWith(version.slice(1).split('.').slice(0,2).join('.') + '.'))), `缺少直接依赖：${name} / ${platform}`);
}
for (const name of ['Folio','Inter','Source Serif 4','JetBrains Mono']) for (const platform of ['macos','windows','linux','android','ios'])
  assert(catalog.entries.some((entry) => entry.name === name && entry.platforms.includes(platform) && entry.documents.length), `缺少内置资源许可：${name} / ${platform}`);
for (const name of ['NexioSchedule','MeiloX','Kyant0 Capsule','Kyant0 AndroidLiquidGlass','Claralight Slider','ZIPFoundation','Phosphor native icons','AndroidX Gaussian blur']) assert(catalog.entries.some((entry) => entry.name === name), `缺少移植或原生组件许可：${name}`);
for (const [path, hash] of Object.entries(JSON.parse(read('shared/about/glyph-sources.json')))) assert(createHash('sha256').update(read(path)).digest('hex') === hash, `字形来源已变动：${path}`);
const glyphs = JSON.parse(read('shared/about/glyphs.json'));
assert(glyphs.length === 6 && glyphs.every((glyph) => glyph.width === 1275 && glyph.height === 559 && glyph.paths.length && glyph.commands.length), '字形资源不完整');
assert(glyphs.map((glyph) => glyph.name).join(',') === 'logo-main,logo-egg1,logo-egg2,logo-egg3,logo-egg4,logo-egg5', '字标顺序错误');
console.log(`关于资源有效：${catalog.entries.length} 项许可，${Object.keys(catalog.texts).length} 份原文`);
