import { useDialogs } from './Dialogs';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput } from './UiTextInput';
import { Animated, Pressable, StyleSheet, Text, View, type FlatList, type ScrollView } from 'react-native';
import { DotsThreeIcon } from './icons';
import { BrowserLibrarySection, useBrowserLibraryScroll } from './BrowserLibrarySection';
import { PanelAction } from './panel-content';
import { useBrowserData } from './BrowserDataProvider';
import { browserHost, browserId, historyDay, moveBookmark, moveBrowserItem, personalFolderId, removeFolder, saveBookmark, type Bookmark, type BookmarkDraft, type HistoryEntry } from './browser-data';
import type { Theme } from './ui';

export type { BookmarkDraft } from './browser-data';
// 收藏编辑、文件夹整理与历史记录在聚合页面内部切换。
export function BrowserLibrary({ tab, initialBookmark, theme, onOpen }: {
  tab: 'bookmarks' | 'history'; initialBookmark: BookmarkDraft | null;
  theme: Theme; onOpen: (url: string, providerId?: string | null) => void;
}) {
  const { alert } = useDialogs();
  const scroll = useBrowserLibraryScroll();
  const list = useRef<FlatList<HistoryEntry>>(null);
  const content = useRef<ScrollView>(null);
  const scrollToTop = useCallback(() => {
    list.current?.scrollToOffset({ offset: 0, animated: false });
    content.current?.scrollTo({ y: 0, animated: false });
  }, []);
  const scrollProps = { onScroll: scroll.onScroll, scrollEventThrottle: 16, contentInsetAdjustmentBehavior: 'never' as const,
    automaticallyAdjustsScrollIndicatorInsets: false, scrollIndicatorInsets: { top: scroll.top, bottom: scroll.bottom },
    contentContainerStyle: [styles.content, { paddingTop: scroll.top, paddingBottom: scroll.bottom }] };
  const { t, i18n } = useTranslation();
  const { data, ready, error, retry, change } = useBrowserData();
  const [today] = useState(() => new Date());
  const [query, setQuery] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [draft, setDraft] = useState<BookmarkDraft | null>(initialBookmark);
  const [folderDraft, setFolderDraft] = useState<{ id: string; name: string } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [menu, setMenu] = useState<{ kind: 'bookmark'; item: Bookmark } | { kind: 'folder'; item: { id: string; name: string } } | null>(null);
  function dateLabel(time: number) {
    if (historyDay(time) === historyDay(today.getTime())) return t('browser.today');
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    return historyDay(time) === historyDay(yesterday.getTime()) ? t('browser.yesterday') : new Date(time).toLocaleDateString(i18n.language);
  }
  const personal = t('browser.personal');
  const folders = [{ id: personalFolderId, name: personal }, ...data.folders];
  const label = (id: string | null) => folders.find((item) => item.id === id)?.name ?? t('browser.root');
  const inputStyle = [styles.input, { color: theme.label, backgroundColor: theme.surface }];
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (title: string, url: string) => tokens.every((token) => `${title} ${url}`.toLowerCase().includes(token));
  function bookmarkMenu(item: Bookmark) { setMenu({ kind: 'bookmark', item }); }
  function folderMenu(item: { id: string; name: string }) { setMenu({ kind: 'folder', item }); }
  function move(direction: number) {
    if (!menu) return;
    change((value) => menu.kind === 'bookmark' ? moveBookmark(value, menu.item.id, direction)
      : { ...value, folders: moveBrowserItem(value.folders, menu.item.id, direction) }); setMenu(null);
  }
  function remove() {
    if (!menu) return;
    const selection = menu;
    if (selection.kind === 'bookmark') change((value) => ({ ...value, bookmarks: value.bookmarks.filter((bookmark) => bookmark.id !== selection.item.id) }));
    else alert(t('browser.deleteFolder'), t('browser.deleteFolderHint'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => change((value) => removeFolder(value, selection.item.id)) },
    ]);
    setMenu(null);
  }
  const goBack = useCallback(() => {
    if (menu) setMenu(null); else if (draft) setDraft(null); else if (folderDraft) setFolderDraft(null); else setFolderId(null);
    setInvalid(false);
  }, [menu, draft, folderDraft]);
  const title = menu ? menu.kind === 'bookmark' ? menu.item.title : menu.item.name : draft ? t(draft.id ? 'browser.editBookmark' : 'browser.addBookmark') : folderDraft ? t('browser.folder')
    : tab === 'history' ? t('browser.history') : folderId ? label(folderId) : t('browser.bookmarks');
  const search = { value: query, onChange: setQuery, placeholder: t(tab === 'history' ? 'browser.searchHistory' : 'browser.searchBookmarks') };
  if (tab === 'history' && !menu && !draft && !folderDraft) {
    const items = data.history.filter((item) => matches(item.title, item.url));
    return <Animated.FlatList ref={list} {...scrollProps} data={items} keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled"
        initialNumToRender={12} windowSize={5} ListHeaderComponent={<View style={{ gap: 16 }}>
          <BrowserLibrarySection onSearch={scrollToTop} title={title} theme={theme} search={search} />
          {error && <><Text accessibilityRole="alert" style={{ color: theme.danger }}>{t('browser.saveError')}</Text><PanelAction theme={theme} label={t('common.retry')} onPress={retry} /></>}
        </View>}
        ListEmptyComponent={<Text style={{ color: theme.secondary }}>{t('browser.noHistory')}</Text>}
        renderItem={({ item, index }) => <View>
          {(index === 0 || historyDay(items[index - 1]!.visitedAt) !== historyDay(item.visitedAt)) && <Text accessibilityRole="header" style={[styles.heading, { color: theme.label }]}>{dateLabel(item.visitedAt)}</Text>}
          <View style={styles.row}><Pressable accessibilityRole="button" style={styles.main} onPress={() => onOpen(item.url, item.providerId)}>
            <Text numberOfLines={2} style={{ color: theme.label }}>{item.title}</Text><Text numberOfLines={1} style={{ color: theme.secondary }}>{browserHost(item.url)} · {new Date(item.visitedAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}</Text>
          </Pressable><PanelAction theme={theme} label={t('common.delete')} onPress={() => change((value) => ({ ...value, history: value.history.filter((entry) => entry.id !== item.id) }))} /></View>
        </View>}
        ListFooterComponent={<PanelAction theme={theme} destructive disabled={!data.history.length} label={t('browser.clearHistory')} onPress={() => alert(t('browser.clearHistory'), t('browser.clearHistoryHint'), [
          { text: t('common.cancel'), style: 'cancel' }, { text: t('common.delete'), style: 'destructive', onPress: () => change((value) => ({ ...value, history: [] })) },
        ])} />} />;
  }
  return <Animated.ScrollView ref={content} {...scrollProps} keyboardShouldPersistTaps="handled">
    <BrowserLibrarySection onSearch={scrollToTop} title={title} theme={theme} search={!menu && !draft && !folderDraft ? search : undefined}
    onBack={menu || draft || folderDraft || folderId ? goBack : undefined} />
      {error && <><Text accessibilityRole="alert" style={{ color: theme.danger }}>{t('browser.saveError')}</Text>
        <PanelAction theme={theme} label={t('common.retry')} onPress={retry} /></>}
      {menu ? <>
        <PanelAction theme={theme} label={t('common.edit')} onPress={() => { if (menu.kind === 'bookmark') setDraft(menu.item); else setFolderDraft(menu.item); setMenu(null); }} />
        <PanelAction theme={theme} label={t('online.browser.moveUp')} onPress={() => move(-1)} />
        <PanelAction theme={theme} label={t('online.browser.moveDown')} onPress={() => move(1)} />
        <PanelAction theme={theme} destructive label={t('common.delete')} onPress={remove} />
      </> : draft ? <>
        <Text style={{ color: theme.secondary }}>{t('common.name')}</Text>
        <TextInput accessibilityLabel={t('common.name')} style={inputStyle} value={draft.title} onChangeText={(title) => setDraft({ ...draft, title })} />
        <Text style={{ color: theme.secondary }}>{t('online.browser.address')}</Text>
        <TextInput accessibilityLabel={t('online.browser.address')} style={inputStyle} value={draft.url} keyboardType="url" autoCapitalize="none" autoCorrect={false}
          onChangeText={(url) => { setDraft({ ...draft, url }); setInvalid(false); }} />
        <Text style={{ color: theme.secondary }}>{t('browser.location')}</Text>
        <View style={styles.wrap}>{[{ id: null, name: t('browser.root') }, ...folders].map((folder) => <Pressable key={folder.id ?? 'root'}
          accessibilityRole="radio" accessibilityState={{ selected: draft.folderId === folder.id }} onPress={() => setDraft({ ...draft, folderId: folder.id })}
          style={[styles.choice, { backgroundColor: draft.folderId === folder.id ? theme.selection : theme.surface }]}>
          <Text style={{ color: draft.folderId === folder.id ? theme.accent : theme.label }}>{folder.name}</Text>
        </Pressable>)}</View>
        {invalid && <Text accessibilityRole="alert" style={{ color: theme.danger }}>{t('online.browser.invalidSource')}</Text>}
        <PanelAction theme={theme} primary disabled={!ready} label={t('common.save')} onPress={() => {
          try { change((value) => saveBookmark(value, draft)); setFolderId(draft.folderId); setDraft(null); } catch { setInvalid(true); }
        }} />
      </> : folderDraft ? <>
        <TextInput accessibilityLabel={t('browser.folderName')} style={inputStyle} value={folderDraft.name} onChangeText={(name) => setFolderDraft({ ...folderDraft, name })} />
        <PanelAction theme={theme} primary label={t('common.save')} disabled={!ready || !folderDraft.name.trim()} onPress={() => {
          change((value) => ({ ...value, folders: value.folders.some((item) => item.id === folderDraft.id)
            ? value.folders.map((item) => item.id === folderDraft.id ? { ...folderDraft, name: folderDraft.name.trim() } : item)
            : [...value.folders, { ...folderDraft, name: folderDraft.name.trim() }] })); setFolderDraft(null);
        }} />
      </> : <>
        {tab === 'bookmarks' ? <>
          {!folderId && !query.trim() && folders.map((folder) => <View key={folder.id} style={styles.row}>
            <Pressable accessibilityRole="button" style={styles.main} onLongPress={folder.id === personalFolderId ? undefined : () => folderMenu(folder)} onPress={() => setFolderId(folder.id)}>
              <Text style={{ color: theme.label }}>{folder.name}</Text>
            </Pressable>
            {folder.id !== personalFolderId && <Pressable accessibilityRole="button" accessibilityLabel={`${t('common.edit')} ${folder.name}`} onPress={() => folderMenu(folder)} style={styles.more}><DotsThreeIcon size={24} color={theme.secondary} /></Pressable>}
          </View>)}
          {data.bookmarks.filter((item) => (tokens.length || item.folderId === folderId) && matches(item.title, item.url)).map((item) => <View key={item.id} style={styles.row}>
            <Pressable accessibilityRole="button" style={styles.main} onLongPress={() => bookmarkMenu(item)} onPress={() => onOpen(item.url, item.providerId)}>
              <Text numberOfLines={2} style={{ color: theme.label }}>{item.title}</Text><Text numberOfLines={1} style={{ color: theme.secondary }}>{browserHost(item.url)}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`${t('common.edit')} ${item.title}`} onPress={() => bookmarkMenu(item)} style={styles.more}><DotsThreeIcon size={24} color={theme.secondary} /></Pressable>
          </View>)}
          {(!!folderId || !!tokens.length || !data.bookmarks.length) && !data.bookmarks.some((item) => (tokens.length || item.folderId === folderId) && matches(item.title, item.url)) && <Text style={{ color: theme.secondary }}>{t('browser.noBookmarks')}</Text>}
          {!folderId && <PanelAction theme={theme} label={t('browser.newFolder')} disabled={!ready} onPress={() => setFolderDraft({ id: browserId(), name: '' })} />}
        </> : null}
      </>}
  </Animated.ScrollView>;
}
const styles = StyleSheet.create({
  content: { padding: 16, gap: 16 }, input: { minHeight: 44, paddingHorizontal: 12, fontSize: 16, borderRadius: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 }, main: { flex: 1, minHeight: 44, justifyContent: 'center', gap: 4 },
  more: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choice: { padding: 12, borderRadius: 12, minHeight: 44 },
  heading: { fontSize: 17, fontWeight: '600', paddingVertical: 8 },
});
