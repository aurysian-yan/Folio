import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alphabetAlignedOffset, alphabetPageProgress, alphabetDragGroup, alphabetGroupAt, alphabetGroupCenter, alphabetGroups, alphabetPages } from './alphabet-index.ts';

test('完整千项目录可直接访问末尾分页并反向加载，不依赖中间页', () => {
  const entries = Array.from({ length: 1043 }, (_, index) => ({ id: `${index}`, displayName: `Font ${index}`, group: index < 40 ? '#' : index < 1000 ? 'A' : 'Z' }));
  const groups = alphabetGroups(entries);
  assert.deepEqual(groups, [{ label: '#', index: 0 }, { label: 'A', index: 40 }, { label: 'Z', index: 1000 }]);
  assert.deepEqual(alphabetPages(groups[2]!.index, entries.length), [1000, 1040, 960]);
  assert.deepEqual(alphabetPages(20, entries.length), [0, 40]);
  assert.deepEqual(alphabetPages(1042, entries.length), [1040, 1000]);
  assert.deepEqual(alphabetPages(0, 0), []);
  assert.equal(alphabetGroupAt(groups, 999), 1);
  assert.equal(alphabetGroupAt(groups, 1000), 2);
});

test('所有字母均分轨道，点击整条轨道和端点外拖动均有稳定目标', () => {
  const height = 520;
  for (let i = 0; i < 26; i++) {
    const center = alphabetGroupCenter(i, height, 26);
    assert.equal(center, i * 20 + 10);
    assert.equal(alphabetDragGroup(center, height, 26), i);
    assert.equal(alphabetDragGroup(i * 20, height, 26), i);
  }
  assert.equal(alphabetDragGroup(-100, height, 26), 0);
  assert.equal(alphabetDragGroup(900, height, 26), 25);
  assert.equal(alphabetDragGroup(10, height, 1), 0);
  assert.equal(alphabetDragGroup(10, 0, 0), 0);
});

test('首张卡片按窗口坐标对齐，顶部越界时停止在零偏移', () => {
  assert.equal(alphabetAlignedOffset(1000, 132, 20, 164), 948);
  assert.equal(alphabetAlignedOffset(948, 184, 20, 164), 948);
  assert.equal(alphabetAlignedOffset(948, 220, 20, 164), 984);
  assert.equal(alphabetAlignedOffset(0, 100, 20, 164), 0);
});

test('页面进度连续跟随实际滚动距离，并限制回弹和短内容边界', () => {
  assert.equal(alphabetPageProgress(0, 2000, 800), 0);
  assert.equal(alphabetPageProgress(300, 2000, 800), 0.25);
  assert.equal(alphabetPageProgress(301, 2000, 800), 301 / 1200);
  assert.equal(alphabetPageProgress(1200, 2000, 800), 1);
  assert.equal(alphabetPageProgress(-30, 2000, 800), 0);
  assert.equal(alphabetPageProgress(1300, 2000, 800), 1);
  assert.equal(alphabetPageProgress(50, 600, 800), 0);
  assert.equal(alphabetPageProgress(0, 800, 800), 0);
});

test('末尾字母定位服从列表底部边界，不为顶部对齐扩展空白', () => {
  assert.equal(alphabetAlignedOffset(1000, 500, 0, 164, 1100), 1100);
  assert.equal(alphabetAlignedOffset(1100, 400, 0, 164, 1100), 1100);
  assert.equal(alphabetAlignedOffset(1000, 200, 0, 164, 1100), 1036);
  assert.equal(alphabetAlignedOffset(0, 500, 0, 164, 0), 0);
});
