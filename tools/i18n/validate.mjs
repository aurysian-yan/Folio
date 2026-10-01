// 校验 locales/ 下的语言目录：重复键、键集合一致性与占位符一致性。
// 供 `pnpm i18n:validate` 与 CI 使用；发现问题时以非零退出码结束。

import { baseKey, loadLocales, placeholders, SOURCE_LOCALE } from './lib.mjs';

const problems = [];
const locales = loadLocales();
const names = Object.keys(locales);

if (!names.includes(SOURCE_LOCALE)) {
  problems.push(`缺少源语言 ${SOURCE_LOCALE}.json`);
}

for (const [name, locale] of Object.entries(locales)) {
  for (const duplicate of locale.duplicates) {
    problems.push(`${name}.json 存在重复键：${duplicate}`);
  }
}

const source = locales[SOURCE_LOCALE];
if (source) {
  // 以源语言的基础键为基准，逐语言比对。
  const sourceBase = new Set(Object.keys(source.flat).map(baseKey));
  for (const name of names) {
    if (name === SOURCE_LOCALE) continue;
    const locale = locales[name];
    const localeBase = new Set(Object.keys(locale.flat).map(baseKey));
    for (const key of sourceBase) {
      if (!localeBase.has(key)) problems.push(`${name}.json 缺少键：${key}`);
    }
    for (const key of localeBase) {
      if (!sourceBase.has(key)) problems.push(`${name}.json 存在多余键：${key}`);
    }
  }

  // 占位符一致性：同一基础键在各语言中必须使用相同的占位符集合。
  for (const name of names) {
    if (name === SOURCE_LOCALE) continue;
    const locale = locales[name];
    for (const [sourceKey, sourceValue] of Object.entries(source.flat)) {
      const targetValue = locale.flat[sourceKey];
      if (targetValue === undefined) continue;
      const expected = placeholders(sourceValue).join(',');
      const actual = placeholders(targetValue).join(',');
      if (expected !== actual) {
        problems.push(
          `${name}.json 的 ${sourceKey} 占位符不一致：期望 [${expected}]，实际 [${actual}]`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(`i18n 校验失败（${problems.length} 项）：\n`);
  for (const problem of problems) process.stderr.write(`  · ${problem}\n`);
  process.exit(1);
}

process.stdout.write(
  `i18n 校验通过：${names.length} 种语言，源语言 ${SOURCE_LOCALE}，共 ${Object.keys(source?.flat ?? {}).length} 个字段。\n`,
);
