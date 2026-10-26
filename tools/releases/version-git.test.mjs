import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { commitVersionGit, prepareVersionGit } from './version-git.mjs';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'folio-version-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const remote = join(directory, 'origin.git');
  const root = join(directory, 'work');
  mkdirSync(root);
  git(directory, 'init', '--bare', '--initial-branch=main', remote);
  git(root, 'init', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Folio Test');
  git(root, 'config', 'user.email', 'folio-test@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'config', 'tag.gpgsign', 'false');
  git(root, 'config', 'core.hooksPath', join(root, '.git/hooks'));
  writeFileSync(join(root, 'version.json'), '1.0.0\n');
  writeFileSync(join(root, 'feature.txt'), 'original\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'chore: 初始化测试仓库');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-u', 'origin', 'main');
  const initial = git(root, 'rev-parse', 'HEAD');
  return { directory, root, remote, initial };
}

function changeVersion(root) {
  writeFileSync(join(root, 'version.json'), '1.0.1\n');
}

test('发布同时推送已有功能提交、版本提交和目标标签，不推送其他本地标签', (t) => {
  const { root, remote } = fixture(t);
  writeFileSync(join(root, 'feature.txt'), 'committed feature\n');
  git(root, 'add', 'feature.txt');
  git(root, 'commit', '-m', 'feat: 完成功能');
  const feature = git(root, 'rev-parse', 'HEAD');
  git(root, 'tag', '-a', 'unrelated', '-m', '其他标签');
  git(root, 'config', 'push.followTags', 'true');
  const release = prepareVersionGit(root, 'v1.0.1');
  changeVersion(root);
  const commit = commitVersionGit(root, release, ['version.json', 'version.json']);
  assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), commit);
  assert.equal(git(remote, 'rev-parse', 'refs/tags/v1.0.1'), commit);
  assert.equal(git(root, 'rev-parse', 'HEAD^'), feature);
  assert.equal(git(remote, 'show', 'main:feature.txt'), 'committed feature');
  assert.equal(git(remote, 'show', 'main:version.json'), '1.0.1');
  assert.equal(git(remote, 'tag', '--list'), 'v1.0.1');
  assert.equal(git(root, 'status', '--porcelain'), '');
  assert.equal(git(root, 'log', '-1', '--format=%s'), 'chore: 发布 v1.0.1');
});

test('发布使用当前分支，不硬编码 main', (t) => {
  const { root, remote, initial } = fixture(t);
  git(root, 'switch', '-c', 'release/next');
  const release = prepareVersionGit(root, 'v1.0.1');
  changeVersion(root);
  const commit = commitVersionGit(root, release, ['version.json']);
  assert.equal(git(remote, 'rev-parse', 'refs/heads/release/next'), commit);
  assert.equal(git(remote, 'rev-parse', 'refs/tags/v1.0.1'), commit);
  assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), initial);
});

test('未提交、已暂存或未跟踪的改动在写入版本前被拒绝', (t) => {
  const { root, remote, initial } = fixture(t);
  writeFileSync(join(root, 'feature.txt'), 'pending\n');
  assert.throws(() => prepareVersionGit(root, 'v1.0.1'), /未提交/);
  git(root, 'add', 'feature.txt');
  assert.throws(() => prepareVersionGit(root, 'v1.0.1'), /未提交/);
  git(root, 'reset', '--hard', 'HEAD');
  writeFileSync(join(root, 'pending.txt'), 'pending\n');
  assert.throws(() => prepareVersionGit(root, 'v1.0.1'), /未提交/);
  assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), initial);
  assert.equal(git(root, 'tag', '--list'), '');
});

test('拒绝游离检出、本地已有标签和仅远端已有的标签', (t) => {
  const { root } = fixture(t);
  git(root, 'checkout', '--detach');
  assert.throws(() => prepareVersionGit(root, 'v1.0.1'), /未检出分支/);
  git(root, 'switch', 'main');
  git(root, 'tag', 'v1.0.1');
  assert.throws(() => prepareVersionGit(root, 'v1.0.1'), /本地标签/);
  git(root, 'push', 'origin', 'refs/tags/v1.0.1');
  git(root, 'tag', '-d', 'v1.0.1');
  assert.throws(() => prepareVersionGit(root, 'v1.0.1'), /远端标签/);
  assert.throws(() => prepareVersionGit(root, 'invalid'), /vX.Y.Z/);
});

test('远端拒绝时分支和标签均不更新，本地提交与标签可按原子命令重试', (t) => {
  const { root, remote, initial } = fixture(t);
  const release = prepareVersionGit(root, 'v1.0.1');
  changeVersion(root);
  const hook = join(remote, 'hooks/pre-receive');
  writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  assert.throws(() => commitVersionGit(root, release, ['version.json']), /git push --atomic --no-follow-tags origin/);
  const commit = git(root, 'rev-parse', 'HEAD');
  assert.notEqual(commit, initial);
  assert.equal(git(root, 'rev-parse', 'refs/tags/v1.0.1'), commit);
  assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), initial);
  assert.equal(git(remote, 'tag', '--list'), '');
  rmSync(hook);
  git(root, 'push', '--atomic', '--no-follow-tags', 'origin', `${commit}:refs/heads/main`, 'refs/tags/v1.0.1:refs/tags/v1.0.1');
  assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), commit);
  assert.equal(git(remote, 'rev-parse', 'refs/tags/v1.0.1'), commit);
});

test('远端分支已有新提交时禁止单独推送标签，不覆盖远端历史', (t) => {
  const { root, remote } = fixture(t);
  const release = prepareVersionGit(root, 'v1.0.1');
  writeFileSync(join(root, 'remote.txt'), 'remote change\n');
  git(root, 'add', 'remote.txt');
  git(root, 'commit', '-m', 'feat: 更新远端');
  git(root, 'push', 'origin', 'main');
  const remoteCommit = git(remote, 'rev-parse', 'refs/heads/main');
  git(root, 'reset', '--hard', 'HEAD^');
  changeVersion(root);
  assert.throws(() => commitVersionGit(root, release, ['version.json']), /本地提交与标签/);
  assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), remoteCommit);
  assert.equal(git(remote, 'tag', '--list'), '');
});

test('验证期间切换分支或暂存其他文件时不创建发布提交与标签', (t) => {
  const { root, initial } = fixture(t);
  const release = prepareVersionGit(root, 'v1.0.1');
  git(root, 'switch', '-c', 'other');
  assert.throws(() => commitVersionGit(root, release, ['version.json']), /分支已改变/);
  git(root, 'switch', 'main');
  changeVersion(root);
  writeFileSync(join(root, 'feature.txt'), 'other staged change\n');
  git(root, 'add', 'feature.txt');
  assert.throws(() => commitVersionGit(root, release, ['version.json']), /暂存区/);
  assert.equal(git(root, 'rev-parse', 'HEAD'), initial);
  assert.equal(git(root, 'tag', '--list'), '');
});
