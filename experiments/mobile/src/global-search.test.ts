import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSearch, searchCloud, searchMatches, searchProviders, searchSettings } from './global-search.ts';
import type { CloudFont } from './sync.ts';
import type { OnlineProvider } from './online.ts';
test('搜索规范化和多关键词匹配不依赖大小写或重复空白', () => {
  assert.equal(normalizeSearch('  Source  Han\n Serif '), 'source han serif');
  assert.equal(searchMatches('SOURCE 宋体', 'Source Han', '思源宋体'), true);
  assert.equal(searchMatches('Source 黑体', 'Source Han', '思源宋体'), false);
  assert.equal(searchMatches('', 'Source'), false);
});
test('云端匹配显示名和文件名，显示名优先并排除最近删除', () => {
  const fonts = [
    { fingerprint: 'file', displayName: '字体', filename: 'Inter.otf', deleted: false },
    { fingerprint: 'name', displayName: 'Inter', filename: 'font.otf', deleted: false },
    { fingerprint: 'deleted', displayName: 'Inter', filename: 'font.otf', deleted: true },
  ] as CloudFont[];
  assert.deepEqual(searchCloud(fonts, 'INTER').map((item) => item.fingerprint), ['name', 'file']);
});
test('在线动作保留所有启用来源，匹配名称和域名只改变优先级', () => {
  const providers = [
    { id: 'other', name: 'Other', homepage: 'https://other.example.com', enabled: true },
    { id: 'domain', name: 'Font Site', homepage: 'https://inter.example.com', enabled: true },
    { id: 'name', name: 'Inter Fonts', homepage: 'https://fonts.example.com', enabled: true },
    { id: 'off', name: 'Inter', homepage: 'https://off.example.com', enabled: false },
  ] as OnlineProvider[];
  assert.deepEqual(searchProviders(providers, 'Inter').map((item) => item.id), ['name', 'domain', 'other']);
  assert.equal(searchProviders(providers, '思源宋体').length, 3);
});
test('设置匹配翻译后的标题及关键词，保留具体控件定位键', () => {
  const result = searchSettings('关键词', (key) => key === 'browser.inheritSearch' ? '切换来源时沿用关键词' : key);
  assert.equal(result[0]?.page, 'online');
  assert.equal(result[0]?.titleKey, 'browser.inheritSearch');
});

test('设置索引不在 iOS 返回 Android 专属控件', () => {
  assert.equal(searchSettings('Material3', (key) => key, 'ios').length, 0);
  assert.equal(searchSettings('Material3', (key) => key, 'android')[0]?.titleKey, 'mobile.settings.materialTheme');
});

test('软件更新可按中英文及镜像关键词在两个平台找到', () => {
  for (const platform of ['android', 'ios']) for (const query of ['更新', 'mirror', 'release']) {
    assert.equal(searchSettings(query, (key) => key, platform)[0]?.page, 'update');
  }
});
