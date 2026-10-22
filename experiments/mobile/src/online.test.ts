import assert from 'node:assert/strict';
import test from 'node:test';
import { createOnlineClient, onlineErrorKey, type OnlineBridge } from './online.ts';

test('在线服务保留原生任务状态和压缩包选择标识', async () => {
  const calls: unknown[] = [];
  const bridge = {
    onlineState: async () => JSON.stringify({ accepted: true, providers: [], jobs: [{ id: 'job', state: 'ready', bytesDone: 12, bytesTotal: 12 }] }),
    onlineInspect: async () => JSON.stringify([{ id: '7', name: 'font.ttf', eligible: true, duplicate: false }]),
    onlineImport: async (id: string, selected: string[]) => { calls.push([id, selected]); return { snapshot: {}, items: [] }; },
  } as unknown as OnlineBridge;
  const client = createOnlineClient(bridge);
  assert.equal((await client.state()).jobs[0]?.bytesTotal, 12);
  assert.equal((await client.inspect('job'))[0]?.id, '7');
  await client.collect('job', ['7']); assert.deepEqual(calls, [['job', ['7']]]);
});

test('错误显示只使用本地化键', () => {
  assert.equal(onlineErrorKey(new Error('native: online.browser.expiredLink')), 'online.browser.expiredLink');
  assert.equal(onlineErrorKey(new Error('https://example.com/?token=secret')), 'common.operationFailed');
});

test('自定义图标保留资源标识与缓存地址，来源保存保留选择', async () => {
  let saved = '';
  const icon = { assetId: 'a'.repeat(64), uri: 'file:///private/online-icons/icon.png' };
  const bridge = {
    onlineImportIcon: async (uri: string) => { assert.equal(uri, 'content://picked/image'); return JSON.stringify(icon); },
    onlineSaveProviders: async (value: string) => { saved = value; },
  } as unknown as OnlineBridge;
  const client = createOnlineClient(bridge);
  assert.deepEqual(await client.importIcon('content://picked/image'), icon);
  await client.saveProviders([{ id: 'source', name: '字体来源', homepage: 'https://example.com/', searchTemplate: 'https://example.com/?q={{query}}', builtin: false, enabled: true,
    icon: { kind: 'custom', assetId: icon.assetId }, iconUri: icon.uri }]);
  assert.equal(JSON.parse(saved)[0].icon.assetId, icon.assetId);
});
