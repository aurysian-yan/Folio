import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAndroidUiStyle, resolveAndroidAppearance, uiTokens } from './ui-style.ts';

test('新装、旧配色开关和未知主题保持 Glasmio，不自动切换 M3E', () => {
  for (const raw of [{}, { materialTheme: true }, { materialTheme: false }, { androidUiStyle: 'unknown', materialTheme: true }]) {
    assert.deepEqual(resolveAndroidAppearance(raw, true), { androidUiStyle: 'glasmio', materialTheme: false });
  }
  for (const raw of [undefined, null, 1, {}, 'legacy']) assert.equal(normalizeAndroidUiStyle(raw), 'glasmio');
});

test('配色只能由 UI 风格派生，独立更新旧字段不能绕过锁定', () => {
  for (const materialTheme of [undefined, true, false]) {
    assert.deepEqual(resolveAndroidAppearance({ androidUiStyle: 'material3-expressive', materialTheme }, true),
      { androidUiStyle: 'material3-expressive', materialTheme: true });
    assert.equal(resolveAndroidAppearance({ androidUiStyle: 'glasmio', materialTheme }, true).materialTheme, false);
  }
});

test('不支持 M3E 的构建不接受主题选择，保留原有配色偏好', () => {
  assert.deepEqual(resolveAndroidAppearance({ androidUiStyle: 'material3-expressive', materialTheme: false }, false),
    { androidUiStyle: 'glasmio', materialTheme: false });
  assert.equal(resolveAndroidAppearance({ materialTheme: true }, false).materialTheme, true);
});

test('双向切换恢复各自令牌，M3E 关闭采样与液态形变', () => {
  const before = uiTokens('glasmio');
  const material = uiTokens('material3-expressive');
  assert.equal(material.materials.backdrop, false);
  assert.equal(material.motion.deform, false);
  assert.equal(material.metrics.navigation, 80);
  assert.ok(material.metrics.control >= 48);
  assert.deepEqual(uiTokens('glasmio'), before);
  assert.equal(before.materials.backdrop, true);
});
