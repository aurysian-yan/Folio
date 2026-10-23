import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { DownloadSimpleIcon, MagnifyingGlassIcon, XIcon } from './icons';
import type { OnlineProvider } from './online';
import { OnlineSourceIcon } from './OnlineSourceIcon';
import { IconButton, type Theme } from './ui';

// 在线字体顶栏：来源 tab、隐藏式搜索与下载入口，不再显示大标题。
export function OnlineHeader({ theme, providers, selectedId, searchOpen, searchText, onSelect, onSearchChange, onSearchOpen, onSearchClose, onSearchSubmit, onDownloads }: {
  theme: Theme;
  providers: OnlineProvider[];
  selectedId: string;
  searchOpen: boolean;
  searchText: string;
  onSelect: (provider: OnlineProvider) => void;
  onSearchChange: (value: string) => void;
  onSearchOpen: () => void;
  onSearchClose: () => void;
  onSearchSubmit: () => void;
  onDownloads: () => void;
}) {
  const { t } = useTranslation();
  const input = useRef<TextInput>(null);
  useEffect(() => { if (searchOpen) input.current?.focus(); }, [searchOpen]);

  return <View style={[styles.header, { backgroundColor: theme.background, borderBottomColor: theme.border }]}>
    {searchOpen ? <View style={[styles.search, { backgroundColor: theme.surface }]}>
      <MagnifyingGlassIcon size={18} color={theme.secondary} />
      <TextInput ref={input} value={searchText} onChangeText={onSearchChange} onSubmitEditing={onSearchSubmit}
        placeholder={t('online.search')} placeholderTextColor={theme.muted} style={[styles.input, { color: theme.label }]}
        accessibilityLabel={t('online.search')} returnKeyType="search" autoCapitalize="none" autoCorrect={false} />
      {searchText.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel={t('mobile.clearSearch')} hitSlop={10}
        onPress={() => { onSearchChange(''); input.current?.focus(); }}>
        <XIcon size={16} color={theme.secondary} />
      </Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} hitSlop={10} onPress={onSearchClose}>
        <Text style={{ color: theme.accent }}>{t('common.close')}</Text>
      </Pressable>
    </View> : <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
        accessibilityRole="tablist" style={styles.sources} contentContainerStyle={styles.sourceRow}>
        {providers.map((provider) => {
          const selected = provider.id === selectedId;
          return <Pressable key={provider.id} accessibilityRole="tab" accessibilityState={{ selected }}
            accessibilityLabel={provider.name} onPress={() => onSelect(provider)} hitSlop={4}
            style={({ pressed }) => [styles.source, {
              backgroundColor: selected ? theme.selection : theme.surface,
              borderColor: selected ? theme.accent : theme.border,
              opacity: pressed ? 0.7 : 1,
            }]}>
            <OnlineSourceIcon provider={provider} theme={theme} size={20} />
            <Text numberOfLines={1} style={[styles.sourceLabel, { color: selected ? theme.accent : theme.label }]}>{provider.name}</Text>
          </Pressable>;
        })}
      </ScrollView>
      <IconButton theme={theme} label={t('online.search')} systemImage="magnifyingglass" onPress={onSearchOpen}>
        <MagnifyingGlassIcon size={20} color={theme.label} />
      </IconButton>
      <IconButton theme={theme} label={t('online.browser.downloads')} systemImage="arrow.down.circle" onPress={onDownloads}>
        <DownloadSimpleIcon size={20} color={theme.label} />
      </IconButton>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  header: { minHeight: 52, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth },
  sources: { flex: 1 },
  sourceRow: { alignItems: 'center', gap: 6, paddingRight: 4 },
  source: { height: 34, maxWidth: 156, paddingHorizontal: 10, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row', alignItems: 'center', gap: 6 },
  sourceLabel: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  search: { flex: 1, minHeight: 40, borderRadius: 20, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minHeight: 40, fontSize: 15, paddingVertical: 6 },
});
