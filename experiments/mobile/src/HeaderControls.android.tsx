import { requireNativeView } from 'expo';
import { Keyboard, StyleSheet, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import type { AndroidHeaderBackdropProps, AndroidHeaderProps } from './HeaderControls';

interface NativeAndroidHeaderProps extends ViewProps {
  sourceId: string;
  mode: 'grid' | 'list';
  active: boolean;
  dark: boolean;
  ready: boolean;
  importing: boolean;
  searchOpen: boolean;
  searchText: string;
  filterCount: number;
  colors: Pick<AndroidHeaderProps['theme'], 'label' | 'secondary' | 'muted' | 'accent' | 'tab' | 'border' | 'raised'>;
  onModeChange: (event: NativeSyntheticEvent<{ mode: 'grid' | 'list' }>) => void;
  onExpandedChange: (event: NativeSyntheticEvent<{ expanded: boolean }>) => void;
  onSearch: () => void;
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

// 安卓操作区统一淡描边，搜索与视图动画由原生控件承载。
export function AndroidHeaderControls({ sourceId, theme, mode, active, width, ready, importing,
  searchOpen, searchText, filterCount, onFilter, onModeChange, onSearch, onImport, onSearchTextChange }: AndroidHeaderProps) {
  const { label, secondary, muted, accent, tab, border, raised } = theme;
  return <NativeAndroidHeader sourceId={sourceId} mode={mode} active={active} dark={theme.dark}
    ready={ready} importing={importing} searchOpen={searchOpen} searchText={searchText}
    colors={{ label, secondary, muted, accent, tab, border, raised }} style={[styles.header, { width }]}
    onSearch={onSearch} onImport={onImport} onFilter={onFilter} filterCount={filterCount}
    onSearchTextChange={({ nativeEvent }) => onSearchTextChange(nativeEvent.text)}
    onExpandedChange={({ nativeEvent }) => { if (nativeEvent.expanded) Keyboard.dismiss(); }}
    onModeChange={({ nativeEvent }) => {
      if (nativeEvent.mode === 'grid' || nativeEvent.mode === 'list') onModeChange(nativeEvent.mode);
    }} />;
}

const styles = StyleSheet.create({ header: { height: 44 } });
