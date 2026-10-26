import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CaretLeftIcon, MagnifyingGlassIcon } from './icons';
import { BrowserLibrary } from './BrowserLibrary';
import { BrowserLibraryActionsContext, BrowserLibraryScrollContext, type BrowserLibraryActions } from './BrowserLibrarySection';
import { CloudPanelTabs } from './CloudPanelTabs';
import { NavigationBackdrop } from './bottom-navigation';
import { NativeScrollContainer } from './native-controls';
import { PageHeader, usePageHeader } from './PageHeader';
import { OnlineDownloads } from './OnlineDownloads';
import type { BrowserLibraryRequest, BrowserLibraryTab } from './browser-data';
import { IconButton, type Theme } from './ui';

// 收藏、历史与下载共用二级页面及统一的玻璃工具栏。
export function BrowserLibraryPage(props: {
  request: BrowserLibraryRequest; theme: Theme; onClose: () => void; onOpenUrl: (url: string) => void;
}) {
  return <SafeAreaProvider><BrowserLibraryContent {...props} /></SafeAreaProvider>;
}
function BrowserLibraryContent({ request, theme, onClose, onOpenUrl }: Parameters<typeof BrowserLibraryPage>[0]) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<BrowserLibraryTab>(request.tab);
  const [bookmark, setBookmark] = useState(request.bookmark);
  const [actions, setActions] = useState<BrowserLibraryActions | null>(null);
  const header = usePageHeader({ bottomTabs: false, onSnap: () => {} });
  const options = [
    { value: 'bookmarks', label: t('browser.bookmarks'), systemImage: 'bookmark' },
    { value: 'history', label: t('browser.history'), systemImage: 'clock' },
    { value: 'downloads', label: t('online.browser.downloads'), systemImage: 'arrow.down.to.line' },
  ];
  return <SafeAreaView edges={['left', 'right']} style={[styles.screen, { backgroundColor: theme.background }]}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
      <NativeScrollContainer hasHeader accessibilityViewIsModal onInsetsChange={header.onInsetsChange} style={styles.screen}>
        <PageHeader {...header} theme={theme} style={styles.toolbar}>
          <IconButton theme={theme} label={t('common.back')} systemImage="chevron.left" onPress={() => { Keyboard.dismiss(); (actions?.back ?? onClose)(); }}>
            <CaretLeftIcon size={20} color={theme.label} />
          </IconButton>
          <View style={styles.tabs}><CloudPanelTabs iconOnly label={t('browser.library')} value={tab} options={options} theme={theme} disabled={false}
            onChange={(value) => {
              if (!options.some((option) => option.value === value)) return;
              Keyboard.dismiss(); setBookmark(null); header.scrollY.setValue(0); setTab(value as BrowserLibraryTab);
            }} /></View>
          <IconButton theme={theme} label={t('common.search')} systemImage="magnifyingglass" disabled={!actions?.search} selected={actions?.searchOpen} onPress={() => actions?.search?.()}>
            <MagnifyingGlassIcon size={20} color={theme.label} />
          </IconButton>
        </PageHeader>
        <NavigationBackdrop sourceId={header.sourceId} active theme={theme} style={styles.screen}>
          <BrowserLibraryActionsContext.Provider value={setActions}><BrowserLibraryScrollContext.Provider value={{ top: header.contentTop, bottom: header.contentBottom, onScroll: header.onScroll }}>
            {tab === 'downloads' ? <OnlineDownloads theme={theme} onOpenUrl={onOpenUrl} />
              : <BrowserLibrary key={tab} tab={tab} initialBookmark={tab === 'bookmarks' ? bookmark : null} theme={theme} onOpen={onOpenUrl} />}
          </BrowserLibraryScrollContext.Provider></BrowserLibraryActionsContext.Provider>
        </NavigationBackdrop>
      </NativeScrollContainer>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, toolbar: { paddingHorizontal: 16, paddingVertical: 0, minHeight: 68 }, tabs: { flex: 1, alignItems: 'center' },
});
