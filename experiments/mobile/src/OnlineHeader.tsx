import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { GlobeIcon, HouseIcon } from './icons';
import type { OnlineProvider } from './online';
import { OnlineSourceIcon } from './OnlineSourceIcon';
import type { Theme } from './ui';

// 图标分段切换保留动态来源与临时网页，读屏名称仍使用完整标题。
export function OnlineHeader({ theme, providers, webTabs, selectedId, onStart, onSelect, onWebTab }: {
  theme: Theme; providers: OnlineProvider[]; webTabs: { id: string; title: string }[]; selectedId: string;
  onStart: () => void; onSelect: (provider: OnlineProvider) => void; onWebTab: (id: string) => void;
}) {
  const { t } = useTranslation();
  const scroll = useRef<ScrollView>(null);
  const positions = useRef<Record<string, number>>({});
  useEffect(() => {
    if (selectedId !== 'start' && positions.current[selectedId] !== undefined) {
      scroll.current?.scrollTo({ x: Math.max(0, positions.current[selectedId]! - 48), animated: true });
    }
  }, [selectedId]);

  function segment(id: string, title: string, onPress: () => void, provider?: OnlineProvider) {
    const selected = id === selectedId;
    return <Pressable key={id} onLayout={({ nativeEvent }) => {
      positions.current[id] = nativeEvent.layout.x;
    }} accessibilityRole="tab" accessibilityLabel={title} accessibilityState={{ selected }} onPress={onPress}
      style={({ pressed }) => [styles.segment, { backgroundColor: selected ? theme.selection : 'transparent',
        opacity: pressed ? 0.65 : 1 }]}>
      {provider
        ? <OnlineSourceIcon provider={provider} theme={theme} size={22} />
        : id === 'start'
          ? <HouseIcon size={22} color={selected ? theme.accent : theme.secondary} />
          : <GlobeIcon size={22} color={selected ? theme.accent : theme.secondary} />}
    </Pressable>;
  }

  return <View style={[styles.header, { backgroundColor: theme.background, borderBottomColor: theme.border }]}>
    <View accessibilityRole="tablist" style={[styles.track, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {segment('start', t('browser.start'), onStart)}
    </View>
    {(providers.length > 0 || webTabs.length > 0) && <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist" keyboardShouldPersistTaps="handled" style={styles.scroll}
      contentContainerStyle={[styles.track, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {providers.map((item) => segment(item.id, item.name, () => onSelect(item), item))}
      {webTabs.map((item) => segment(item.id, item.title, () => onWebTab(item.id)))}
    </ScrollView>}
  </View>;
}

const styles = StyleSheet.create({
  header: { minHeight: 62, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  scroll: { flexGrow: 0, flexShrink: 1 },
  track: { flexDirection: 'row', alignItems: 'center', padding: 3, borderRadius: 26, borderWidth: StyleSheet.hairlineWidth },
  segment: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
