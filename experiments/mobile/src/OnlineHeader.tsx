import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { OnlineProvider } from './online';
import { OnlineSourceIcon } from './OnlineSourceIcon';
import type { Theme } from './ui';

// 起始页固定首位，来源与临时网页只承担标签切换。
export function OnlineHeader({ theme, providers, webTabs, selectedId, onStart, onSelect, onWebTab }: {
  theme: Theme; providers: OnlineProvider[]; webTabs: { id: string; title: string }[]; selectedId: string;
  onStart: () => void; onSelect: (provider: OnlineProvider) => void; onWebTab: (id: string) => void;
}) {
  const { t } = useTranslation();
  const scroll = useRef<ScrollView>(null);
  const positions = useRef<Record<string, number>>({});
  useEffect(() => {
    if (selectedId !== 'start' && positions.current[selectedId] !== undefined) scroll.current?.scrollTo({ x: Math.max(0, positions.current[selectedId]! - 4), animated: false });
  }, [selectedId]);
  function tab(id: string, title: string, onPress: () => void, provider?: OnlineProvider) {
    const selected = id === selectedId;
    return <Pressable key={id} onLayout={({ nativeEvent }) => {
      positions.current[id] = nativeEvent.layout.x;
      if (selected && id !== 'start') scroll.current?.scrollTo({ x: Math.max(0, nativeEvent.layout.x - 4), animated: false });
    }} accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress}
      style={({ pressed }) => [styles.tab, { backgroundColor: selected ? theme.selection : theme.surface,
        borderColor: selected ? theme.accent : theme.border, opacity: pressed ? 0.7 : 1 }]}>
      {provider && <OnlineSourceIcon provider={provider} theme={theme} />}
      <Text numberOfLines={1} style={[styles.label, { color: selected ? theme.accent : theme.label }]}>{title}</Text>
    </Pressable>;
  }
  return <View style={[styles.header, { backgroundColor: theme.background, borderBottomColor: theme.border }]}>
    {tab('start', t('browser.start'), onStart)}
    <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.row}>
      {providers.map((item) => tab(item.id, item.name, () => onSelect(item), item))}
      {webTabs.map((item) => tab(item.id, item.title, () => onWebTab(item.id)))}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  header: { minHeight: 52, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { alignItems: 'center', gap: 6, paddingRight: 4 },
  tab: { minHeight: 36, maxWidth: 196, paddingHorizontal: 12, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
});
