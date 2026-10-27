import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectCommits, fallbackNotes, generateNotes, previousRelease, splitInputs, summarizeCommits, validateNotes } from './notes.mjs';
const notes = { 'zh-CN': '### 修复\n\n修复字体预览。', en: '### Fixes\n\nFix font previews.' };
const commits = [{ sha: 'a'.repeat(40), subject: 'fix: 修复预览', body: '修复字体预览异常', paths: ['experiments/mobile/src/Preview.tsx'] }];
const env = { RELEASE_LLM_API_KEY: 'private-key', RELEASE_LLM_BASE_URL: 'https://example.com/v1/', RELEASE_LLM_MODEL: 'custom-model' };
test('兼容调用只发送供应商模型、对话和非流式选项', async () => {
  const result = await summarizeCommits(commits, { env, request: async (url, options) => {
    assert.equal(url.toString(), 'https://example.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer private-key');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'custom-model'); assert.equal(body.stream, false);
    assert.equal(body.messages.length, 2); assert.match(body.messages[1].content, /修复预览/);
    assert.equal(body.temperature, undefined);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(notes) } }] });
  } });
  assert.deepEqual(result, notes);
});
test('缺少配置不调用模型，限流有限重试，格式错误和失败交给兜底', async () => {
  assert.equal(await summarizeCommits(commits, { env: {}, request: () => assert.fail() }), undefined);
  let calls = 0;
  const result = await summarizeCommits(commits, { env, retryDelay: 0, request: async () => ++calls < 3 ? new Response('', { status: 429 }) : Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(notes) } }] }) });
  assert.deepEqual(result, notes); assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(summarizeCommits(commits, { env, retryDelay: 0, request: async () => { calls++; return Response.json({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }); } }));
  assert.equal(calls, 3);
  await assert.rejects(summarizeCommits(commits, { env: { ...env, RELEASE_LLM_BASE_URL: 'http://example.com' } }));
  assert.throws(() => validateNotes({ 'zh-CN': '', en: 'x' }));
});
test('分批完整保留超长单提交与所有尾部记录，汇总最终双语日志', async () => {
  const input = [...commits, { ...commits[0], body: '😀'.repeat(30_000) }];
  const chunks = splitInputs(input, 1000);
  assert.equal(chunks.join(''), input.map((item) => JSON.stringify(item)).join('\n'));
  let count = 0;
  await summarizeCommits(input, { env, request: async () => { count++; return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(notes) } }] }); } });
  assert.ok(count > 3);
});
test('兜底使用中英标题和原始提交，不假冒翻译', () => {
  const result = fallbackNotes([...commits, ...commits], 'v1.2.2', 'v1.2.1');
  assert.match(result.en, /### Fixes/); assert.match(result.en, /fix: 修复预览/);
  assert.equal(result.en.match(/fix: 修复预览/g).length, 1);
  assert.match(result['zh-CN'], /v1.2.1\.\.\.v1.2.2/);
});
function history(run) {
  const cwd = mkdtempSync(join(tmpdir(), 'folio-notes-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  try {
    git('init', '-b', 'main'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'test');
    const commit = (name) => { writeFileSync(join(cwd, 'file'), name); git('add', '.'); git('commit', '-m', name); return git('rev-parse', 'HEAD'); };
    const first = commit('feat: 首次提交'); git('tag', 'v1.0.0');
    commit('fix: 上次更新'); git('tag', 'v1.1.0');
    const head = commit('fix: 当前更新'); git('tag', 'v1.2.0');
    return run({ cwd, git, commit, first, head });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}
test('基线只选择已公开祖先版本，忽略失败标签、草稿、预发行及当前提交', () => history(({ cwd, head, git, first }) => {
  git('tag', 'v1.1.1');
  const published = [{ tag_name: 'v1.0.0', draft: false }, { tag_name: 'v1.1.0', draft: true }, { tag_name: 'v1.1.1', draft: false }, { tag_name: 'v1.2.0', draft: false }, { tag_name: 'v0.9.0', prerelease: true }];
  assert.equal(previousRelease(published, head, { cwd }), 'v1.0.0');
  assert.equal(collectCommits(head, 'v1.0.0', { cwd }).length, 2);
  assert.equal(collectCommits(head, undefined, { cwd }).length, 3);
  assert.equal(collectCommits(first, undefined, { cwd }).length, 1);
}));
test('模型不可用仍写出日志，同一提交草稿重试复用既有日志', async () => {
  // 异步调用须在临时目录清理前完成。
  const cwd = mkdtempSync(join(tmpdir(), 'folio-notes-generate-'));
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd });
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'feat: 新功能'], { cwd });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    const output = join(cwd, 'notes.json');
    const baseEnv = { GITHUB_SHA: head, GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.0.0' };
    const generated = await generateNotes(output, { cwd, env: baseEnv, exec: () => JSON.stringify([[]]) });
    assert.match(generated.en, /新功能/);
    const body = `<!-- folio-release:${head} -->\n<!-- folio-notes:start -->\n${JSON.stringify(notes)}\n<!-- folio-notes:end -->`;
    const draft = { tag_name: 'v1.0.0', draft: true, body, assets: [] };
    assert.deepEqual(await generateNotes(output, { cwd, env: baseEnv, exec: () => JSON.stringify([[draft]]) }), notes);
    await assert.rejects(generateNotes(output, { cwd, env: baseEnv, exec: () => JSON.stringify([[{ ...draft, body: '' }]]) }));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
