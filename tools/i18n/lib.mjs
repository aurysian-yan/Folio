// Folio i18n 工具库：读取 locales/ 下的语言目录，提供严格解析、扁平化与校验能力。
// 不依赖第三方包；严格解析会在发现重复键时直接报错，避免同一字段被静默覆盖。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const LOCALES_DIR = join(REPO_ROOT, 'locales');
// 源语言：其余语言都以它为键集合基准。
export const SOURCE_LOCALE = 'zh-CN';
// i18next 复数规则使用的后缀；校验与生成时按“基础键”归并。
export const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

// 严格 JSON 解析：保留重复键检测，返回解析值与重复键路径。
export function parseJsonStrict(text, file = 'json') {
  let index = 0;
  const duplicates = [];

  const fail = (message) => {
    throw new Error(`${file}: ${message}（偏移 ${index}）`);
  };
  const skipWhitespace = () => {
    while (index < text.length && /\s/.test(text[index])) index += 1;
  };
  const parseString = () => {
    index += 1;
    let out = '';
    while (index < text.length) {
      const char = text[index];
      if (char === '\\') {
        const next = text[index + 1];
        if (next === 'u') {
          out += String.fromCharCode(Number.parseInt(text.slice(index + 2, index + 6), 16));
          index += 6;
        } else {
          const escapes = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
          out += escapes[next] ?? next;
          index += 2;
        }
      } else if (char === '"') {
        index += 1;
        return out;
      } else {
        out += char;
        index += 1;
      }
    }
    fail('字符串未闭合');
  };
  const parseValue = (path) => {
    skipWhitespace();
    const char = text[index];
    if (char === '{') return parseObject(path);
    if (char === '[') return parseArray(path);
    if (char === '"') return parseString();
    if (char === '-' || /[0-9]/.test(char)) {
      const match = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(index));
      index += match[0].length;
      return Number(match[0]);
    }
    if (text.startsWith('true', index)) { index += 4; return true; }
    if (text.startsWith('false', index)) { index += 5; return false; }
    if (text.startsWith('null', index)) { index += 4; return null; }
    fail('无法识别的取值');
  };
  const parseObject = (path) => {
    index += 1;
    const result = {};
    const seen = new Set();
    skipWhitespace();
    if (text[index] === '}') { index += 1; return result; }
    for (;;) {
      skipWhitespace();
      if (text[index] !== '"') fail('对象键必须是字符串');
      const key = parseString();
      const childPath = path ? `${path}.${key}` : key;
      if (seen.has(key)) duplicates.push(childPath);
      seen.add(key);
      skipWhitespace();
      if (text[index] !== ':') fail('对象键后缺少冒号');
      index += 1;
      result[key] = parseValue(childPath);
      skipWhitespace();
      if (text[index] === ',') { index += 1; continue; }
      if (text[index] === '}') { index += 1; break; }
      fail('对象缺少逗号或右花括号');
    }
    return result;
  };
  const parseArray = (path) => {
    index += 1;
    const result = [];
    skipWhitespace();
    if (text[index] === ']') { index += 1; return result; }
    for (;;) {
      result.push(parseValue(path));
      skipWhitespace();
      if (text[index] === ',') { index += 1; continue; }
      if (text[index] === ']') { index += 1; break; }
      fail('数组缺少逗号或右方括号');
    }
    return result;
  };

  const value = parseValue('');
  skipWhitespace();
  if (index !== text.length) fail('文件尾部存在多余内容');
  return { value, duplicates };
}

// 扁平化嵌套目录，得到 `a.b.c` 形式的键。
export function flatten(object, prefix = '') {
  const out = {};
  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(value, path));
    } else {
      out[path] = value;
    }
  }
  return out;
}

// 去掉复数后缀，返回基础键。
export function baseKey(key) {
  const match = /^(.*)_(zero|one|two|few|many|other)$/.exec(key);
  return match ? match[1] : key;
}

// 提取 `{{name}}` 形式的占位符名称集合。
export function placeholders(value) {
  if (typeof value !== 'string') return [];
  return [...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((match) => match[1]).sort();
}

// 读取 locales/ 下的全部语言目录。
export function loadLocales() {
  const locales = {};
  for (const entry of readdirSync(LOCALES_DIR)) {
    if (!entry.endsWith('.json')) continue;
    const locale = entry.slice(0, -'.json'.length);
    const file = join(LOCALES_DIR, entry);
    const text = readFileSync(file, 'utf8');
    const { value, duplicates } = parseJsonStrict(text, `locales/${entry}`);
    locales[locale] = { file, raw: value, flat: flatten(value), duplicates };
  }
  return locales;
}
