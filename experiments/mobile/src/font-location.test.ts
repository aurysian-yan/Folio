import assert from 'node:assert/strict';
import test from 'node:test';
import { locationAvailability, locationLabel, locallyAvailable, transferLabel, type FontLocation } from '../../../shared/font-location.ts';
import i18n from './i18n/instance.ts';

const local: FontLocation = { state: 'both', localAvailable: true, cloudAvailable: true,
  cloudConfirmedAtMs: 1, metadataComplete: true, files: [] };
const cloud: FontLocation = { ...local, state: 'cloudOnly', localAvailable: false };

test('位置图标按实际可用性显示，字族合并位置，选中字款单独判断', () => {
  const localOnly = { location: { ...local, state: 'pendingUpload' as const, cloudAvailable: false } };
  const cloudOnly = { location: cloud, sourcePath: '/stale.ttf' };
  assert.deepEqual(locationAvailability([localOnly]), { local: true, cloud: false });
  assert.deepEqual(locationAvailability([cloudOnly]), { local: false, cloud: true });
  assert.deepEqual(locationAvailability([{ location: local }]), { local: true, cloud: true });
  assert.deepEqual(locationAvailability([localOnly, cloudOnly]), { local: true, cloud: true });
  assert.deepEqual(locationAvailability([localOnly, cloudOnly], cloudOnly), { local: false, cloud: true });
  assert.deepEqual(locationAvailability([{ sourcePath: '/local.ttf' }]), { local: true, cloud: false });
  assert.deepEqual(locationAvailability([]), { local: false, cloud: false });
});

test('字族显示部分在本机，选中字款后使用该字款的实际位置', () => {
  const faces = [{ location: local }, { location: cloud }];
  const family = { state: 'partial' as const, localFaceCount: 1, totalFaceCount: 2 };
  assert.equal(locationLabel(faces, undefined, i18n.t.bind(i18n), family), '部分在本机 · 1/2 字款');
  assert.equal(locationLabel(faces, faces[1], i18n.t.bind(i18n), family), '仅在云端');
  assert.equal(locationLabel(faces, faces[0], i18n.t.bind(i18n), family), '本机与云端');
  assert.equal(locallyAvailable({ location: cloud, sourcePath: '/missing.ttf' }), false);
});

test('失败和取消独立显示，已完成任务不覆盖常驻位置', () => {
  const file = { fingerprint: 'file', filename: 'font.ttf', fileSize: 1, faceIndex: 0,
    localSources: [], cloudAvailable: true, uploadExcluded: false, downloadPolicy: 'local',
    transferAction: 'download', transferStatus: 'failed', transferError: 'error' };
  assert.match(transferLabel(file, i18n.t.bind(i18n)), /传输失败/);
  assert.match(transferLabel({ ...file, transferStatus: 'cancelled' }, i18n.t.bind(i18n)), /已取消/);
  assert.equal(transferLabel({ ...file, transferStatus: 'done' }, i18n.t.bind(i18n)), '');
});
