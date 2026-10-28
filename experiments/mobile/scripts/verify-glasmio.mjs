import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../vendor/glasmio');
const manifest = JSON.parse(readFileSync(join(root, 'upstream.json'), 'utf8'));
const hash = (data) => createHash('sha256').update(data).digest('hex');
assert.match(manifest.commit, /^[a-f0-9]{40}$/);
for (const [path, original] of Object.entries(manifest.files)) {
  assert.equal(hash(readFileSync(join(root, path))), manifest.patchedFiles[path] ?? original, `源码校验失败：${path}`);
}
for (const [path, checksum] of Object.entries(manifest.patches)) {
  assert.equal(hash(readFileSync(join(root, path))), checksum, `补丁校验失败：${path}`);
}
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  assert.deepEqual(readFileSync(join(root, name)), readFileSync(join(root, 'legal/META-INF/glasmio', name)));
}
for (const name of ['core', 'glass', 'icons', 'ui']) {
  for (const file of readdirSync(join(root, `glasmio-${name}/src`), { recursive: true, withFileTypes: true })) {
    if (!file.isFile()) continue;
    const path = join(file.parentPath, file.name).slice(root.length + 1);
    assert.ok(manifest.files[path], `来源未登记：${path}`);
    assert.ok(!manifest.excluded.some((excluded) => path.startsWith(excluded)), `导入了排除项：${path}`);
  }
}
// 可选上游目录用于完整重放补丁，避免仅凭本地哈希确认迁移。
if (process.argv[2]) {
  const upstream = resolve(process.argv[2]);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim(), manifest.commit);
  const staged = mkdtempSync(join(tmpdir(), 'folio-glasmio-verify-'));
  try {
    for (const [path, checksum] of Object.entries(manifest.files)) {
      const data = readFileSync(join(upstream, path));
      assert.equal(hash(data), checksum, `上游校验失败：${path}`);
      mkdirSync(dirname(join(staged, path)), { recursive: true });
      writeFileSync(join(staged, path), data);
    }
    for (const path of Object.keys(manifest.patches)) {
      execFileSync('patch', ['-p1', '--fuzz=0'], { cwd: staged, input: readFileSync(join(root, path)), stdio: ['pipe', 'pipe', 'pipe'] });
    }
    for (const [path, original] of Object.entries(manifest.files)) {
      assert.equal(hash(readFileSync(join(staged, path))), manifest.patchedFiles[path] ?? original, `补丁重放失败：${path}`);
    }
  } finally { rmSync(staged, { recursive: true, force: true }); }
}
console.log(`Glasmio ${manifest.commit}：${Object.keys(manifest.files).length} 项来源与 ${Object.keys(manifest.patches).length} 项补丁校验通过`);
