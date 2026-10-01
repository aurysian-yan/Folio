// 从 locales/ 生成 macOS 本地化资源（Localizable.strings 与 Localizable.stringsdict）。
// React 桌面端与移动端直接引用 locales/ 源文件，无需生成；这里只处理 Swift 侧。
// 用法：node tools/i18n/build.mjs --out <目标目录>
// 目标目录下会写入 <language>.lproj 子目录，可直接放入应用 bundle 的 Resources。

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { baseKey, loadLocales, placeholders, SOURCE_LOCALE } from './lib.mjs';

// 语言代码到 macOS .lproj 目录名的映射。
const LPROJ = { 'zh-CN': 'zh-Hans', en: 'en' };
// i18next 复数后缀到 stringsdict 复数类别的映射；base 视为 other。
const PLURAL_FORMS = { zero: 'zero', one: 'one', two: 'two', few: 'few', many: 'many', other: 'other' };

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outputDir = resolve(outIndex >= 0 ? args[outIndex + 1] : 'apps/macos/Folio/Resources');

const locales = loadLocales();
const source = locales[SOURCE_LOCALE];
if (!source) {
  process.stderr.write('i18n 生成失败：缺少源语言目录。\n');
  process.exit(1);
}
const sourceBaseKeys = [...new Set(Object.keys(source.flat).map(baseKey))];
// 复数键由任意语言中带复数后缀的键共同声明；源语言（中文）通常只保留基础键。
const pluralKeys = new Set(
  sourceBaseKeys.filter((key) =>
    Object.values(locales).some((locale) =>
      Object.keys(locale.flat).some((candidate) => baseKey(candidate) === key && candidate !== key),
    ),
  ),
);

// 转义 .strings 字面量：反斜杠、引号与换行。
function escapeStrings(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// 把 {{name}} 占位符转换为 printf 形式；复数变量 count 使用 %ld。
function toFormat(value, numericNames = []) {
  return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, name) =>
    numericNames.includes(name) ? '%ld' : '%@',
  );
}

function stringsFile(entries) {
  const lines = ['/* 由 tools/i18n/build.mjs 生成，请勿手动修改。 */', ''];
  for (const [key, value] of entries) {
    lines.push(`"${escapeStrings(key)}" = "${escapeStrings(value)}";`);
  }
  return `${lines.join('\n')}\n`;
}

function plistString(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function stringsdictFile(plurals) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
  ];
  for (const entry of plurals) {
    lines.push(`  <key>${plistString(entry.key)}</key>`);
    lines.push('  <dict>');
    lines.push('    <key>NSStringLocalizedFormatKey</key>');
    lines.push(`    <string>${plistString(entry.format)}</string>`);
    lines.push('    <key>count</key>');
    lines.push('    <dict>');
    lines.push('      <key>NSStringFormatSpecTypeKey</key>');
    lines.push('      <string>NSStringFormatSpecTypePlural</string>');
    lines.push('      <key>NSStringFormatValueTypeKey</key>');
    lines.push('      <string>ld</string>');
    for (const [category, value] of entry.forms) {
      lines.push(`      <key>${category}</key>`);
      lines.push(`      <string>${plistString(value)}</string>`);
    }
    lines.push('    </dict>');
    lines.push('  </dict>');
  }
  lines.push('</dict>', '</plist>');
  return `${lines.join('\n')}\n`;
}

for (const [localeName, locale] of Object.entries(locales)) {
  const lproj = LPROJ[localeName];
  if (!lproj) {
    process.stderr.write(`i18n 生成跳过：未知语言代码 ${localeName}。\n`);
    continue;
  }

  const plain = [];
  const plurals = [];

  for (const key of sourceBaseKeys) {
    if (!pluralKeys.has(key)) {
      const value = locale.flat[key] ?? source.flat[key];
      if (typeof value === 'string') {
        const format = toFormat(value);
        plain.push([key, format]);
      }
      continue;
    }

    // 复数条目：收集各复数形式，缺失的以 other 回退。
    const other = locale.flat[`${key}_other`] ?? locale.flat[key] ?? source.flat[key];
    if (typeof other !== 'string') continue;
    const names = placeholders(other);
    if (names.some((name) => name !== 'count')) {
      throw new Error(`复数条目 ${key} 只支持 count 占位符，实际为 [${names.join(', ')}]`);
    }
    const forms = new Map();
    for (const [suffix, category] of Object.entries(PLURAL_FORMS)) {
      const value = category === 'other' ? other : locale.flat[`${key}_${suffix}`];
      if (typeof value === 'string') forms.set(category, toFormat(value, ['count']));
    }
    plurals.push({
      key,
      format: toFormat(other, ['count']).replace(/%ld/g, '%#@count@'),
      forms: [...forms.entries()],
    });
  }

  const dir = join(outputDir, `${lproj}.lproj`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'Localizable.strings'), stringsFile(plain), 'utf8');
  if (plurals.length > 0) {
    writeFileSync(join(dir, 'Localizable.stringsdict'), stringsdictFile(plurals), 'utf8');
  }
  // Info.plist 中的展示名称与文稿类型同样需要本地化。
  writeFileSync(
    join(dir, 'InfoPlist.strings'),
    stringsFile([
      ['CFBundleDisplayName', locale.flat['common.appName'] ?? 'Folio'],
      ['CFBundleName', locale.flat['common.appName'] ?? 'Folio'],
      ['CFBundleTypeName', locale.flat['macos.fontDocumentType'] ?? source.flat['macos.fontDocumentType']],
    ]),
    'utf8',
  );
  process.stdout.write(
    `已生成 ${lproj}：${plain.length} 条普通文案，${plurals.length} 条复数字段。\n`,
  );
}
