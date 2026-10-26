import assert from 'node:assert/strict';
import test from 'node:test';
import { importFamilies, importSelection, isVariableEntry } from './online-import.ts';
import type { OnlineEntry } from './online.ts';

function entry(id: string, family: string | null, isVariable = false, weight = 400): OnlineEntry {
  return { id, name: `${id}.ttf`, size: 100, eligible: true, duplicate: false,
    analysis: { fingerprint: id, faces: [{ family, style: String(weight), faceIndex: 0, isVariable, weight, duplicate: false, conflict: false }] } };
}

test('默认只选可变字体，快速选择排除无效及重复文件并保留不同修订', () => {
  const entries = [entry('variable', 'Inter', true), entry('regular', 'Inter'), entry('bold', 'Inter', false, 700),
    { ...entry('duplicate', 'Inter', true), duplicate: true }, { ...entry('bad', 'Inter', true), eligible: false }];
  entries[0]!.analysis!.faces[0]!.conflict = true;
  assert.deepEqual(importSelection(entries, 'variable'), ['variable']);
  assert.deepEqual(importSelection(entries, 'static'), ['regular', 'bold']);
  assert.deepEqual(importSelection(entries, 'all'), ['variable', 'regular', 'bold']);
  assert.deepEqual(importSelection(entries, 'none'), []);
  assert.deepEqual(importSelection([entry('static-only', 'Lato')], 'variable'), []);
});

test('按字体元数据归并字族与字重，不依赖压缩包目录或文件名称', () => {
  const entries = [entry('Thin', 'Roboto', false, 100), entry('Bold', 'Roboto', false, 700),
    entry('variable', 'Roboto', true), entry('Regular', 'Open Sans')];
  entries[2]!.name = 'Roboto-Italic.ttf';
  entries[1]!.name = 'unrelated/path.ttf';
  const groups = importFamilies(entries);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.find((group) => group.name === 'Roboto')?.entries.map((value) => value.id), ['variable', 'Thin', 'Bold']);
  assert.equal(isVariableEntry(entries[2]!), true);
  assert.deepEqual(entries.map((value) => value.id), ['Thin', 'Bold', 'variable', 'Regular']);
});

test('多字族集合按整文件分组，无分析结果的同名文件保持独立', () => {
  const collection = entry('collection', 'Inter');
  collection.analysis!.faces.push({ ...entry('other', 'Noto Sans', true).analysis!.faces[0]!, faceIndex: 1 });
  const broken = { id: 'bad', name: 'broken.ttf', size: 1, eligible: false, duplicate: false };
  const groups = importFamilies([collection, broken, { ...broken, id: 'bad2' }]);
  assert.equal(groups.length, 3);
  assert.equal(groups.find((group) => group.entries[0]?.id === 'collection')?.name, 'Inter / Noto Sans');
  assert.deepEqual(importSelection([collection], 'variable'), ['collection']);
  assert.deepEqual(importFamilies([entry('nameless', null)])[0]?.name, 'nameless.ttf');
});
