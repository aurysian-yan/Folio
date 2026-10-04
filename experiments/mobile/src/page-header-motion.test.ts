import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageHeaderSnapTarget } from './page-header-motion.ts';

test('标题交接中松手只吸附展开或收起位置', () => {
  assert.equal(pageHeaderSnapTarget(20, 500), 0);
  assert.equal(pageHeaderSnapTarget(32, 500), 64);
  assert.equal(pageHeaderSnapTarget(50, 500), 64);
});

test('短页面无法达到收起位置时返回展开位置', () => {
  assert.equal(pageHeaderSnapTarget(20, 28), 0);
  assert.equal(pageHeaderSnapTarget(40, 28), 0);
});

test('完整状态与正文滚动不再次吸附，主页沿用实际标题高度', () => {
  for (const offset of [-20, 0, 64, 120, 300]) assert.equal(pageHeaderSnapTarget(offset, 500), null);
  assert.equal(pageHeaderSnapTarget(80, 500, 180), 0);
  assert.equal(pageHeaderSnapTarget(100, 500, 180), 180);
});
