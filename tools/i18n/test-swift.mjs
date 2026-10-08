// 验证 macOS 数量文案在 Foundation 中的实际复数选择与格式化。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLocales, REPO_ROOT } from './lib.mjs';

const keys = new Set();
for (const file of readdirSync(join(REPO_ROOT, 'apps/macos/Folio'), { recursive: true })) {
  if (!file.endsWith('.swift')) continue;
  const source = readFileSync(join(REPO_ROOT, 'apps/macos/Folio', file), 'utf8');
  for (const match of source.matchAll(/L\.plural\("([^"]+)"/g)) keys.add(match[1]);
}
assert(keys.size > 0, '必须覆盖 macOS 实际使用的数量文案');

const cases = [];
for (const [name, locale] of Object.entries(loadLocales())) {
  const language = { 'zh-CN': 'zh-Hans', en: 'en' }[name];
  assert(language, `缺少 ${name} 的 macOS 语言映射`);
  const plural = new Intl.PluralRules(name);
  const number = new Intl.NumberFormat(name);
  for (const key of keys) {
    for (const count of [0, 1, 2, 670, 2_147_483_648]) {
      const text = locale.flat[`${key}_${plural.select(count)}`]
        ?? locale.flat[`${key}_other`] ?? locale.flat[key];
      assert.equal(typeof text, 'string', `缺少 ${name} 的 ${key}`);
      cases.push({ language, key, count, expected: text.replace(/\{\{\s*count\s*\}\}/g, number.format(count)) });
    }
  }
}

const directory = mkdtempSync(join(tmpdir(), 'folio-i18n-swift-'));
try {
  const resources = process.argv[2] ?? join(directory, 'Resources');
  if (!process.argv[2]) {
    execFileSync(process.execPath, [join(REPO_ROOT, 'tools/i18n/build.mjs'), '--out', resources], { stdio: 'inherit' });
  }
  writeFileSync(join(directory, 'cases.json'), JSON.stringify(cases));
  const source = join(directory, 'main.swift');
  writeFileSync(source, `import Foundation
struct PluralCase: Decodable {
    let language: String
    let key: String
    let count: Int
    let expected: String
}
let cases = try JSONDecoder().decode([PluralCase].self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2])))
for item in cases where item.language == CommandLine.arguments[3] {
    guard let bundle = Bundle(path: CommandLine.arguments[1] + "/" + item.language + ".lproj") else {
        fatalError("缺少语言资源：\\(item.language)")
    }
    let format = bundle.localizedString(forKey: item.key, value: nil, table: nil)
    let actual = String.localizedStringWithFormat(format, item.count)
    guard actual == item.expected else {
        fatalError("\\(item.language) \\(item.key) \\(item.count)：\\(actual)，预期：\\(item.expected)")
    }
}
print("macOS 数量文案验证通过：\\(cases.filter { $0.language == CommandLine.arguments[3] }.count) 项")
`);
  const binary = join(directory, 'test');
  execFileSync('swiftc', [source, '-o', binary], { stdio: 'inherit' });
  for (const language of ['zh-Hans', 'en']) {
    execFileSync(binary, [
      resources, join(directory, 'cases.json'), language,
      '-AppleLanguages', `(${language})`, '-AppleLocale', language === 'en' ? 'en_US' : 'zh_CN',
    ], { stdio: 'inherit' });
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
