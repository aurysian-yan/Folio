import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { aggregate, stage, targets, verifyVersions } from './release.mjs';
const version = verifyVersions();
test('标签必须与全部客户端版本一致', () => {
  assert.equal(verifyVersions(`v${version}`),version);
  assert.throws(() => verifyVersions('v999.999.999'));
});
test('全部原生产物齐全后才生成清单，哈希对应文件原文', () => {
  const root = mkdtempSync(join(tmpdir(),'folio-release-'));
  try {
    const input = join(root,'input'); mkdirSync(input);
    const first = `Folio-v${version}-macos-arm64.dmg`;
    for (const [platform,arch,formats] of targets) for (const format of formats) writeFileSync(join(input,`Folio-v${version}-${platform}-${arch}.${format}`),`${platform}-${arch}-${format}`);
    const manifest = aggregate(input,join(root,'output'));
    assert.equal(manifest.artifacts.length,10);
    for (const artifact of manifest.artifacts) assert.equal(artifact.sha256,createHash('sha256').update(readFileSync(join(input,artifact.url.split('/').at(-1)))).digest('hex'));
    rmSync(join(input,first)); assert.throws(() => aggregate(input,join(root,'failed')));
  } finally { rmSync(root,{recursive:true,force:true}); }
});
test('拒绝将同扩展名的错误页面作为安装包', () => {
  const root = mkdtempSync(join(tmpdir(),'folio-release-'));
  try { writeFileSync(join(root,'wrong.exe'),'<!DOCTYPE html>'); assert.throws(() => stage('windows','arm64',root,join(root,'output'))); }
  finally { rmSync(root,{recursive:true,force:true}); }
});
