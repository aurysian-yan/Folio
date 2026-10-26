import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  browserPageTitle, buildWebThemeCss, buildWebThemeScript, createOnlineClient, downloadDisplayName, extractSearchQuery, onlineErrorKey,
  providerCustomCss, providerThemeEnabled, type OnlineBridge, type OnlineProvider,
} from './online.ts';

const provider = (id: string, homepage: string, searchTemplate: string): OnlineProvider => ({
  id, name: id, homepage, searchTemplate, enabled: true, builtin: true,
});

test('下载名称还原中文和空格，保留字面加号与无效编码且不重复解码', () => {
  assert.equal(downloadDisplayName('%E6%80%9D%E6%BA%90%20Sans.zip'), '思源 Sans.zip');
  assert.equal(downloadDisplayName("UTF-8'zh-CN'%E5%AD%97%E4%BD%93.ttf"), '字体.ttf');
  assert.equal(downloadDisplayName('字体+A 100%.zip'), '字体+A 100%.zip');
  assert.equal(downloadDisplayName('%25E5%25AD%2597.ttf'), '%E5%AD%97.ttf');
  assert.equal(downloadDisplayName('font%ZZ%E5.ttf'), 'font%ZZ%E5.ttf');
});

test('下载记录和压缩包名称统一展示解码文本，保留原生任务与条目标识', async () => {
  const bridge = {
    onlineState: async () => JSON.stringify({ providers: [], jobs: [{ id: 'job', name: '%E5%AD%97%E4%BD%93.zip' }] }),
    onlineInspect: async () => JSON.stringify([{ id: '7', name: '%E5%AD%97%E4%BD%93/static/A%20Bold.ttf', previewPath: '/private/font.ttf' }]),
  } as unknown as OnlineBridge;
  const client = createOnlineClient(bridge);
  assert.equal((await client.state()).jobs[0]?.name, '字体.zip');
  assert.deepEqual(await client.inspect('job'), [{ id: '7', name: '字体/static/A Bold.ttf', previewPath: '/private/font.ttf' }]);
});

test('浏览标题仅清理已识别的站点后缀，不截断正文或清空首页标题', () => {
  const google = { ...provider('google-fonts', 'https://fonts.google.com/', ''), name: 'Google Fonts' };
  assert.equal(browserPageTitle('Roboto - Google Fonts', google, google.homepage), 'Roboto');
  assert.equal(browserPageTitle('Roboto | Google Fonts — fonts.google.com', google, google.homepage), 'Roboto');
  assert.equal(browserPageTitle('Google Fonts', google, google.homepage), 'Google Fonts');
  assert.equal(browserPageTitle('Google Fonts - Variable families', google, google.homepage), 'Google Fonts - Variable families');
  assert.equal(browserPageTitle('Roboto-Slab: Styles', google, google.homepage), 'Roboto-Slab: Styles');
  assert.equal(browserPageTitle('思源黑体-猫啃网', { ...google, name: '猫啃网', homepage: 'https://www.maoken.com/' }, 'https://www.maoken.com/font'), '思源黑体');
  assert.equal(browserPageTitle('Noto Serif Display-猫啃网免费字体下载', { ...google, name: '猫啃网', homepage: 'https://www.maoken.com/' }, 'https://www.maoken.com/font'), 'Noto Serif Display');
  assert.equal(browserPageTitle('字体介绍 - Google Fonts Open Sans', google, google.homepage), '字体介绍 - Google Fonts Open Sans');
  assert.equal(browserPageTitle('Inter | EXAMPLE.COM', null, 'https://example.com/font'), 'Inter');
  assert.equal(browserPageTitle('下载说明 - Google Fonts', google, 'https://example.com/'), '下载说明 - Google Fonts');
});

test('Google Fonts 默认隐藏网站主题按钮，自定义内容和显式清空优先', () => {
  assert.equal(providerCustomCss(undefined, 'google-fonts'), 'gf-theme-toggle{display:none;}');
  assert.equal(providerCustomCss(undefined, 'maoken'), '');
  assert.equal(providerCustomCss('', 'google-fonts'), '');
  assert.equal(providerCustomCss('body{color:red;}', 'google-fonts'), 'body{color:red;}');
});

test('在线服务保留原生任务状态和压缩包选择标识', async () => {
  const calls: unknown[] = [];
  const bridge = {
    onlineState: async () => JSON.stringify({ accepted: true, providers: [], jobs: [{ id: 'job', name: 'font.zip', state: 'ready', bytesDone: 12, bytesTotal: 12 }] }),
    onlineInspect: async () => JSON.stringify([{ id: '7', name: 'font.ttf', eligible: true, duplicate: false }]),
    onlineImport: async (id: string, selected: string[]) => { calls.push([id, selected]); return { snapshot: {}, items: [] }; },
  } as unknown as OnlineBridge;
  const client = createOnlineClient(bridge);
  assert.equal((await client.state()).jobs[0]?.bytesTotal, 12);
  assert.equal((await client.inspect('job'))[0]?.id, '7');
  await client.collect('job', ['7']); assert.deepEqual(calls, [['job', ['7']]]);
});

test('错误显示只使用本地化键', () => {
  assert.equal(onlineErrorKey(new Error('native: online.browser.expiredLink')), 'online.browser.expiredLink');
  assert.equal(onlineErrorKey(new Error('https://example.com/?token=secret')), 'common.operationFailed');
});

test('自定义图标保留资源标识与缓存地址，来源保存保留选择', async () => {
  let saved = '';
  const icon = { assetId: 'a'.repeat(64), uri: 'file:///private/online-icons/icon.png' };
  const bridge = {
    onlineImportIcon: async (uri: string) => { assert.equal(uri, 'content://picked/image'); return JSON.stringify(icon); },
    onlineSaveProviders: async (value: string) => { saved = value; },
  } as unknown as OnlineBridge;
  const client = createOnlineClient(bridge);
  assert.deepEqual(await client.importIcon('content://picked/image'), icon);
  await client.saveProviders([{ id: 'source', name: '字体来源', homepage: 'https://example.com/', searchTemplate: 'https://example.com/?q={{query}}', builtin: false, enabled: true,
    icon: { kind: 'custom', assetId: icon.assetId }, iconUri: icon.uri }]);
  assert.equal(JSON.parse(saved)[0].icon.assetId, icon.assetId);
});

test('站内搜索词可从查询参数和路径模板还原', () => {
  assert.equal(extractSearchQuery(provider('google-fonts', 'https://fonts.google.com/', 'https://fonts.google.com/?query={{query}}'),
    'https://fonts.google.com/?query=Noto%20Sans&preview.text=abc'), 'Noto Sans');
  assert.equal(extractSearchQuery(provider('maoken', 'https://www.maoken.com/', 'https://www.maoken.com/?s={{query}}'),
    'https://www.maoken.com/?s=%E5%AD%97%E4%BD%93+%E6%B5%8B%E8%AF%95'), '字体 测试');
  assert.equal(extractSearchQuery(provider('100font', 'https://www.100font.com/', 'https://www.100font.com/search.htm?keyword={{query}}'),
    'https://www.100font.com/search.htm?keyword=%E6%80%9D%E6%BA%90'), '思源');
  assert.equal(extractSearchQuery(provider('zeoseven', 'https://fonts.zeoseven.com/', 'https://fonts.zeoseven.com/search/?text={{query}}'),
    'https://fonts.zeoseven.com/search/?text=%E5%AE%8B%E4%BD%93'), '宋体');
  assert.equal(extractSearchQuery(provider('custom', 'https://example.com/', 'https://example.com/search/{{query}}'),
    'https://example.com/search/Inter?lang=zh'), 'Inter');
  assert.equal(extractSearchQuery(provider('custom', 'https://example.com/', 'https://example.com/?q={{query}}'),
    'https://example.com/?q=Inter'), 'Inter');
  assert.equal(extractSearchQuery(provider('google-fonts', 'https://fonts.google.com/', 'https://fonts.google.com/?query={{query}}'),
    'https://example.com/?query=Inter'), null);
  assert.equal(extractSearchQuery(provider('google-fonts', 'https://fonts.google.com/', 'https://fonts.google.com/?query={{query}}'),
    'https://fonts.google.com/'), null);
});

test('站内配色默认只开启 Google Fonts，并生成可覆盖的语义变量', () => {
  assert.equal(providerThemeEnabled(undefined, 'google-fonts'), true);
  assert.equal(providerThemeEnabled(undefined, 'maoken'), false);
  assert.equal(providerThemeEnabled(false, 'google-fonts'), false);
  assert.equal(providerThemeEnabled(true, 'maoken'), true);
  const css = buildWebThemeCss({ primary: '#123456', background: '#000000', surface: '#F5F5F5', onSurface: '#111111' }, true);
  assert.match(css, /--sys-primary:#123456 !important/);
  assert.match(css, /--sys-on-surface:#111111 !important/);
  assert.match(css, /--mat-app-background-color/);
  assert.match(css, /color-scheme:dark/);
  assert.match(css, /--folio-primary:#123456/);
});

test('样式脚本在关闭自动配色时仍保留自定义 CSS，并能移除旧样式', () => {
  const custom = '.gf-header { background: #000; }</style><script>alert(1)</script>';
  const script = buildWebThemeScript({ palette: { primary: '#123456' }, dark: false, enabled: false, customCss: custom });
  assert.match(script, /gf-header/);
  assert.doesNotMatch(script, /<\/style>/);
  const empty = buildWebThemeScript({ palette: { primary: '#123456' }, dark: false, enabled: false, customCss: '' });
  assert.match(empty, /removeChild/);
});

test('网页完成加载且样式表注入成功后才确认就绪', () => {
  const css = 'body{color:red;}';
  const script = buildWebThemeScript({ palette: {}, dark: false, enabled: false, customCss: css });
  const style = { id: '', textContent: '', sheet: {} as object | null };
  const document = {
    readyState: 'loading',
    getElementById: () => null,
    createElement: () => style,
    head: { appendChild: () => {} },
  };
  assert.equal(runInNewContext(script, { document }), false);
  document.readyState = 'interactive';
  assert.equal(runInNewContext(script, { document }), false);
  document.readyState = 'complete';
  style.sheet = null;
  assert.equal(runInNewContext(script, { document }), false);
  style.sheet = {};
  assert.equal(runInNewContext(script, { document }), true);
  assert.equal(style.textContent, css);
});

test('关闭配色并清空 CSS 时等待网页加载完成，清除旧样式后确认就绪', () => {
  const script = buildWebThemeScript({ palette: {}, dark: false, enabled: false, customCss: '' });
  let removed = false;
  const style = { parentNode: { removeChild: () => { removed = true; } } };
  const document = { readyState: 'loading', getElementById: () => removed ? null : style };
  assert.equal(runInNewContext(script, { document }), false);
  assert.equal(removed, true);
  document.readyState = 'complete';
  assert.equal(runInNewContext(script, { document }), true);
});
