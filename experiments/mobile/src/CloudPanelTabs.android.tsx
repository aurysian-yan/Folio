import { requireNativeView } from 'expo';
import { type NativeSyntheticEvent, type ViewProps } from 'react-native';
import type { PanelTabsProps } from './PanelTabs';

interface NativePanelTabsProps extends ViewProps {
  selectedId: string;
  segmented: boolean;
  enabled: boolean;
  dark: boolean;
  accentColor: string;
  labelColor: string;
  surfaceColor: string;
  items: { id: string; label: string; icon: string }[];
  onSelectionChange: (event: NativeSyntheticEvent<{ id: string }>) => void;
}

const LiquidTabs = requireNativeView<NativePanelTabsProps>('FolioNavigation', 'FolioLiquidTabsView');

// 云端分段控件共用底栏玻璃、拖动吸附和平滑胶囊。
export function CloudPanelTabs({ label, value, options, theme, disabled, onChange }: PanelTabsProps) {
  return <LiquidTabs accessibilityLabel={label} selectedId={value} segmented enabled={!disabled} dark={theme.dark}
    accentColor={theme.accent} labelColor={theme.label} surfaceColor={theme.surface}
    items={options.map((option) => ({ id: option.value, label: option.label, icon: '' }))}
    style={{ height: 68, opacity: disabled ? 0.4 : 1 }}
    onSelectionChange={({ nativeEvent }) => {
      if (!disabled && options.some((option) => option.value === nativeEvent.id)) onChange(nativeEvent.id);
    }} />;
}
