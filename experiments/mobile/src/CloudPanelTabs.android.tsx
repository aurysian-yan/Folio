import { androidPageBackdropProps } from './android-glass';
import { requireNativeView } from 'expo';
import { type NativeSyntheticEvent, type ViewProps } from 'react-native';
import type { PanelTabsProps } from './PanelTabs';
import { useGlassControl } from './GlassControlScope';

interface NativePanelTabsProps extends ViewProps {
  sourceId: string;
  selectedId: string;
  segmented: boolean;
  iconOnly: boolean;
  borderColor: string;
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
export function CloudPanelTabs({ label, value, options, theme, disabled, onChange, iconOnly = false }: PanelTabsProps) {
  const control = useGlassControl();
  return <LiquidTabs {...androidPageBackdropProps(theme)} sourceId={control.sourceId} accessibilityLabel={label} selectedId={value} segmented iconOnly={iconOnly} borderColor={iconOnly ? theme.backButtonBorder : ''} enabled={!disabled && control.active} dark={theme.dark}
    accentColor={theme.accent} labelColor={theme.label} surfaceColor={theme.surface}
    items={options.map((option) => ({ id: option.value, label: option.label, icon: iconOnly ? option.systemImage === 'arrow.down.to.line' ? 'download' : option.systemImage : '' }))}
    style={{ width: iconOnly ? options.length * 44 + 8 : undefined, height: 68, opacity: disabled ? 0.4 : 1 }}
    onSelectionChange={({ nativeEvent }) => {
      if (!disabled && control.active && options.some((option) => option.value === nativeEvent.id)) onChange(nativeEvent.id);
    }} />;
}
