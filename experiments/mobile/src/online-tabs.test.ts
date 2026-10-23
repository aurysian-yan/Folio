import assert from 'node:assert/strict';
import test from 'node:test';
import { mostRecentTab } from './online-tabs.ts';

test('关闭标签页后选择最近使用的一项', () => {
  const tabs = [
    { providerId: 'google-fonts', activatedAt: 3 },
    { providerId: 'zeoseven', activatedAt: 9 },
    { providerId: 'maoken', activatedAt: 5 },
  ];
  assert.equal(mostRecentTab(tabs)?.providerId, 'zeoseven');
  assert.equal(mostRecentTab(tabs.filter((tab) => tab.providerId !== 'zeoseven'))?.providerId, 'maoken');
  assert.equal(mostRecentTab([]), null);
});
