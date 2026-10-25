import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardColumns, defaultDashboard, downloadProgress, parsePagePreview, recentDashboardEntries, sanitizeDashboard } from './browser-dashboard.ts';
import { initialNavigationScroll, trackNavigationScroll } from './navigation-scroll.ts';
import { reorderTo } from './reorder.ts';
import type { OnlineProvider } from './online.ts';

test('区块迁移保留独立样式、行数与顺序，并保留主动清空的仪表盘', () => {
  assert.deepEqual(sanitizeDashboard(undefined), defaultDashboard);
  assert.deepEqual(sanitizeDashboard([]), []);
  assert.deepEqual(sanitizeDashboard([{ id: 'downloads', rows: 3, style: 'list' }, { id: 'folder:abc', rows: 2, style: 'detailed' },
    { id: 'personal', rows: 99 }, { id: 'downloads', rows: 1 }, { id: 'bad', rows: 1 }]), [
    { id: 'downloads', rows: 3, style: 'list' }, { id: 'folder:abc', rows: 2, style: 'detailed' }, { id: 'personal', rows: 6, style: 'normal' },
  ]);
});
test('最近浏览仅隐藏已知来源首页，保留搜索、详情和完整历史', () => {
  const providers = [{ homepage: 'https://fonts.example.com/catalog/', enabled: false }] as OnlineProvider[];
  const urls = ['https://fonts.example.com/catalog#top', 'https://fonts.example.com/catalog?q=inter', 'https://fonts.example.com/catalog/item', 'https://unknown.example.com/'];
  const history = urls.map((url, index) => ({ id: String(index), title: '', url, visitedAt: index, providerId: null }));
  assert.deepEqual(recentDashboardEntries(history, providers, false).map((item) => item.url), urls.slice(1));
  assert.equal(recentDashboardEntries(history, providers, true).length, 4);
  assert.equal(history.length, 4);
});
test('行数按列数换算，列表固定单列，大字体减少列数', () => {
  assert.equal(dashboardColumns('normal', 368, 1), 4);
  assert.equal(dashboardColumns('normal', 368, 1.5), 2);
  assert.equal(dashboardColumns('list', 900, 1), 1);
  assert.equal(dashboardColumns('detailed', 368, 1), 1);
  assert.equal(dashboardColumns('detailed', 800, 1), 4);
});
test('网页预览优先读取 SEO，解析相对图片、实体和缺失数据', () => {
  const html = `<title>Fallback</title><meta content="SEO &amp; 字体" property="og:title"><meta name='description' content='摘要 &#x4E2D;'><meta property="og:image" content="/cover.jpg"><img src="/other.png">`;
  assert.deepEqual(parsePagePreview(html, 'https://example.com/font', 10), { title: 'SEO & 字体', description: '摘要 中', image: 'https://example.com/cover.jpg', fetchedAt: 10 });
  assert.equal(parsePagePreview(`<script>"<meta property='og:title' content='wrong'>"</script><title>Font</title><img data-src="images/a.png">`, 'https://example.com/fonts/').title, 'Font');
  assert.equal(parsePagePreview('<img src="images/a.png">', 'https://example.com/fonts/').image, 'https://example.com/fonts/images/a.png');
  assert.equal(parsePagePreview('<meta property="og:image" content="javascript:alert(1)">', 'https://example.com/').image, null);
  assert.equal(parsePagePreview('', 'https://example.com/').description, '');
});
test('进度限制在零到一之间，总大小未知时不产生百分比', () => {
  assert.equal(downloadProgress(30, 100), 0.3);
  assert.equal(downloadProgress(120, 100), 1);
  assert.equal(downloadProgress(-10, 100), 0);
  assert.equal(downloadProgress(30, null), null);
  assert.equal(downloadProgress(30, 0), null);
});
test('拖动排序按稳定标识移动，不丢失区块和来源属性', () => {
  const items = [{ id: 'a', enabled: false }, { id: 'b', enabled: true }, { id: 'c', enabled: true }];
  assert.deepEqual(reorderTo(items, 'a', 2).map((item) => item.id), ['b', 'c', 'a']);
  assert.equal(reorderTo(items, 'a', 2)[2]?.enabled, false);
  assert.deepEqual(reorderTo(items, 'c', -1).map((item) => item.id), ['c', 'a', 'b']);
  assert.equal(reorderTo(items, 'missing', 0), items);
  assert.deepEqual(items.map((item) => item.id), ['a', 'b', 'c']);
});
test('滚动折叠累计方向位移，反向展开，忽略顶部回弹与抖动', () => {
  let state = initialNavigationScroll;
  for (const y of [10, 20]) { const next = trackNavigationScroll(state, y); assert.equal(next.collapsed, null); state = next.state; }
  let next = trackNavigationScroll(state, 35); assert.equal(next.collapsed, true);
  state = next.state;
  next = trackNavigationScroll(state, 20); assert.equal(next.collapsed, null);
  next = trackNavigationScroll(next.state, 0); assert.equal(next.collapsed, false);
  assert.equal(trackNavigationScroll(initialNavigationScroll, -50).collapsed, null);
  assert.equal(trackNavigationScroll(initialNavigationScroll, 0.5).collapsed, null);
});
