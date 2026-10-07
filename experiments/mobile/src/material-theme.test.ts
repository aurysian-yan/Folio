import assert from 'node:assert/strict';
import test from 'node:test';
import { materialThemeOverrides, type MaterialRoles } from './material-theme.ts';

const roles: MaterialRoles = {
  primary: '#6750A4', onPrimary: '#FFFFFF', primaryContainer: '#EADDFF',
  surface: '#FEF7FF', surfaceContainer: '#F3EDF7', surfaceContainerHigh: '#ECE6F0', surfaceContainerHighest: '#E6E0E9',
  onSurface: '#1D1B20', onSurfaceVariant: '#49454F', outlineVariant: '#CAC4D0', error: '#B3261E',
};

test('Material3 角色映射到卡片、背景、文字与强调色', () => {
  const light = materialThemeOverrides(roles, false);
  assert.equal(light.accent, roles.primary);
  assert.equal(light.onAccent, roles.onPrimary);
  assert.equal(light.background, roles.surface);
  assert.equal(light.surface, roles.surfaceContainer);
  assert.equal(light.raised, roles.surfaceContainerHigh);
  assert.equal(light.label, roles.onSurface);
  assert.equal(light.secondary, roles.onSurfaceVariant);
  assert.equal(light.muted, roles.onSurfaceVariant);
  assert.equal(light.border, roles.outlineVariant);
  assert.equal(light.activeTab, roles.primaryContainer);
  assert.equal(light.danger, roles.error);
});

test('选中态透明度随浅深色变化', () => {
  assert.equal(materialThemeOverrides(roles, false).selection, 'rgba(103, 80, 164, 0.2)');
  assert.equal(materialThemeOverrides(roles, true).selection, 'rgba(103, 80, 164, 0.25)');
});
