import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CharacterMapSession, createCharacterMapClient, characterMapError, characterText, codepointLabel, type CharacterMapBridge, type CharacterMapInfo } from '../../../shared/character-map.ts';

const info: CharacterMapInfo = { handle: 'snapshot-1', revisionId: 'revision-1', sourcePath: '/fonts/sample.ttc', faceIndex: 1, count: 1, scripts: [] };
const selection = { faceId: 'face-1', revisionId: 'revision-1', sourcePath: info.sourcePath };

test('退出页面时仍在打开的快照立即释放，不能继续查询或绘制', async () => {
  let resolve!: (value: string) => void;
  const closed: string[] = [];
  const bridge: CharacterMapBridge = {
    openCharacterMap: () => new Promise((done) => { resolve = done; }),
    queryCharacterMap: async () => { throw new Error('unexpected query'); },
    renderCharacterMap: async () => { throw new Error('unexpected render'); },
    closeCharacterMap: async (handle) => { closed.push(handle); },
  };
  const session = new CharacterMapSession(createCharacterMapClient(bridge));
  const opening = session.open(selection);
  session.close(); resolve(JSON.stringify(info));
  assert.equal(await opening, null);
  assert.deepEqual(closed, [info.handle]);
  assert.throws(() => session.query({ text: '', script: null, offset: 0, limit: 256 }), /sessionClosed/);
});

test('页码、非 BMP 字符、Glyph ID、轴值和前景色原样传到同一快照', async () => {
  const sent: unknown[] = [];
  const bridge: CharacterMapBridge = {
    openCharacterMap: async (request) => { sent.push(JSON.parse(request)); return JSON.stringify(info); },
    queryCharacterMap: async (request) => { sent.push(JSON.parse(request)); return JSON.stringify({ entries: [{ codepoint: 0x1f600, glyphId: 7, script: 'Common' }], total: 1, offset: 0 }); },
    renderCharacterMap: async (request) => { sent.push(JSON.parse(request)); return JSON.stringify([{ glyphId: 7, status: 'empty', dataUrl: null, error: null }]); },
    closeCharacterMap: async () => {},
  };
  const session = new CharacterMapSession(createCharacterMapClient(bridge));
  await session.open(selection);
  const page = await session.query({ text: '😀', script: 'Common', offset: 0, limit: 256 });
  await session.render({ glyphIds: [7], axes: { wght: 650 }, size: 384, foreground: [255, 255, 255, 255] });
  assert.deepEqual(sent, [selection, { text: '😀', script: 'Common', offset: 0, limit: 256, handle: info.handle }, { glyphIds: [7], axes: { wght: 650 }, size: 384, foreground: [255, 255, 255, 255], handle: info.handle }]);
  assert.equal(characterText(page.entries[0]!), '😀');
  assert.equal(codepointLabel(page.entries[0]!.codepoint), 'U+1F600');
  assert.equal(characterMapError(new Error('ERR: characterMap.error.staleSource /fonts/private.ttf')), 'characterMap.error.staleSource');
  session.close();
});
