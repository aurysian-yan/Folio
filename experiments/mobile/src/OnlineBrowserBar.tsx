import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Animated, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MagnifyingGlassIcon } from './icons';
import { browserHost } from './browser-data';
import { browserPageTitle, type BrowserState, type OnlineProvider } from './online';
import { OnlineSourceIcon } from './OnlineSourceIcon';
import { PanelBackdrop } from './PanelBackdrop';
import { navigationCompactBarFrame } from './bottom-navigation';
import type { Theme } from './ui';

// 标题条仅承担统一地址与工具弹窗的入口。
export function OnlineBrowserBar({ theme, provider, browser, address, bottom, sourceId, compact = false, start, badge, attention, onEdit }: {
  theme: Theme; provider: OnlineProvider | null; browser: BrowserState; address: string; bottom: number; sourceId: string;
  compact?: boolean; start: boolean; badge: number; attention: boolean; onEdit: () => void;
}) {
  const { t } = useTranslation();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [progress] = useState(() => new Animated.Value(compact ? 1 : 0));
  const { width } = useWindowDimensions();
  const inset = useSafeAreaInsets();
  const frame = navigationCompactBarFrame(inset.bottom, width - inset.left - inset.right);
  const expandedSide = Platform.OS === 'android' ? Math.max(0, frame.sideInset - 56) : 12;
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReduceMotion(value); });
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; motion.remove(); };
  }, []);
  useEffect(() => {
    if (reduceMotion) { progress.setValue(compact ? 1 : 0); return; }
    const animation = Animated.spring(progress, { toValue: compact ? 1 : 0, stiffness: 200, damping: 28.3, mass: 1, useNativeDriver: false });
    animation.start(); return () => animation.stop();
  }, [compact, progress, reduceMotion]);
  const url = (browser.url || address).replace(/^https:\/\//, '');
  const title = browserPageTitle(browser.title, provider, browser.url || address) || provider?.name || browserHost(browser.url || address) || t('online.title');
  return <Animated.View style={[styles.wrap, {
    bottom: progress.interpolate({ inputRange: [0, 1], outputRange: [bottom, frame.bottom], extrapolate: 'clamp' }),
    left: Animated.add(inset.left, progress.interpolate({ inputRange: [0, 1], outputRange: [expandedSide, frame.sideInset], extrapolate: 'clamp' })),
    right: Animated.add(inset.right, progress.interpolate({ inputRange: [0, 1], outputRange: [expandedSide, frame.sideInset], extrapolate: 'clamp' })),
    height: compact ? 48 : 56,
  }]}>
    {Platform.OS === 'android' && <PanelBackdrop navigationGlass sourceId={sourceId} theme={theme} style={StyleSheet.absoluteFill} />}
    <Pressable accessibilityRole="button" accessibilityLabel={`${start ? t('browser.searchOrAddress') : title}，${t('browser.pageTools')}${badge ? `，${t('browser.downloading', { count: badge })}` : attention ? `，${t('browser.needsAttention')}` : ''}`}
      onPress={onEdit} style={({ pressed }) => [styles.bar, { opacity: pressed ? 0.7 : 1 }, Platform.OS !== 'android' && { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth }]}>
      <View style={styles.titleRow}>
        {start ? <MagnifyingGlassIcon size={20} color={theme.secondary} /> : <OnlineSourceIcon provider={provider} theme={theme} size={20} />}
        <Text numberOfLines={1} style={[styles.title, { color: start ? theme.secondary : theme.label, fontWeight: start ? '400' : '600' }]}>{start ? t('browser.searchOrAddress') : title}</Text>
        {(badge > 0 || attention) && <Text style={{ color: theme.accent, fontSize: 11 }}>{badge || '•'}</Text>}
      </View>
      {!start && !compact && <Text numberOfLines={1} style={[styles.url, { color: theme.secondary }]}>{url}</Text>}
    </Pressable>
  </Animated.View>;
}
const styles = StyleSheet.create({ wrap: { position: 'absolute' }, bar: { borderRadius: 28, paddingHorizontal: 12, flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  titleRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, maxWidth: '100%' }, title: { flexShrink: 1, fontSize: 15, textAlign: 'center' }, url: { fontSize: 11, textAlign: 'center' } });
