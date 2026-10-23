import assert from 'node:assert/strict';
import test from 'node:test';
import {
  maxNavigationMarginReduction, minNavigationMarginReduction,
  navigationBottomOffset, navigationMarginReduction, navigationSideMargin,
} from './navigation-metrics.ts';

test('外边距缩减限制在 6–12dp，屏幕与圆角越大缩减越少', () => {
  assert.equal(navigationMarginReduction(360, 8), maxNavigationMarginReduction);
  assert.equal(navigationMarginReduction(600, 32), minNavigationMarginReduction);
  assert.equal(navigationMarginReduction(480, 20), 9);
  assert.equal(navigationMarginReduction(600, 8), 9.6);
  assert.equal(navigationMarginReduction(360, 32), 8.4);
  assert.ok(navigationMarginReduction(420, 24) > navigationMarginReduction(420, 32));
  assert.ok(navigationMarginReduction(420, 24) > navigationMarginReduction(600, 24));
});

test('左右边距随同一缩减量收窄，并保留 8dp 下限', () => {
  assert.equal(navigationSideMargin(400, 9), 19);
  assert.equal(navigationSideMargin(100, 12), 8);
});

test('底部边距不侵入系统手势区', () => {
  assert.equal(navigationBottomOffset(0, 9), 23);
  assert.equal(navigationBottomOffset(24, 9), 31);
  assert.equal(navigationBottomOffset(24, 12), 28);
  assert.equal(navigationBottomOffset(64, 9), 71);
});
