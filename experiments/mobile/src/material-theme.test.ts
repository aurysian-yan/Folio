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
  assert.equal(light.background, roles.surfaceContainer);
  assert.equal(light.surface, roles.surface);
  assert.equal(light.listCardSurface, roles.surface);
  assert.equal(light.tab, roles.surface);
  assert.equal(light.buttonSurface, roles.surface);
  assert.equal(light.buttonSurfaceOpacity, 0.9);
  assert.equal(light.buttonPressed, roles.surface);
  assert.equal(light.raised, roles.surfaceContainerHigh);
  assert.equal(light.label, roles.onSurface);
  assert.equal(light.secondary, roles.onSurfaceVariant);
  assert.equal(light.muted, roles.onSurfaceVariant);
  assert.equal(light.border, roles.outlineVariant);
  assert.equal(light.activeTab, roles.primaryContainer);
  assert.equal(light.danger, roles.error);

  const dark = materialThemeOverrides(roles, true);
  assert.equal(dark.background, roles.surface);
  assert.equal(dark.surface, roles.surfaceContainer);
  assert.equal(dark.listCardSurface, roles.surfaceContainerHigh);
  assert.equal(dark.tab, roles.surfaceContainerHigh);
  assert.equal(dark.buttonSurface, roles.surfaceContainer);
  assert.equal(dark.buttonSurfaceOpacity, 0.9);
  assert.equal(dark.buttonPressed, roles.surfaceContainer);
  for (const theme of [light, dark]) {
    for (const key of ['heroNormal', 'heroDamaged', 'heroUpdate', 'heroCloud', 'heroConflict'] as const) {
      assert.equal(theme[key], roles.primary);
    }
  }
});

test('选中态透明度随浅深色变化', () => {
  assert.equal(materialThemeOverrides(roles, false).selection, 'rgba(103, 80, 164, 0.2)');
  assert.equal(materialThemeOverrides(roles, true).selection, 'rgba(103, 80, 164, 0.25)');
});
