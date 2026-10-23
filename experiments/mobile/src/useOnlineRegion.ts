import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import {
  onlineRegionCacheFresh, onlineRegionCacheKey, onlineRegionKind, onlineRegionTraceUrl,
  parseOnlineRegionCache, parseOnlineRegionTrace, type OnlineRegionKind,
} from './online-region';

const timeoutMs = 4000;
const write = (value: string) => AsyncStorage.setItem(onlineRegionCacheKey, value).catch(() => undefined);

// 只在在线字体页激活且启用区域提示时查询一次网络出口；结果失败时保持未知，不伪造地区。
export function useOnlineRegion(enabled: boolean): OnlineRegionKind {
  const [kind, setKind] = useState<OnlineRegionKind>('UNKNOWN');
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const controller = new AbortController();
    const detect = async () => {
      const cached = parseOnlineRegionCache(await AsyncStorage.getItem(onlineRegionCacheKey).catch(() => null));
      if (!current) return;
      if (onlineRegionCacheFresh(cached)) {
        setKind(onlineRegionKind(cached));
        return;
      }
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(onlineRegionTraceUrl, {
          signal: controller.signal, headers: { Accept: 'text/plain' },
        });
        const snapshot = { country: parseOnlineRegionTrace(await response.text()), checkedAt: Date.now() };
        await write(JSON.stringify(snapshot));
        if (current) setKind(onlineRegionKind(snapshot));
      } catch {
        if (!current) return;
        // 查询失败只记录时间，一小时内使用通用失败文案。
        await write(JSON.stringify({ country: null, checkedAt: Date.now() }));
        if (current) setKind('UNKNOWN');
      } finally {
        clearTimeout(timer);
      }
    };
    void detect().catch(() => undefined);
    return () => { current = false; controller.abort(); };
  }, [enabled]);
  return kind;
}
