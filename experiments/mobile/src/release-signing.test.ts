import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { resolveConfigPluginFunction } = require('@expo/config-plugins/build/utils/plugin-resolver');
const project = resolve(import.meta.dirname,'..');
const original = process.env.APP_VARIANT;
test('Expo 发布签名插件保留开发身份，生产配置幂等且禁止调试签名回退', async () => {
  const plugin = resolveConfigPluginFunction(project,'./plugins/with-release-signing.ts');
  try {
    process.env.APP_VARIANT = 'development';
    assert.deepEqual(plugin({name:'Folio',slug:'folio'}),{name:'Folio',slug:'folio'});
    process.env.APP_VARIANT = 'production';
    const config = plugin({name:'Folio',slug:'folio'});
    const input = { ...config, modRequest: { platform:'android',modName:'appBuildGradle',projectRoot:project }, modResults: { language:'groovy',contents:'android {}' } };
    const first = await config.mods.android.appBuildGradle(input);
    const second = await config.mods.android.appBuildGradle(first);
    assert.equal(first.modResults.contents,second.modResults.contents);
    assert.match(first.modResults.contents,/signingConfig folioHasSigning \? signingConfigs.folioRelease : null/);
    assert.match(first.modResults.contents,/!folioBuildOnly && !folioHasSigning/);
    assert.match(first.modResults.contents,/\.signing\/android\.properties/);
    assert.doesNotMatch(first.modResults.contents,/signingConfigs.debug/);
  } finally { if (original === undefined) delete process.env.APP_VARIANT; else process.env.APP_VARIANT = original; }
});
test('缺少固定密钥时正式发布失败，仅构建模式可继续', () => {
  const env = {...process.env,FOLIO_KEYSTORE_BASE64:'',FOLIO_KEYSTORE_PASSWORD:'',FOLIO_KEY_ALIAS:'',FOLIO_KEY_PASSWORD:'',FOLIO_KEYSTORE_PATH:'',FOLIO_BUILD_ONLY:'0'};
  const script = resolve(project,'../../tools/releases/signing.mjs');
  assert.notEqual(spawnSync(process.execPath,[script],{env}).status,0);
  assert.equal(spawnSync(process.execPath,[script],{env:{...env,FOLIO_BUILD_ONLY:'1'}}).status,0);
});
