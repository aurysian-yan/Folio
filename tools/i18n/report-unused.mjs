// 报告 locales/ 中未被任何客户端引用的字段，便于精简重复或废弃文案。
// 引用判定：源码中出现带引号的完整键名，例如 t("common.cancel") 或 L.text("common.cancel")。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

import { loadLocales, REPO_ROOT, SOURCE_LOCALE } from './lib.mjs';

const SCAN_DIRS = [
  join(REPO_ROOT, 'apps/desktop-ui/src'),
  join(REPO_ROOT, 'experiments/mobile/src'),
  join(REPO_ROOT, 'apps/macos/Folio'),
];
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.swift']);
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.build']);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const path = join(dir, entry);
    const info = statSync(path);
    if (info.isDirectory()) {
      yield* walk(path);
    } else if (SCAN_EXTENSIONS.has(extname(path))) {
      yield path;
    }
  }
}

const locales = loadLocales();
const source = locales[SOURCE_LOCALE];
if (!source) {
  process.stderr.write('缺少源语言目录，无法生成报告。\n');
  process.exit(1);
}

const used = new Set();
for (const dir of SCAN_DIRS) {
  let files;
  try {
    files = [...walk(dir)];
  } catch {
    continue;
  }
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/["']([\w.-]+)["']/g)) {
      if (source.flat[match[1]] !== undefined) used.add(match[1]);
    }
  }
}

const unused = Object.keys(source.flat).filter((key) => !used.has(key));
if (unused.length === 0) {
  process.stdout.write('所有字段均已被引用。\n');
  process.exit(0);
}

process.stdout.write(`未被引用的字段（${unused.length}）：\n`);
for (const key of unused) process.stdout.write(`  · ${key}\n`);
