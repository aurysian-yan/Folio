import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageHeaderSnapTarget, pageTitleCollapsed, pageTitleDuration, pageTitleMotion, pageTitleRemainingDuration } from './page-header-motion.ts';

test('标题交接时长在快甩与慢拖时均受约束，正反方向一致', () => {
  assert.equal(pageTitleDuration(0), pageTitleMotion.duration);
  assert.equal(pageTitleDuration(Number.NaN), pageTitleMotion.duration);
  assert.equal(pageTitleDuration(0.01), pageTitleMotion.maximumDuration);
  assert.equal(pageTitleDuration(0.05), 400);
  assert.equal(pageTitleDuration(4), pageTitleMotion.minimumDuration);
  assert.equal(pageTitleDuration(-0.25), pageTitleDuration(0.25));
  assert.equal(pageTitleDuration(0.25, 128), 512);
});

test('滚动加速缩短剩余时间，完整交接仍满足最快时长', () => {
  const elapsed = 48;
  const remaining = pageTitleRemainingDuration(1, elapsed, 720);
  assert.equal(remaining, 132);
  assert.equal(elapsed + remaining!, pageTitleMotion.minimumDuration);
  assert.equal(pageTitleRemainingDuration(1, 240, 720), 0);
});

test('滚动减速或速度不变不延长交接，也不反复重启动画', () => {
  assert.equal(pageTitleRemainingDuration(0.01, 48, 180), null);
  assert.equal(pageTitleRemainingDuration(1, 48, 180), null);
  assert.equal(pageTitleRemainingDuration(1, 48, 180.000001), null);
  assert.equal(pageTitleRemainingDuration(0.05, 48, 400), null);
});

test('滚动开始即交接标题，无需等到上浮结束，顶部回差避免抖动', () => {
  assert.equal(pageTitleCollapsed(0, false), false);
  assert.equal(pageTitleCollapsed(0.75, false), false);
  assert.equal(pageTitleCollapsed(1, false), true);
  assert.equal(pageTitleCollapsed(10, false), true);
  assert.equal(pageTitleCollapsed(0.75, true), true);
  assert.equal(pageTitleCollapsed(0.5, true), true);
  assert.equal(pageTitleCollapsed(0.25, true), false);
  assert.equal(pageTitleCollapsed(-10, true), false);
});

test('标题交接中松手只吸附展开或收起位置', () => {
  assert.equal(pageHeaderSnapTarget(5, 500), 0);
  assert.equal(pageHeaderSnapTarget(10, 500), 20);
  assert.equal(pageHeaderSnapTarget(15, 500), 20);
});

test('短页面无法达到收起位置时返回展开位置', () => {
  assert.equal(pageHeaderSnapTarget(5, 12), 0);
  assert.equal(pageHeaderSnapTarget(10, 12), 0);
});

test('完整状态与正文滚动不再次吸附，主页沿用实际标题高度', () => {
  for (const offset of [-20, 0, 20, 120, 300]) assert.equal(pageHeaderSnapTarget(offset, 500), null);
  assert.equal(pageHeaderSnapTarget(80, 500, 180), 0);
  assert.equal(pageHeaderSnapTarget(100, 500, 180), 180);
});
