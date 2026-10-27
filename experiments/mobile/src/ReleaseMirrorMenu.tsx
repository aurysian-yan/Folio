import { requireNativeView } from 'expo';
import { processColor, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import type { Theme } from './ui';
import type { ReleaseMirrorId } from './update';

export interface ReleaseMirrorMenuProps {
  theme: Theme; sourceId: string; selectedId: ReleaseMirrorId; disabled: boolean; title: string;
  items: { id: ReleaseMirrorId; label: string }[];
  onSelect: (id: ReleaseMirrorId) => void; onExpandedChange: (expanded: boolean) => void;
}
const NativeMenu = requireNativeView<ViewProps & {
  selectedId: string; disabled: boolean; label: string; color: number; items: { id: string; label: string }[];
  onSelectionChange: (event: NativeSyntheticEvent<{ id: ReleaseMirrorId }>) => void;
  onExpandedChange: (event: NativeSyntheticEvent<{ expanded: boolean }>) => void;
}>('FolioNative', 'FolioReleaseMirrorMenu');

// iOS 菜单由系统承载，生命周期事件控制测速边界。
export function ReleaseMirrorMenu({ theme, selectedId, disabled, title, items, onSelect, onExpandedChange }: ReleaseMirrorMenuProps) {
  return <NativeMenu style={{ width: 44, height: 44 }} selectedId={selectedId} disabled={disabled} label={title}
    color={processColor(theme.secondary) as number} items={items}
    onSelectionChange={({ nativeEvent }) => onSelect(nativeEvent.id)}
    onExpandedChange={({ nativeEvent }) => onExpandedChange(nativeEvent.expanded)} />;
}
