import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { aggregate, publish, stage, targets, verifyRelease, verifyVersions } from './release.mjs';
const version = verifyVersions();
test('标签必须与全部客户端版本一致', () => {
  assert.equal(verifyVersions(`v${version}`),version);
  assert.throws(() => verifyVersions('v999.999.999'));
});
function releaseFixture(callback) {
  const root = mkdtempSync(join(tmpdir(),'folio-publish-'));
  try {
    const input = join(root,'input'); mkdirSync(input);
    for (const [platform,arch,formats] of targets) for (const format of formats) writeFileSync(join(input,`Folio-v${version}-${platform}-${arch}.${format}`),`${platform}-${arch}-${format}`);
    const output = join(root,'output'); aggregate(input,output);
    callback(output);
  } finally { rmSync(root,{recursive:true,force:true}); }
}
const env = { GITHUB_REF_NAME: `v${version}`, GITHUB_REPOSITORY: 'aurysian-yan/Folio', GITHUB_SHA: 'a'.repeat(40) };
function githubFixture(directory, { existing, incomplete = false, corruptDigest = false, failUpload = false, apiError = '404' } = {}) {
  const calls = []; let listed = 0;
  const exec = (command, args, options) => {
    assert.equal(command,'gh'); calls.push(args);
    if (args[0] === 'api' && args[1] === '--paginate') {
      listed += 1;
      if (listed === 1) {
        if (apiError !== '404') throw Object.assign(new Error('API error'),{stderr:apiError});
        return JSON.stringify([existing ? [existing] : []]);
      }
      const assets = verifyRelease(directory).map((name) => {
        const bytes = readFileSync(join(directory,name));
        return {name,size:bytes.length,digest:`sha256:${createHash('sha256').update(bytes).digest('hex')}`};
      });
      if (incomplete) assets.pop();
      if (corruptDigest) assets[0].digest = `sha256:${'0'.repeat(64)}`;
      return JSON.stringify([[{id:1,draft:true,tag_name:env.GITHUB_REF_NAME,assets}]]);
    }
    if (args[0] === 'api' && args[1] === '-X') {
      assert.equal(args[2],'PATCH');
      assert.ok(args.includes('draft=false'));
      return JSON.stringify({id:1,draft:false,tag_name:env.GITHUB_REF_NAME});
    }
    if (args[1] === 'create') {
      assert.ok(options.input.includes(`<!-- folio-release:${env.GITHUB_SHA} -->`));
      assert.ok(!args.includes('--target'));
    }
    if (args[1] === 'upload') {
      assert.ok(args.includes('--clobber'));
      const files = args.filter((arg) => arg.startsWith(directory));
      assert.equal(files.length,14);
      assert.ok(files.every((file) => basename(file) !== 'release-notes.md'));
      if (failUpload) throw new Error('上传中断');
    }
    return '';
  };
  return {calls,exec};
}
test('完整附件通过远端哈希校验后才公开发行版', () => releaseFixture((directory) => {
  const {calls,exec} = githubFixture(directory);
  publish(directory,{env,exec});
  assert.deepEqual(calls.filter((args) => args[0] === 'release').map((args) => args[1]),['create','upload']);
  const create = calls.find((args) => args[1] === 'create');
  assert.ok(create.includes(env.GITHUB_REF_NAME));
  assert.ok(!create.includes('--target'));
  assert.ok(calls.at(-1).includes('draft=false'));
}));
test('附件损坏、缺失或混入额外文件时禁止调用发布接口', () => {
  for (const mode of ['corrupt','missing','extra']) releaseFixture((directory) => {
    const name = join(directory,`Folio-v${version}-macos-arm64.dmg`);
    if (mode === 'corrupt') writeFileSync(name,'损坏内容');
    if (mode === 'missing') rmSync(name);
    if (mode === 'extra') writeFileSync(join(directory,'extra.apk'),'额外附件');
    const {calls,exec} = githubFixture(directory);
    assert.throws(() => publish(directory,{env,exec}));
    assert.equal(calls.length,0);
  });
});
test('上传中断、远端附件缺失或哈希不一致时保留草稿，不公开发行版', () => {
  for (const options of [{failUpload:true},{incomplete:true},{corruptDigest:true}]) releaseFixture((directory) => {
    const {calls,exec} = githubFixture(directory,options);
    assert.throws(() => publish(directory,{env,exec}));
    assert.ok(!calls.some((args) => args[1] === '-X'));
  });
});
test('同一提交的失败草稿可补传并完成发布', () => releaseFixture((directory) => {
  const existing = {id:1,draft:true,tag_name:env.GITHUB_REF_NAME,target_commitish:env.GITHUB_SHA,body:`<!-- folio-release:${env.GITHUB_SHA} -->`,assets:[]};
  const {calls,exec} = githubFixture(directory,{existing});
  publish(directory,{env,exec});
  assert.deepEqual(calls.filter((args) => args[0] === 'release').map((args) => args[1]),['upload']);
  assert.ok(calls.at(-1).includes('draft=false'));
}));
test('不覆盖正式发行版、其他提交的草稿或含未知附件的草稿', () => {
  const draft = {draft:true,tag_name:env.GITHUB_REF_NAME,target_commitish:env.GITHUB_SHA,body:`<!-- folio-release:${env.GITHUB_SHA} -->`,assets:[]};
  for (const existing of [{...draft,draft:false},{...draft,target_commitish:'b'.repeat(40)},{...draft,body:''},{...draft,assets:[{name:'unknown.apk'}]}]) releaseFixture((directory) => {
    const {calls,exec} = githubFixture(directory,{existing});
    assert.throws(() => publish(directory,{env,exec}));
    assert.ok(calls.every((args) => args[0] === 'api'));
  });
});
test('发布状态查询失败时禁止新建发行版', () => releaseFixture((directory) => {
  const {calls,exec} = githubFixture(directory,{apiError:'403 Forbidden'});
  assert.throws(() => publish(directory,{env,exec}),/无法确认发行版状态/);
  assert.equal(calls.length,1);
}));
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
