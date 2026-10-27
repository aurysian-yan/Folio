import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { resolveConfigPluginFunction } = require('@expo/config-plugins/build/utils/plugin-resolver');
const project = resolve(import.meta.dirname, '..');

test('双版本插件重复生成后保留相同应用身份与递增构建号', async () => {
  const plugin = resolveConfigPluginFunction(project, './plugins/with-android-glass-tiers.ts');
  const config = plugin({ name: 'Folio', slug: 'folio' });
  const input = { ...config, modRequest: { platform: 'android', modName: 'appBuildGradle', projectRoot: project },
    modResults: { language: 'groovy', contents: "android { defaultConfig { applicationId 'com.folio.mobile.poc' } }" } };
  const first = await config.mods.android.appBuildGradle(input);
  const second = await config.mods.android.appBuildGradle(first);
  assert.equal(first.modResults.contents, second.modResults.contents);
  assert.match(first.modResults.contents, /applicationId 'com\.folio\.mobile\.poc'/);
  assert.match(first.modResults.contents, /legacy \{[\s\S]*?minSdk 30[\s\S]*?folioBuildBase \* 10 \+ 1/);
  assert.match(first.modResults.contents, /glasmio \{[\s\S]*?minSdk 33[\s\S]*?folioBuildBase \* 10 \+ 2/);
  assert.doesNotMatch(first.modResults.contents, /maxSdk|applicationIdSuffix/);
});

test('双版本插件固定实际 Kotlin 插件并关闭未发布的编译优化制品', async () => {
  const plugin = resolveConfigPluginFunction(project, './plugins/with-android-glass-tiers.ts');
  const config = plugin({ name: 'Folio', slug: 'folio' });
  const input = { ...config, modRequest: { platform: 'android', modName: 'projectBuildGradle', projectRoot: project },
    modResults: { language: 'groovy', contents: "buildscript { dependencies { classpath('org.jetbrains.kotlin:kotlin-gradle-plugin'); classpath('com.android.tools.build:gradle') } }" } };
  const root = await config.mods.android.projectBuildGradle(input);
  assert.match(root.modResults.contents, /org\.jetbrains\.kotlin:kotlin-gradle-plugin:2\.4\.21/);
  const properties = { ...input, modResults: [{ type: 'property', key: 'expo.enableCompileTimeOptimization', value: 'true' }] };
  const first = await config.mods.android.gradleProperties(properties);
  const second = await config.mods.android.gradleProperties(first);
  assert.deepEqual(first.modResults, second.modResults);
  const values = Object.fromEntries(first.modResults.map(({ key, value }: { key: string; value: string }) => [key, value]));
  assert.equal(values['expo.enableCompileTimeOptimization'], 'false');
  assert.match(values['org.gradle.jvmargs'], /MaxMetaspaceSize=2048m/);
  assert.equal(values['org.gradle.workers.max'], '2');
  assert.equal(values['android.builtInKotlin'], 'false');
  assert.match(root.modResults.contents, /com\.android\.tools\.build:gradle:9\.1\.0/);
});

test('Glasmio 模块注册不重复且只包含四个依赖模块', async () => {
  const plugin = resolveConfigPluginFunction(project, './plugins/with-android-glass-tiers.ts');
  const config = plugin({ name: 'Folio', slug: 'folio' });
  const input = { ...config, modRequest: { platform: 'android', modName: 'settingsGradle', projectRoot: project },
    modResults: { language: 'groovy', contents: "include ':app'" } };
  const first = await config.mods.android.settingsGradle(input);
  const second = await config.mods.android.settingsGradle(first);
  assert.equal(first.modResults.contents, second.modResults.contents);
  assert.match(first.modResults.contents, /\['core', 'glass', 'icons', 'ui'\]/);
  assert.doesNotMatch(first.modResults.contents, /glasmio-scaffold|glasmio-preference|:sample/);
});
