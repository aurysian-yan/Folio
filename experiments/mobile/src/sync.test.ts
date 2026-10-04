import assert from 'node:assert/strict';
import test from 'node:test';
import { canReuseSyncPassword, createSyncClient, maskedSyncAccount, matchingWebdavPreset, syncErrorKey, validateProfile, webdavPresets, webdavSourceName, type SyncBridge, type SyncState } from './sync.ts';

const profile = { serverUrl: 'https://dav.example.test/', remoteDirectory: 'Fonts', username: 'user', automatic: true };
test('服务商预设使用桌面 WebDAV 地址，识别尾斜线并保留自定义地址', () => {
  assert.deepEqual(webdavPresets.map((preset) => preset.url), ['', 'https://webdav.123pan.cn/webdav', 'https://dav.jianguoyun.com/dav']);
  assert.equal(matchingWebdavPreset(' HTTPS://WEBDAV.123PAN.CN/webdav/ '), 'pan123');
  assert.equal(matchingWebdavPreset('https://dav.jianguoyun.com/dav/'), 'jianguoyun');
  assert.equal(matchingWebdavPreset(profile.serverUrl), 'none');
  assert.equal(profile.serverUrl, 'https://dav.example.test/');
});
test('来源按准确域名识别，不受路径影响，也不把仿冒子域名识别为预设', () => {
  assert.equal(matchingWebdavPreset('https://WEBDAV.123PAN.CN/custom/fonts'), 'pan123');
  assert.equal(webdavSourceName('https://dav.jianguoyun.com/custom/', (key) => key), 'macos.providerJianguoyun');
  assert.equal(matchingWebdavPreset('https://dav.jianguoyun.com.example.test/dav'), 'none');
  assert.equal(webdavSourceName('https://custom.example.test/fonts/', (key) => key), 'custom.example.test');
  assert.equal(webdavSourceName('', (key) => key), '');
});
test('概览账号打码覆盖空账号、短账号、邮箱与 Unicode 字符', () => {
  assert.equal(maskedSyncAccount(''), '');
  assert.equal(maskedSyncAccount('ab'), '••••');
  assert.equal(maskedSyncAccount('用户账号'), '••••');
  assert.equal(maskedSyncAccount('user@example.com'), 'us••••m');
  assert.equal(maskedSyncAccount('😀abcdef'), '😀a••••f');
});
const state: SyncState = { profile, credentialAvailable: true, credentialError: false,
  status: { phase: '待同步', stage: '待同步', percent: 0, stageCompleted: 0, stageTotal: 0, isRunning: false,
    uploadedFiles: 0, downloadedFiles: 0, uploadedBytes: 0, downloadedBytes: 0, completionGeneration: 0,
    lastSyncedAtMs: null, errorMessage: null, items: [] }, fonts: [], conflicts: [] };
function bridge(): SyncBridge {
  return { syncState: async () => state, testSyncConnection: async () => undefined,
    saveSyncConnection: async () => undefined, disconnectSync: async () => undefined,
    startSync: async () => true, cancelSync: async () => undefined, cloudFontAction: async () => undefined, resolveSyncConflict: async () => undefined };
}
test('连接验证拒绝 HTTP、内嵌凭据与目录穿越，不向原生发送密码', () => {
  for (const serverUrl of ['http://dav.example.test', 'https://user:secret@dav.example.test', 'invalid', 'https://dav.example.test/?password=secret']) {
    assert.throws(() => validateProfile({ ...profile, serverUrl }), /ERR_FOLIO_PROFILE/);
  }
  assert.throws(() => validateProfile({ ...profile, remoteDirectory: 'Fonts/../Other' }));
});
test('空密码由安全存储恢复，配置中没有密码字段', async () => {
  const native = bridge();
  native.saveSyncConnection = async (received, password) => {
    assert.deepEqual(received, profile); assert.equal(password, null);
    assert.equal('password' in received, false);
  };
  await createSyncClient(native).save(profile, '');
});
test('向导只在原地址、目录和账号下复用凭据，切换自动同步不要求重输密码', () => {
  assert.equal(canReuseSyncPassword({ ...profile, automatic: false }, profile, true), true);
  assert.equal(canReuseSyncPassword({ ...profile, serverUrl: ' https://dav.example.test ', username: ' user ', remoteDirectory: ' Fonts ' }, profile, true), true);
  assert.equal(canReuseSyncPassword(profile, null, true), false);
  assert.equal(canReuseSyncPassword(profile, profile, false), false);
  for (const changed of [{ serverUrl: 'https://other.example.test/' }, { remoteDirectory: 'Other' }, { username: 'other' }, { serverUrl: 'invalid' }]) {
    assert.equal(canReuseSyncPassword({ ...profile, ...changed }, profile, true), false);
  }
});
test('手动同步与真正取消直接调用原生，状态读取失败不会伪造未连接', async () => {
  const native = bridge();
  let cancelled = 0;
  native.cancelSync = async () => { cancelled++; };
  const client = createSyncClient(native);
  assert.equal(await client.state(), state);
  assert.equal(await client.start(), true);
  await client.cancel(); assert.equal(cancelled, 1);
  native.syncState = async () => { throw new Error('read failed'); };
  await assert.rejects(client.state(), /read failed/);
});
test('认证与安全存储错误明确呈现，不向用户显示凭据或底层异常', () => {
  assert.equal(syncErrorKey(new Error('WebDAV 认证失败，请检查账号和密码')), 'mobile.sync.authenticationError');
  assert.equal(syncErrorKey(new Error('ERR_FOLIO_CREDENTIALS')), 'cloud.passwordUnavailable');
  assert.equal(syncErrorKey(new Error('secret internal failure')), 'mobile.sync.operationError');
});
