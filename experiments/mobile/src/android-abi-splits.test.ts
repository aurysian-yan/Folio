import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { resolveConfigPluginFunction } = require('@expo/config-plugins/build/utils/plugin-resolver');
const project = resolve(import.meta.dirname,'..');
test('Expo ABI 拆分插件默认输出全部架构，可按属性选择单一 ABI 且保持幂等', async () => {
  const plugin = resolveConfigPluginFunction(project,'./plugins/with-android-abi-splits.ts');
  const config = plugin({name:'Folio',slug:'folio'});
  const input = { ...config, modRequest: { platform:'android',modName:'appBuildGradle',projectRoot:project }, modResults: { language:'groovy',contents:'android {}' } };
  const first = await config.mods.android.appBuildGradle(input);
  const second = await config.mods.android.appBuildGradle(first);
  assert.equal(first.modResults.contents,second.modResults.contents);
  assert.match(first.modResults.contents,/splits \{\s*abi \{/);
  assert.match(first.modResults.contents,/findProperty\('folio\.android\.abi'\) \?: 'all'/);
  assert.match(first.modResults.contents,/\['arm64-v8a', 'x86_64'\]/);
  assert.match(first.modResults.contents,/universalApk = false/);
});
