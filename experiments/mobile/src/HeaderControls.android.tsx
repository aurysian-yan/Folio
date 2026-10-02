import { requireNativeView } from 'expo';
import { useTranslation } from 'react-i18next';
import { Keyboard, StyleSheet, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import type { AndroidHeaderBackdropProps, AndroidHeaderProps } from './HeaderControls';

interface NativeAndroidHeaderProps extends ViewProps {
  sourceId: string;
  mode: 'grid' | 'list';
  active: boolean;
  dark: boolean;
  ready: boolean;
  importing: boolean;
  importBlocked: boolean;
  searchOpen: boolean;
  searchText: string;
  filterCount: number;
  labels: { search: string; searchPlaceholder: string; clearSearch: string; filter: string; importFonts: string; loadingImport: string; viewOptions: string; viewMode: string; gridView: string; listView: string; expanded: string; collapsed: string };
  colors: Pick<AndroidHeaderProps['theme'], 'label' | 'secondary' | 'muted' | 'accent' | 'tab' | 'border' | 'raised'>;
  onModeChange: (event: NativeSyntheticEvent<{ mode: 'grid' | 'list' }>) => void;
  onExpandedChange: (event: NativeSyntheticEvent<{ expanded: boolean }>) => void;
  onImport: () => void;
  onFilter: () => void;
  onSearchTextChange: (event: NativeSyntheticEvent<{ text: string }>) => void;
}

const NativeAndroidHeader = requireNativeView<NativeAndroidHeaderProps>('FolioNavigation', 'FolioHeaderControlsView');

interface NativeHeaderBackdropProps extends ViewProps {
  sourceId: string;
  active: boolean;
  tintColor: string;
}

const NativeHeaderBackdrop = requireNativeView<NativeHeaderBackdropProps>('FolioNavigation', 'FolioHeaderBackdropView');

// 标题栏材质仅采样字体内容，前景控件保持清晰。
export function AndroidHeaderBackdrop({ theme, ...props }: AndroidHeaderBackdropProps) {
  return <NativeHeaderBackdrop {...props} tintColor={String(theme.background)} />;
}

// 安卓操作区使用原生控件与共享语言目录。
export function AndroidHeaderControls({ sourceId, theme, mode, active, width, ready, importing, importBlocked = false,
  searchOpen, searchText, filterCount, onFilter, onModeChange, onImport, onSearchTextChange }: AndroidHeaderProps) {
  const { t } = useTranslation();
  const { label, secondary, muted, accent, tab, border, raised } = theme;
  return <NativeAndroidHeader sourceId={sourceId} mode={mode} active={active} dark={theme.dark}
    ready={ready} importing={importing} importBlocked={importBlocked} searchOpen={searchOpen} searchText={searchText}
    labels={{ search: t('mobile.searchFonts'), searchPlaceholder: t('mobile.searchPlaceholder'), clearSearch: t('mobile.clearSearch'),
      filter: filterCount ? t('mobile.filtersSelected', { count: filterCount }) : t('library.filterFonts'),
      importFonts: t('import.importFonts'), loadingImport: t('mobile.loadingImport'), viewOptions: t('libraryView.viewOptions'), viewMode: t('mobile.viewMode'),
      gridView: t('mobile.gridView'), listView: t('mobile.listView'), expanded: t('inspector.expanded'), collapsed: t('inspector.collapsed') }}
    colors={{ label, secondary, muted, accent, tab, border, raised }} style={[styles.header, { width }]}
    onImport={onImport} onFilter={onFilter} filterCount={filterCount}
    onSearchTextChange={({ nativeEvent }) => onSearchTextChange(nativeEvent.text)}
    onExpandedChange={({ nativeEvent }) => { if (nativeEvent.expanded) Keyboard.dismiss(); }}
    onModeChange={({ nativeEvent }) => {
      if (nativeEvent.mode === 'grid' || nativeEvent.mode === 'list') onModeChange(nativeEvent.mode);
    }} />;
}

const styles = StyleSheet.create({ header: { height: 44 } });
