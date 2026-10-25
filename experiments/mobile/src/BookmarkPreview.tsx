import { useEffect, useState, type ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { browserAddress, browserHost } from './browser-data';
import { parsePagePreview, type PagePreview } from './browser-dashboard';
import { useBrowserData } from './BrowserDataProvider';
import { OnlineSourceIcon } from './OnlineSourceIcon';
import type { OnlineProvider } from './online';
import type { Theme } from './ui';

let running = 0;
const waiting: (() => void)[] = [];
const pending = new Map<string, Promise<PagePreview>>();
function loadPreview(url: string) {
  const current = pending.get(url);
  if (current) return current;
  const task = (async () => {
    if (running >= 3) await new Promise<void>((resolve) => waiting.push(resolve));
    else running += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit', headers: { Accept: 'text/html' } });
      if (!response.ok || !browserAddress(response.url || url) || !response.headers.get('content-type')?.includes('text/html')
        || Number(response.headers.get('content-length')) > 2097152) throw new Error('unavailable');
      return parsePagePreview(await response.text(), response.url || url);
    } catch { return { title: '', description: '', image: null, fetchedAt: Date.now() }; }
    finally { clearTimeout(timeout); const next = waiting.shift(); if (next) next(); else running -= 1; pending.delete(url); }
  })();
  pending.set(url, task);
  return task;
}

// 详细卡片按网址共用摘要缓存，失败时保留名称和来源。
export function BookmarkPreview({ url, title, provider, theme, afterTitle, active = true }: { url: string; title: string; provider?: OnlineProvider; theme: Theme; afterTitle?: ReactNode; active?: boolean }) {
  const { data, change } = useBrowserData();
  const preview = data.previews[url];
  const [failedImage, setFailedImage] = useState<string | null>(null);
  useEffect(() => {
    if (!active || !browserAddress(url) || preview && Date.now() - preview.fetchedAt < 86400000) return;
    let mounted = true;
    void loadPreview(url).then((result) => {
      if (!mounted) return;
      change((data) => ({ ...data, previews: Object.fromEntries([...Object.entries(data.previews).filter(([key]) => key !== url), [url, result]].slice(-100)) }));
    });
    return () => { mounted = false; };
  }, [active, change, url, preview]);
  return <>
    {preview?.image && failedImage !== preview.image ? <Image accessibilityIgnoresInvertColors source={{ uri: preview.image }} style={styles.image}
      onError={() => setFailedImage(preview.image)} resizeMode="cover" /> : <View style={styles.fallback}><OnlineSourceIcon provider={provider} theme={theme} size={36} /></View>}
    <Text numberOfLines={2} style={[styles.title, { color: theme.label }]}>{title}</Text>
    {afterTitle}
    {!!preview?.title && preview.title !== title && <Text numberOfLines={2} style={[styles.text, { color: theme.label }]}>{preview.title}</Text>}
    {!!preview?.description && <Text numberOfLines={3} style={[styles.text, { color: theme.secondary }]}>{preview.description}</Text>}
    <Text numberOfLines={1} style={[styles.text, { color: theme.secondary }]}>{browserHost(url)}</Text>
  </>;
}
const styles = StyleSheet.create({ image: { width: '100%', aspectRatio: 1.8, borderRadius: 12 }, fallback: { minHeight: 80, alignItems: 'center', justifyContent: 'center' }, title: { alignSelf: 'stretch', textAlign: 'left', fontSize: 16, lineHeight: 22, fontWeight: '600' }, text: { alignSelf: 'stretch', textAlign: 'left' } });
