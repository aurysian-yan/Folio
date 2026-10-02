import assert from 'node:assert/strict';
import test from 'node:test';
import { ForegroundSyncSession } from './sync-session.ts';
import type { SyncState } from './sync.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise<void>((done) => setImmediate(done)); };
function setup(automatic = false) {
  const state: SyncState = { profile: { serverUrl: 'https://example.test', remoteDirectory: '', username: '', automatic },
    credentialAvailable: true, credentialError: false, fonts: [], conflicts: [],
    status: { phase: '待同步', stage: '', percent: 0, stageCompleted: 0, stageTotal: 0, isRunning: false,
      uploadedFiles: 0, downloadedFiles: 0, uploadedBytes: 0, downloadedBytes: 0, completionGeneration: 0,
      lastSyncedAtMs: null, errorMessage: null, items: [] } };
  let starts = 0; let cancels = 0; let snapshots = 0;
  const client = { state: async () => structuredClone(state), start: async () => { starts++; state.status.isRunning = true; return true; },
    cancel: async () => { cancels++; } };
  const session = new ForegroundSyncSession(client, async () => ++snapshots);
  return { state, client, session, counts: () => ({ starts, cancels, snapshots }) };
}
test('前台自动补同步，重复开始与连接操作共用运行锁，后台实际取消', async () => {
  const { session, counts } = setup(true);
  session.setActive(true); await settle();
  assert.equal(counts().starts, 1);
  assert.equal(await session.start(), false);
  assert.equal(await session.run(async () => assert.fail('运行中不允许编辑连接')), false);
  session.setActive(false); await settle();
  assert.equal(counts().cancels, 1);
});
test('成功、取消和部分失败完成后都重新读取真实快照', async () => {
  for (const phase of ['已同步', '已取消', '同步失败']) {
    const { session, state, counts } = setup();
    session.setActive(true); await settle();
    await session.start();
    state.status.isRunning = false; state.status.phase = phase; state.status.completionGeneration++;
    await session.refresh();
    assert.equal(counts().snapshots, 2);
    assert.equal(session.view.state?.status.phase, phase);
    session.setActive(false);
  }
});
test('生命周期切换丢弃迟到状态和快照，恢复后再读取', async () => {
  const { session, client, state } = setup();
  const late = deferred<SyncState>(); client.state = () => late.promise;
  let published = 0;
  session.subscribe((_view, snapshot) => { if (snapshot !== undefined) published++; });
  session.setActive(true); session.setActive(false);
  late.resolve(structuredClone(state)); await settle();
  assert.equal(published, 0); assert.equal(session.view.state, null);
  client.state = async () => structuredClone(state);
  session.setActive(true); await settle();
  assert.equal(published, 1); session.setActive(false);
});
test('开始同步时丢弃已在途的空闲快照，再读真实运行状态', async () => {
  const { session, state, client, counts } = setup();
  session.setActive(true); await settle();
  const late = deferred<SyncState>(); const old = structuredClone(state);
  let first = true;
  client.state = () => { if (first) { first = false; return late.promise; } return Promise.resolve(structuredClone(state)); };
  const polling = session.refresh();
  const start = session.start(); late.resolve(old);
  await Promise.all([polling, start]);
  assert.equal(session.view.state?.status.isRunning, true);
  assert.equal(counts().snapshots, 1); assert.equal(session.blocked, true);
  session.setActive(false);
});
test('同步中收藏意图按顺序保留，导入暂停，结束后只补一轮', async () => {
  const { session, state, counts } = setup(true);
  session.setActive(true); await settle();
  await assert.rejects(session.mutate(async () => undefined, 'import'), /ERR_FOLIO_BUSY/);
  const writes: boolean[] = [];
  const first = session.mutate(async () => { writes.push(true); });
  const second = session.mutate(async () => { writes.push(false); });
  assert.deepEqual(writes, []);
  state.status.isRunning = false; state.status.phase = '已同步'; state.status.completionGeneration++;
  await Promise.all([first, second]); assert.deepEqual(writes, [true, false]);
  assert.equal(counts().starts, 1);
  session.setActive(false); session.setActive(true); await settle();
  assert.equal(counts().starts, 2); session.setActive(false);
});
test('本地写入使旧轮询快照失效，写入失败不阻塞后续操作', async () => {
  const { session, state, client } = setup();
  session.setActive(true); await settle();
  const late = deferred<SyncState>(); client.state = () => late.promise;
  const reading = session.refresh();
  const failed = session.mutate(async () => { throw new Error('write failed'); });
  late.resolve(structuredClone(state)); await reading;
  await assert.rejects(failed, /write failed/);
  client.state = async () => structuredClone(state);
  assert.equal(await session.mutate(async () => 'retained'), 'retained');
  session.setActive(false);
});
test('用户取消后不立即自动重启，新变更或恢复前台才重试', async () => {
  const { session, state, counts } = setup(true);
  session.setActive(true); await settle(); await session.cancel();
  state.status.isRunning = false; state.status.phase = '已取消'; state.status.completionGeneration++;
  await session.refresh(); assert.equal(counts().starts, 1);
  session.setActive(false); session.setActive(true); await settle();
  assert.equal(counts().starts, 2); session.setActive(false);
});
test('前台合并连续本地变更，只启动下一轮，后台定时器停止', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const { session, state, counts } = setup(true);
  session.setActive(true); await settle();
  state.status.isRunning = false; state.status.phase = '已同步'; state.status.completionGeneration++;
  await session.refresh();
  await Promise.all([session.mutate(async () => 'favorite'), session.mutate(async () => 'recent')]);
  t.mock.timers.tick(1500); await settle();
  assert.equal(counts().starts, 2);
  t.mock.timers.tick(1500); await settle();
  assert.equal(counts().starts, 2);
  session.setActive(false); t.mock.timers.tick(60000); await settle();
  assert.equal(counts().starts, 2);
});
test('系统选择器返回前台时保留导入任务门，导入结束后再补同步', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const { session, state, counts } = setup(true);
  session.setActive(true); await settle();
  state.status.isRunning = false; state.status.phase = '已同步'; state.status.completionGeneration++;
  await session.refresh();
  const release = session.reserveImport(); assert.ok(release);
  session.setActive(false); session.setActive(true); await settle();
  assert.equal(counts().starts, 1);
  assert.equal(await session.mutate(async () => 'imported', 'import'), 'imported');
  t.mock.timers.tick(1500); await settle(); assert.equal(counts().starts, 1);
  release(); release(); t.mock.timers.tick(1500); await settle();
  assert.equal(counts().starts, 2); session.setActive(false);
});
test('连接失败限频重试，认证失效等待前台恢复或连接变更', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const { session, state, counts } = setup(true);
  session.setActive(true); await settle();
  state.status.isRunning = false; state.status.phase = '同步失败'; state.status.completionGeneration++;
  await session.refresh();
  t.mock.timers.tick(1500); await settle(); assert.equal(counts().starts, 1);
  t.mock.timers.tick(6000); await settle(); assert.equal(counts().starts, 2);
  state.status.isRunning = false; state.status.errorMessage = '认证失败'; state.status.completionGeneration++;
  await session.refresh();
  t.mock.timers.tick(60000); await settle(); assert.equal(counts().starts, 2);
  await session.run(async () => { state.status.errorMessage = null; }, true);
  t.mock.timers.tick(1500); await settle(); assert.equal(counts().starts, 3);
  session.setActive(false);
});
test('部分写入失败仍读真实快照，快照失败显示可重试状态', async () => {
  const { session, counts } = setup();
  session.setActive(true); await settle();
  assert.equal(await session.run(async () => { throw new Error('partial'); }, true), false);
  assert.equal(counts().snapshots, 2);
  assert.equal(session.view.actionError, 'mobile.sync.operationError');
  session.setActive(false);
  const failed = new ForegroundSyncSession(setup().client, async () => { throw new Error('snapshot'); });
  failed.setActive(true); await settle();
  assert.equal(failed.view.readError, 'cloud.readStatusError'); failed.setActive(false);
});
