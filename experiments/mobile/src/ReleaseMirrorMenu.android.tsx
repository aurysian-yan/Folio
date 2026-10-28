import { androidPageBackdropProps } from './android-glass';
import { requireNativeView } from 'expo';
import { useTranslation } from 'react-i18next';
import { processColor, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import type { ReleaseMirrorMenuProps } from './ReleaseMirrorMenu';
import type { ReleaseMirrorId } from './update';

const NativeMenu = requireNativeView<ViewProps & {
  sourceId: string; selectedId: string; disabled: boolean; dark: boolean; colors: object; labels: object;
  items: { id: string; label: string; icon: string }[];
  onSelectionChange: (event: NativeSyntheticEvent<{ id: ReleaseMirrorId }>) => void;
  onExpandedChange: (event: NativeSyntheticEvent<{ expanded: boolean }>) => void;
}>('FolioNavigation', 'FolioPresetMenuView');

// 安卓沿用主页的玻璃菜单与拖动反馈。
export function ReleaseMirrorMenu({ theme, sourceId, selectedId, disabled, title, items, onSelect, onExpandedChange }: ReleaseMirrorMenuProps) {
  const { t } = useTranslation();
  const { label, secondary, muted, accent, tab, border, backButtonBorder, surface: raised, buttonSurface, buttonSurfaceOpacity, buttonPressed, buttonPressedLabel } = theme;
  return <NativeMenu {...androidPageBackdropProps(theme)} style={{ width: 44, height: 44 }} sourceId={sourceId} selectedId={selectedId} disabled={disabled} dark={theme.dark}
    colors={{ scrim: processColor(theme.scrim) as number, label, secondary, muted, accent, tab, border, backButtonBorder, raised, buttonSurface, buttonSurfaceOpacity, buttonPressed, buttonPressedLabel }}
    labels={{ title, expanded: t('inspector.expanded'), collapsed: t('inspector.collapsed') }}
    items={items.map((item) => ({ ...item, icon: '' }))}
    onSelectionChange={({ nativeEvent }) => onSelect(nativeEvent.id)}
    onExpandedChange={({ nativeEvent }) => onExpandedChange(nativeEvent.expanded)} />;
}
