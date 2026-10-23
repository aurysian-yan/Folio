import type { OnlineProvider } from './online';

// 区域提示使用免费的公共出口查询，只判断国家/地区，不涉及账号或浏览内容。
export const onlineRegionTraceUrl = 'https://www.cloudflare.com/cdn-cgi/trace';
export const onlineRegionCacheKey = 'folio.mobile.online-region.v1';
export const onlineRegionFreshMs = 24 * 60 * 60 * 1000;
export const onlineRegionRetryMs = 60 * 60 * 1000;

// 已知在大陆可能需要额外网络环境的来源；按域名匹配，自定义来源同样适用。
export const onlineRegionRestrictedHosts = ['fonts.google.com', 'fontlibrary.org'] as const;

export type OnlineRegionKind = 'CN' | 'OTHER' | 'UNKNOWN';

export interface OnlineRegionSnapshot {
  country: string | null;
  checkedAt: number;
}

function hostOf(value: string | null | undefined) {
  const match = /^https:\/\/([^/?#]+)/i.exec(value?.trim() ?? '');
  if (!match || !match[1]) return null;
  return match[1].toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
}

export function onlineRegionRestricted(host: string | null) {
  if (!host) return false;
  return onlineRegionRestrictedHosts.some((item) => host === item || host.endsWith(`.${item}`));
}

export function providerRegionRisk(provider: Pick<OnlineProvider, 'homepage' | 'searchTemplate'> | null | undefined) {
  return onlineRegionRestricted(hostOf(provider?.homepage)) || onlineRegionRestricted(hostOf(provider?.searchTemplate));
}

// 只接受 Cloudflare trace 中的两位国家代码；XX 表示无法识别，按未知处理。
export function parseOnlineRegionTrace(value: string) {
  const match = /(?:^|\r?\n)loc=([A-Z]{2})(?:\r?\n|$)/.exec(value);
  const country = match?.[1];
  return country && country !== 'XX' ? country : null;
}

export function parseOnlineRegionCache(raw: string | null): OnlineRegionSnapshot | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { country?: unknown; checkedAt?: unknown };
    if (typeof value.checkedAt !== 'number' || !Number.isFinite(value.checkedAt)) return null;
    if (value.country !== null && !(typeof value.country === 'string' && /^[A-Z]{2}$/.test(value.country))) return null;
    const country = value.country === null ? null : value.country as string;
    return { country, checkedAt: value.checkedAt };
  } catch {
    return null;
  }
}

// 成功结果保留一天；失败结果一小时后再试，避免频繁请求。
export function onlineRegionCacheFresh(snapshot: OnlineRegionSnapshot | null, now = Date.now()) {
  if (!snapshot) return false;
  const age = now - snapshot.checkedAt;
  return age >= 0 && age < (snapshot.country ? onlineRegionFreshMs : onlineRegionRetryMs);
}

export function onlineRegionKind(snapshot: OnlineRegionSnapshot | null): OnlineRegionKind {
  if (!snapshot?.country) return 'UNKNOWN';
  return snapshot.country === 'CN' ? 'CN' : 'OTHER';
}
