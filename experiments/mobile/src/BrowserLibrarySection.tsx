import { createContext, useContext, useEffect, useState } from 'react';
import { TextInput } from './UiTextInput';
import { Keyboard, StyleSheet, Text, View, type ScrollViewProps } from 'react-native';
import { settingsTypography } from './settings-ui';
import type { Theme } from './ui';

export const BrowserLibraryScrollContext = createContext<{ top: number; bottom: number; onScroll: ScrollViewProps['onScroll'] }>({ top: 0, bottom: 0, onScroll: undefined });
export interface BrowserLibraryActions { back?: () => void; search?: () => void; searchOpen: boolean }
export const BrowserLibraryActionsContext = createContext<(actions: BrowserLibraryActions | null) => void>(() => {});
export function useBrowserLibraryScroll() { return useContext(BrowserLibraryScrollContext); }

// 分区标题与搜索随正文滚动，顶部工具栏保持独立。
export function BrowserLibrarySection({ title, theme, onBack, onSearch, search }: {
  title: string; theme: Theme; onBack?: () => void; onSearch?: () => void;
  search?: { value: string; placeholder: string; onChange: (value: string) => void };
}) {
  const setActions = useContext(BrowserLibraryActionsContext);
  const [searchOpen, setSearchOpen] = useState(false);
  const onSearchChange = search?.onChange;
  useEffect(() => {
    setActions({ back: onBack, searchOpen, search: onSearchChange ? () => {
      onSearch?.();
      if (searchOpen) { onSearchChange(''); Keyboard.dismiss(); }
      setSearchOpen(!searchOpen);
    } : undefined });
    return () => setActions(null);
  }, [onBack, onSearch, onSearchChange, searchOpen, setActions]);
  return <View>
    <View style={styles.header}>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.label }]}>{title}</Text>
    </View>
    {search && searchOpen && <TextInput autoFocus value={search.value} onChangeText={search.onChange} accessibilityLabel={search.placeholder}
      placeholder={search.placeholder} placeholderTextColor={theme.muted} autoCapitalize="none" autoCorrect={false} returnKeyType="search"
      onSubmitEditing={Keyboard.dismiss} style={[styles.search, { color: theme.label, backgroundColor: theme.surface }]} />}
  </View>;
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { ...settingsTypography.title, flex: 1 },
  search: { marginBottom: 8, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, fontSize: 16, fontWeight: '400' },
});
