import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLibraryClient, LibraryError, summarizeImport, type LibraryBridge, type LibraryPage } from './library.ts';

const emptyPage: LibraryPage = { totalMatches: 0, families: [] };
const query = { text: '衬线', scope: 'all' as const, offset: 40, limit: 40 };

function mockBridge(run: LibraryBridge['query']): LibraryBridge {
  return {
    initialize: async () => ({ familyCount: 0, faceCount: 0, variableFamilyCount: 0, recentCount: 0, damagedCount: 0 }),
    importFonts: async () => ({ snapshot: { familyCount: 0, faceCount: 0, variableFamilyCount: 0, recentCount: 0, damagedCount: 0 }, items: [] }),
    setFavorite: async () => {},
    query: run,
  };
}

test('原样传递搜索和分页，不在 JS 中重排 Rust 结果', async () => {
  let received;
  const client = createLibraryClient(mockBridge(async (request) => {
    received = request;
    return emptyPage;
  }));
  assert.equal(await client.query(query), emptyPage);
  assert.deepEqual(received, query);
});

test('批量导入传递全部文件和原始名称，保留逐项结果', async () => {
  const files = [{ uri: 'content://fonts/1', name: '中文.ttf' }, { uri: 'file:///bundle.zip', name: '字库.zip' }];
  const bridge = mockBridge(async () => emptyPage);
  const report = await bridge.importFonts([]);
  report.items = [
    { name: '中文.ttf', archiveName: null, status: 'imported', message: null },
    { name: '子目录/中文.ttf', archiveName: '字库.zip', status: 'duplicate', message: null },
    { name: '损坏.otf', archiveName: '字库.zip', status: 'failed', message: '字体文件损坏或格式不受支持。' },
  ];
  bridge.importFonts = async (received) => { assert.deepEqual(received, files); return report; };
  assert.equal(await createLibraryClient(bridge).importFonts(files), report);
  assert.deepEqual(summarizeImport(report.items), { imported: 1, duplicate: 1, failed: 1 });
  assert.deepEqual(summarizeImport([]), { imported: 0, duplicate: 0, failed: 0 });
});

test('无效页码在调用原生之前失败', () => {
  const client = createLibraryClient(mockBridge(async () => assert.fail('不能调用原生')));
  for (const invalid of [{ offset: -1 }, { offset: 0.5 }, { limit: 0 }, { limit: 101 }]) {
    assert.throws(() => client.query({ ...query, ...invalid }),
      (error) => error instanceof LibraryError && error.code === 'invalid-query');
  }
});

test('批量整体失败只显示产品提示，刷新回滚具有明确说明', async () => {
  const bridge = mockBridge(async () => emptyPage);
  for (const code of ['ERR_FOLIO_OPERATION', 'ERR_FOLIO_IMPORT']) {
    const cause = Object.assign(new Error('/private/fonts/import: database error'), { code });
    bridge.importFonts = async () => { throw cause; };
    await assert.rejects(createLibraryClient(bridge).importFonts([]), (error) => {
      assert.ok(error instanceof LibraryError);
      assert.equal(error.cause, cause);
      assert.equal(error.message, code === 'ERR_FOLIO_IMPORT'
        ? '无法更新字体库，本次新增字体未保留，请重试。'
        : '无法完成导入，请确认文件可用、空间充足后重试。');
      return true;
    });
  }
});

test('已取消的请求不会调用原生', async () => {
  const client = createLibraryClient(mockBridge(async () => assert.fail('不能调用原生')));
  await assert.rejects(client.query(query, AbortSignal.abort()),
    (error) => error instanceof LibraryError && error.code === 'cancelled');
});

test('进行中的查询立即取消，迟到结果不会覆盖新查询', async () => {
  let finish!: (page: LibraryPage) => void;
  const client = createLibraryClient(mockBridge(() => new Promise((resolve) => { finish = resolve; })));
  const controller = new AbortController();
  const pending = client.query(query, controller.signal);
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, (error) => error instanceof LibraryError && error.code === 'cancelled');
  finish(emptyPage);
});

test('取消后的原生失败不会产生未处理拒绝', async () => {
  let fail!: (error: Error) => void;
  const client = createLibraryClient(mockBridge(() => new Promise((_, reject) => { fail = reject; })));
  const controller = new AbortController();
  const pending = client.query(query, controller.signal);
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending);
  fail(new Error('原生已结束'));
  await new Promise<void>((resolve) => setImmediate(resolve));
});

test('原生错误保留原因，界面消息不包含底层信息', async () => {
  const cause = new Error('/private/database.sqlite: error 14');
  const client = createLibraryClient(mockBridge(async () => { throw cause; }));
  await assert.rejects(client.query(query), (error) => {
    assert.ok(error instanceof LibraryError);
    assert.equal(error.code, 'native');
    assert.equal(error.cause, cause);
    assert.equal(error.message, '暂时无法读取字体库，请重试。');
    return true;
  });
});
