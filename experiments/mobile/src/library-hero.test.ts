import assert from 'node:assert/strict';
import test from 'node:test';
import { createLibraryHero } from './library-hero.ts';
import type { LibrarySnapshot } from './library.ts';
import type { SyncState } from './sync.ts';

const snapshot: LibrarySnapshot = { familyCount: 670, faceCount: 1200, variableFamilyCount: 42, recentCount: 12,
  damagedCount: 0, collections: [], smartFolders: [], syncSummary: { syncedCount: 2, cloudOnlyCount: 0, localOnlyFingerprints: [] } };
const state: SyncState = { profile: { serverUrl: 'https://webdav.123pan.com', remoteDirectory: 'Folio', username: '', automatic: false },
  credentialAvailable: true, credentialError: false,
  status: { phase: '已同步', stage: '已同步', percent: 100, stageCompleted: 0, stageTotal: 0, isRunning: false,
    uploadedFiles: 0, downloadedFiles: 0, uploadedBytes: 0, downloadedBytes: 0, completionGeneration: 1,
    lastSyncedAtMs: 1, errorMessage: null, items: [] }, fonts: [], conflicts: [] };

test('移动布局沿用桌面内容，不使用固定标题与移动更新文案', () => {
  const hero = createLibraryHero(snapshot, state, null);
  assert.equal(hero.title, '现有 670 个字族，随时可用');
  assert.equal(hero.subtitle, '0 个损坏字体 · 42 个可变字族 · 12 个最近访问');
  assert.equal(hero.sync.state, 'synced');
  assert.equal(createLibraryHero({ ...snapshot, damagedCount: 8 }, state, null).kind, 'damaged');
});

test('未运行队列也显示仅本地未同步，云端保留与传输分别判断', () => {
  const local = { ...snapshot, syncSummary: { syncedCount: 2, cloudOnlyCount: 0, localOnlyFingerprints: ['local'] } };
  assert.equal(createLibraryHero(local, state, null).title, '本地有 1 个字体未同步');
  assert.equal(createLibraryHero(local, state, null).sync.state, 'pending');
  const remote: SyncState = { ...state, fonts: [{ fingerprint: 'remote', displayName: 'Lato', filename: 'Lato.ttf',
    fileSize: 123, cloudOnly: true, deleted: false, localPath: null, localAvailable: false, identityIds: [] }] };
  const hero = createLibraryHero(snapshot, remote, null);
  assert.equal(hero.title, '云端有 1 个字体可下载');
  assert.equal(hero.sync.text, '123PAN · 1 个字体仅在云端');
  assert.ok(createLibraryHero(local, remote, null).sync.text.includes('1 个本地字体未同步 · 1 个云端字体可下载'));
});

test('读取失败不使用旧云端记录，未连接与同步失败分别显示', () => {
  assert.equal(createLibraryHero(snapshot, null, null).sync.state, 'checking');
  assert.equal(createLibraryHero(snapshot, { ...state, profile: null }, null).sync.state, 'disconnected');
  assert.equal(createLibraryHero(snapshot, state, 'cloud.readStatusError').sync.state, 'error');
  assert.equal(createLibraryHero(snapshot, { ...state, status: { ...state.status, errorMessage: '状态码 507' } }, null).kind, 'cloudStorageLow');
});
