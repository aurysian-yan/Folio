import assert from 'node:assert/strict';
import test from 'node:test';
import { addSearch, applyBrowserVisit, moveBookmark, browserAddress, downloadBadge, emptyBrowserData, matchingProvider, personalFolderId, pruneHistory, readBrowserData, recordHistory, removeFolder, saveBookmark, searchDownloadJobs } from './browser-data.ts';
import type { OnlineJob, OnlineProvider } from './online.ts';
const provider = (id: string, homepage: string, enabled = true): OnlineProvider => ({ id, name: id, homepage, enabled, builtin: false, searchTemplate: `${homepage}?q={{query}}` });

test('网址输入保留查询参数和片段，只补 HTTPS，不将关键词作为网址', () => {
  assert.equal(browserAddress('fonts.google.com/?query=Inter#styles'), 'https://fonts.google.com/?query=Inter#styles');
  for (const value of ['思源 字体', 'Inter', 'http://example.com', 'javascript:alert(1)', 'https://user:pass@example.com', 'https://site.local']) assert.equal(browserAddress(value), null);
});
test('来源匹配支持子域，拒绝相似域和已停用来源', () => {
  const sources = [provider('off', 'https://example.com', false), provider('site', 'https://example.com')];
  assert.equal(matchingProvider(sources, 'https://fonts.example.com/a')?.id, 'site');
  assert.equal(matchingProvider(sources, 'https://example.com.evil.org/a'), null);
});
test('收藏去重、编辑地址碰撞和删除文件夹均保留正确内容', () => {
  let data = saveBookmark({ ...emptyBrowserData, folders: [{ id: 'folder', name: '字体' }] }, { title: 'First', url: 'https://a.example.com/', folderId: personalFolderId, providerId: null });
  const first = data.bookmarks[0]!;
  data = saveBookmark(data, { title: 'Second', url: 'https://b.example.com/', folderId: 'folder', providerId: null });
  const second = data.bookmarks[1]!;
  data = saveBookmark(data, { ...first, title: 'Merged', url: second.url });
  assert.equal(data.bookmarks.length, 1);
  assert.equal(data.bookmarks[0]!.title, 'Merged');
  data = saveBookmark(data, { ...data.bookmarks[0]!, folderId: 'folder' });
  data = removeFolder(data, 'folder');
  assert.equal(data.bookmarks[0]!.folderId, null);
  assert.equal(data.folders.length, 0);
  assert.equal(removeFolder(data, personalFolderId), data);
});
test('历史同日合并、跨日保留，并按保留期和数量清理', () => {
  const now = new Date(2026, 9, 24, 12).getTime();
  const visit = { title: '字体', url: 'https://example.com/font', providerId: null, visitedAt: now - 1000 };
  let data = recordHistory(emptyBrowserData, visit);
  const id = data.history[0]!.id;
  data = recordHistory(data, { ...visit, visitedAt: now });
  assert.equal(data.history.length, 1); assert.equal(data.history[0]!.id, id);
  data = recordHistory(data, { ...visit, visitedAt: now + 86400000 });
  assert.equal(data.history.length, 2);
  assert.equal(pruneHistory([{ ...visit, id: 'old', visitedAt: now - 91 * 86400000 }], now).length, 0);
  assert.equal(pruneHistory(Array.from({ length: 1005 }, (_, index) => ({ ...visit, id: String(index), visitedAt: now - index })), now).length, 1000);
});
test('恢复浏览资料保留收藏，移除过期历史和失效文件夹关联', () => {
  const saved = { ...emptyBrowserData, bookmarks: [{ id: 'b', title: '字体', url: 'https://example.com/', folderId: 'missing', providerId: null }] };
  const data = readBrowserData(JSON.stringify(saved));
  assert.equal(data.bookmarks[0]!.folderId, null);
  assert.throws(() => readBrowserData('{'));
});
test('任务角标只统计排队和传输，待处理任务使用提示状态', () => {
  const jobs = (...states: OnlineJob['state'][]) => states.map((state) => ({ state } as OnlineJob));
  assert.deepEqual(downloadBadge(jobs('queued', 'transferring', 'paused', 'ready')), { count: 2, attention: true });
  assert.deepEqual(downloadBadge(jobs('failed', 'needsUser')), { count: 0, attention: true });
  assert.deepEqual(downloadBadge(jobs('completed', 'cancelled')), { count: 0, attention: false });
});
test('搜索历史按提交去重，保留原始大小写且最多十项', () => {
  assert.deepEqual(addSearch(['Inter', '思源'], ' inter '), ['inter', '思源']);
  assert.equal(addSearch(Array.from({ length: 10 }, (_, index) => String(index)), 'new').length, 10);
  assert.deepEqual(addSearch(['Inter'], '  '), ['Inter']);
});

test('刷新和同页导航更新当前记录，清空后不由状态回调恢复历史', () => {
  const time = new Date(2026, 9, 24, 12).getTime();
  const data = recordHistory(emptyBrowserData, { title: 'First', url: 'https://example.com/', providerId: null, visitedAt: time });
  const event = { id: '2', url: 'https://example.com/#fonts', title: 'Fonts', reload: false, sameDocument: true, visitedAt: time + 1000 };
  const updated = applyBrowserVisit(data, event, null, 'https://example.com/');
  assert.equal(updated.history.length, 1);
  assert.equal(updated.history[0]!.id, data.history[0]!.id);
  assert.equal(updated.history[0]!.url, event.url);
  assert.equal(updated.history[0]!.visitedAt, time);
  assert.equal(applyBrowserVisit(emptyBrowserData, { ...event, reload: true }, null, event.url), emptyBrowserData);
});
test('收藏排序只交换同一文件夹的网页，不受其他文件夹穿插影响', () => {
  let data = saveBookmark(emptyBrowserData, { title: 'a', url: 'https://a.example.com/', folderId: 'personal', providerId: null });
  data = saveBookmark(data, { title: 'b', url: 'https://b.example.com/', folderId: null, providerId: null });
  data = saveBookmark(data, { title: 'c', url: 'https://c.example.com/', folderId: 'personal', providerId: null });
  const moved = moveBookmark(data, data.bookmarks[0]!.id, 1);
  assert.deepEqual(moved.bookmarks.filter((item) => item.folderId === 'personal').map((item) => item.title), ['c', 'a']);
  assert.equal(moved.bookmarks[1]!.title, 'b');
});

test('网页预览缓存恢复不改变历史、收藏和自定义文件夹，拒绝无效图片与缓存字段', () => {
  const now = Date.now();
  const data = saveBookmark({ ...emptyBrowserData, folders: [{ id: 'custom', name: '字体来源' }] },
    { title: '自定名称', url: 'https://example.com/font', folderId: 'custom', providerId: null });
  const saved = { ...data, previews: {
    'https://example.com/font': { title: 'SEO 名称', description: '摘要', image: 'javascript:alert(1)', fetchedAt: now },
    'https://other.example.com/': { title: 1, fetchedAt: now },
  } };
  const restored = readBrowserData(JSON.stringify(saved), now);
  assert.equal(restored.bookmarks[0]?.title, '自定名称');
  assert.equal(restored.bookmarks[0]?.folderId, 'custom');
  assert.equal(restored.previews['https://example.com/font']?.title, 'SEO 名称');
  assert.equal(restored.previews['https://example.com/font']?.image, null);
  assert.equal(restored.previews['https://other.example.com/'], undefined);
  assert.deepEqual(readBrowserData(JSON.stringify({ ...data, previews: undefined })).previews, {});
});

test('下载搜索匹配文件名、来源和域名，按创建时间排序且不修改原任务', () => {
  const job = (id: string, name: string, state: OnlineJob['state'], createdAt?: number): OnlineJob => ({
    id, name, state, createdAt, bytesDone: 0, bytesTotal: null, kind: null, errorKey: null,
    origin: { providerId: null, providerName: 'Google Fonts', sourcePageUrl: 'https://fonts.google.com/', downloadHost: 'fonts.gstatic.com' },
  });
  const jobs = [job('old', 'Inter.zip', 'ready', 100), job('legacy', 'Roboto.zip', 'paused'),
    job('new', 'Inter Bold.zip', 'transferring', 200), job('cancelled', 'Inter.zip', 'cancelled', 300)];
  assert.deepEqual(searchDownloadJobs(jobs, '').map((item) => item.id), ['new', 'old', 'legacy']);
  assert.deepEqual(searchDownloadJobs(jobs, ' INTER  gstatic ').map((item) => item.id), ['new', 'old']);
  assert.deepEqual(searchDownloadJobs(jobs, 'google roboto').map((item) => item.id), ['legacy']);
  assert.deepEqual(searchDownloadJobs(jobs, 'missing'), []);
  assert.deepEqual(jobs.map((item) => item.id), ['old', 'legacy', 'new', 'cancelled']);
});
