import assert from 'node:assert/strict';
import test from 'node:test';
import {
  onlineRegionCacheFresh, onlineRegionFreshMs, onlineRegionKind, onlineRegionRetryMs,
  parseOnlineRegionCache, parseOnlineRegionTrace, providerRegionRisk,
} from './online-region.ts';
import { isPageFailureKey, pageFailureDetailKey } from './online.ts';

const provider = (homepage: string) => ({ homepage, searchTemplate: `${homepage}?q={{query}}` });

test('受限来源按域名匹配，自定义与子域同样识别', () => {
  assert.equal(providerRegionRisk(provider('https://fonts.google.com/')), true);
  assert.equal(providerRegionRisk(provider('https://www.fontlibrary.org/')), true);
  assert.equal(providerRegionRisk(provider('https://sub.fonts.google.com/')), true);
  assert.equal(providerRegionRisk(provider('https://www.maoken.com/')), false);
  assert.equal(providerRegionRisk(provider('https://fonts.google.com.evil.example/')), false);
  assert.equal(providerRegionRisk(null), false);
});

test('出口查询只接受两位国家代码，缺失或异常按未知处理', () => {
  assert.equal(parseOnlineRegionTrace('fl=1\nh=www.cloudflare.com\nloc=CN\ntls=TLSv1.3\n'), 'CN');
  assert.equal(parseOnlineRegionTrace('loc=JP'), 'JP');
  assert.equal(parseOnlineRegionTrace('loc=\n'), null);
  assert.equal(parseOnlineRegionTrace('loc=CHN\n'), null);
  assert.equal(parseOnlineRegionTrace('loc=XX\n'), null);
  assert.equal(parseOnlineRegionTrace(''), null);
});

test('区域缓存区分成功与失败的有效期', () => {
  const now = 10_000_000;
  assert.equal(onlineRegionCacheFresh({ country: 'CN', checkedAt: now - onlineRegionFreshMs + 1 }, now), true);
  assert.equal(onlineRegionCacheFresh({ country: 'CN', checkedAt: now - onlineRegionFreshMs }, now), false);
  assert.equal(onlineRegionCacheFresh({ country: null, checkedAt: now - onlineRegionRetryMs + 1 }, now), true);
  assert.equal(onlineRegionCacheFresh({ country: null, checkedAt: now - onlineRegionRetryMs }, now), false);
  assert.equal(onlineRegionCacheFresh(null, now), false);
  assert.equal(onlineRegionCacheFresh({ country: 'CN', checkedAt: now + 1 }, now), false);
});

test('缓存解析拒绝损坏字段并保留国家', () => {
  assert.deepEqual(parseOnlineRegionCache('{"country":"CN","checkedAt":12}'), { country: 'CN', checkedAt: 12 });
  assert.deepEqual(parseOnlineRegionCache('{"country":null,"checkedAt":12}'), { country: null, checkedAt: 12 });
  assert.equal(parseOnlineRegionCache('{"country":"china","checkedAt":12}'), null);
  assert.equal(parseOnlineRegionCache('{"country":"CN"}'), null);
  assert.equal(parseOnlineRegionCache('bad json'), null);
  assert.equal(parseOnlineRegionCache(null), null);
});

test('区域状态只区分大陆、其他与未知', () => {
  assert.equal(onlineRegionKind({ country: 'CN', checkedAt: 0 }), 'CN');
  assert.equal(onlineRegionKind({ country: 'JP', checkedAt: 0 }), 'OTHER');
  assert.equal(onlineRegionKind({ country: null, checkedAt: 0 }), 'UNKNOWN');
  assert.equal(onlineRegionKind(null), 'UNKNOWN');
});

test('只有整页加载失败进入失败页，其余错误保留顶部提示', () => {
  for (const key of ['online.browser.loadError', 'online.browser.offline', 'online.browser.unreachable',
    'online.browser.serverError', 'online.browser.secureConnection']) {
    assert.equal(isPageFailureKey(key), true);
  }
  assert.equal(isPageFailureKey('online.browser.unsupportedLink'), false);
  assert.equal(isPageFailureKey(null), false);
  assert.equal(pageFailureDetailKey('online.browser.offline'), 'online.browser.failureOffline');
  assert.equal(pageFailureDetailKey('online.browser.unreachable'), 'online.browser.failureUnreachable');
  assert.equal(pageFailureDetailKey('online.browser.serverError'), 'online.browser.failureServer');
  assert.equal(pageFailureDetailKey('online.browser.secureConnection'), 'online.browser.failureSecure');
  assert.equal(pageFailureDetailKey('online.browser.loadError'), 'online.browser.failureGeneric');
});
