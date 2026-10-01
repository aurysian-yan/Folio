import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLibraryClient, LibraryError, mergeFacetOptions, normalizeFacets, summarizeImport, targetKey, savedConditions, representativeFace, mergeSmartConditions, hasSmartConditions, type LibraryBridge, type LibraryPage, type LibrarySnapshot } from './library.ts';

const emptyPage: LibraryPage = { totalMatches: 0, families: [], facets: [], unresolvedScopeItems: 0 };
const emptySnapshot: LibrarySnapshot = { familyCount: 0, faceCount: 0, variableFamilyCount: 0, recentCount: 0, damagedCount: 0, collections: [], smartFolders: [] };
const query = { text: '衬线', scope: 'all' as const, offset: 40, limit: 40 };

function mockBridge(run: LibraryBridge['query']): LibraryBridge {
  return {
    initialize: async () => emptySnapshot,
    snapshot: async () => emptySnapshot,
    importFonts: async () => ({ snapshot: emptySnapshot, items: [] }),
    setFavorite: async () => emptySnapshot,
    createCollection: async () => emptySnapshot,
    updateCollection: async () => emptySnapshot,
    deleteCollection: async () => emptySnapshot,
    setCollectionMembers: async () => emptySnapshot,
    getSmartFolder: async () => ({ id: 's', name: '智慧', icon: 'folder', color: 'gray', matchCount: 0, query: { text: '', facets: [] } }),
    saveSmartFolder: async () => ({ snapshot: emptySnapshot, target: { scope: 'smart', smartFolderId: 's' } }),
    deleteSmartFolder: async () => emptySnapshot,
    convertCollectionToSmart: async () => ({ snapshot: emptySnapshot, target: { scope: 'smart', smartFolderId: 's' } }),
    convertSmartToCollection: async () => ({ snapshot: emptySnapshot, target: { scope: 'collection', collectionId: 'm' } }),
    recordRecent: async () => emptySnapshot,
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


test('收藏夹查询和多维筛选原样传递，保留 Rust 计数与不可用成员', async () => {
  const request = { ...query, scope: 'collection' as const, collectionId: 'collection-a', facets: [
    { kind: 'weight' as const, value: '400' }, { kind: 'weight' as const, value: '700' },
    { kind: 'script' as const, value: 'Latn' },
  ] };
  const response: LibraryPage = { ...emptyPage, totalMatches: 42, unresolvedScopeItems: 2,
    facets: [{ kind: 'weight', value: '400', label: '常规', familyCount: 12 }] };
  const client = createLibraryClient(mockBridge(async (received) => { assert.deepEqual(received, request); return response; }));
  assert.equal(await client.query(request), response);
});

test('缺少收藏夹或非法筛选在调用原生前拒绝', () => {
  const client = createLibraryClient(mockBridge(async () => assert.fail('不能调用原生')));
  for (const invalid of [
    { scope: 'collection' }, { scope: 'collection', collectionId: ' ' }, { collectionId: 'unexpected' },
    { facets: [{ kind: 'unknown', value: 'x' }] }, { facets: [{ kind: 'weight', value: '' }] },
    { facets: [{ kind: 'weight', value: null }] }, { facets: [null] }, { facets: {} },
  ]) {
    assert.throws(() => client.query({ ...query, ...invalid } as typeof query),
      (error) => error instanceof LibraryError && error.code === 'invalid-query');
  }
});

test('实时筛选保留零匹配候选和已选项，计数不使用全库旧值', () => {
  const options = [{ kind: 'weight' as const, value: '400', label: '常规', familyCount: 8 },
    { kind: 'weight' as const, value: '700', label: '粗体', familyCount: 6 }];
  const merged = mergeFacetOptions(options, [{ ...options[0]!, familyCount: 2 }], [{ kind: 'script', value: 'Latn' }]);
  assert.deepEqual(merged.map((item) => [item.value, item.familyCount]), [['400', 2], ['700', 0], ['Latn', 0]]);
  assert.equal(merged[1]?.label, '粗体');
  assert.deepEqual(normalizeFacets([{ kind: 'weight', value: '700' }, { kind: 'script', value: 'Latn' },
    { kind: 'weight', value: '700' }]), [{ kind: 'script', value: 'Latn' }, { kind: 'weight', value: '700' }]);
  assert.notEqual(targetKey({ scope: 'collection', collectionId: 'a' }), targetKey({ scope: 'collection', collectionId: 'b' }));
});

test('成员操作传递完整身份集合，返回后端快照，失败不伪造成功', async () => {
  const bridge = mockBridge(async () => emptyPage);
  const snapshot = { ...emptySnapshot, collections: [{ id: 'a', name: '中文', icon: 'books', color: 'blue', memberCount: 2 }] };
  bridge.setCollectionMembers = async (id, identities, member) => {
    assert.equal(id, 'a'); assert.deepEqual(identities, ['regular', 'bold']); assert.equal(member, true); return snapshot;
  };
  const client = createLibraryClient(bridge);
  assert.equal(await client.setCollectionMembers('a', ['regular', 'bold'], true), snapshot);
  const cause = new Error('写入失败');
  bridge.deleteCollection = async () => { throw cause; };
  await assert.rejects(client.deleteCollection('a'), (error) => error === cause);
});


test('智慧查询透传临时条件，计数与排序由 Rust 返回', async () => {
  const request = { ...query, scope: 'smart' as const, smartFolderId: 's', facets: [{ kind: 'state' as const, value: 'favorite' }] };
  const client = createLibraryClient(mockBridge(async (received) => { assert.deepEqual(received, request); return emptyPage; }));
  assert.equal(await client.query(request), emptyPage);
  assert.equal(targetKey(request), 'smart:s');
  for (const invalid of [{ smartFolderId: '' }, { collectionId: 'm' }, { scope: 'all' }]) {
    assert.throws(() => client.query({ ...request, ...invalid } as typeof request), LibraryError);
  }
});

test('保存智慧条件去除范围、分页与滚动，草稿与持久值没有共享引用', async () => {
  const draft = { text: ' Lato ', facets: [{ kind: 'weight' as const, value: '400' }], scope: 'recent', offset: 80, scrollOffset: 200 };
  const saved = savedConditions(draft);
  assert.deepEqual(saved, { text: 'Lato', facets: [{ kind: 'weight', value: '400' }] });
  draft.facets[0]!.value = '700';
  assert.equal(saved.facets[0]!.value, '400');
  const bridge = mockBridge(async () => emptyPage);
  let received;
  bridge.saveSmartFolder = async (id, input) => { received = { id, input }; return { snapshot: emptySnapshot, target: { scope: 'smart', smartFolderId: 's' } }; };
  await createLibraryClient(bridge).saveSmartFolder(null, { name: '常规', icon: 'folder', color: 'blue', query: saved });
  assert.deepEqual(received, { id: null, input: { name: '常规', icon: 'folder', color: 'blue', query: saved } });
});

test('互转使用专属原生事务，失败不伪造快照或成员', async () => {
  const bridge = mockBridge(async () => emptyPage);
  const input = { name: '字库', icon: 'books', color: 'blue', query: { text: 'Lato', facets: [] } };
  bridge.convertCollectionToSmart = async (id, received) => {
    assert.equal(id, 'm'); assert.deepEqual(received, input);
    return { snapshot: emptySnapshot, target: { scope: 'smart', smartFolderId: 's' } };
  };
  const client = createLibraryClient(bridge);
  assert.deepEqual((await client.convertCollectionToSmart('m', input)).target, { scope: 'smart', smartFolderId: 's' });
  const cause = new Error('冲突');
  bridge.convertSmartToCollection = async () => { throw cause; };
  await assert.rejects(client.convertSmartToCollection('s', input), (error) => error === cause);
});

test('访问记录使用卡片代表字款身份，最近查询保持 Rust 顺序', async () => {
  const face = (id: string, styleName: string) => ({ id, identityId: id, styleName, revisionId: '', sourcePath: null, faceIndex: 0, axes: [] });
  const family = { id: 'f', displayName: 'Lato', identityIds: ['bold', 'regular'], matchedFaceIds: [], isFavorite: false, faces: [face('bold', 'Bold'), face('regular', 'Regular')] };
  assert.equal(representativeFace(family)?.identityId, 'regular');
  const bridge = mockBridge(async () => ({ ...emptyPage, families: [family, { ...family, id: 'a' }] }));
  bridge.recordRecent = async (id) => { assert.equal(id, 'regular'); return emptySnapshot; };
  const client = createLibraryClient(bridge);
  assert.equal(await client.recordRecent(representativeFace(family)!.identityId), emptySnapshot);
  assert.deepEqual((await client.query({ ...query, scope: 'recent' })).families.map((item) => item.id), ['f', 'a']);
});


test('统一编辑器按条件区分手动与智慧，新建继承智慧范围合并条件', () => {
  assert.equal(hasSmartConditions({ text: '  ', facets: [] }), false);
  assert.equal(hasSmartConditions({ text: 'Lato', facets: [] }), true);
  const original = { text: 'Lato', facets: [{ kind: 'weight' as const, value: '400' }] };
  const merged = mergeSmartConditions(original, { text: 'Regular', facets: [
    { kind: 'weight', value: '700' }, { kind: 'weight', value: '400' }, { kind: 'state', value: 'favorite' },
  ] });
  assert.equal(hasSmartConditions(merged), true);
  assert.deepEqual(merged, { text: 'Lato Regular', facets: [{ kind: 'state', value: 'favorite' },
    { kind: 'weight', value: '400' }, { kind: 'weight', value: '700' }] });
  merged.facets[1]!.value = '900';
  assert.equal(original.facets[0]!.value, '400');
});
