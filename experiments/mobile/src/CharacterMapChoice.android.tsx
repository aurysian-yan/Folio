import { requireNativeView } from 'expo';
import { useTranslation } from 'react-i18next';
import { Keyboard, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import type { CharacterMapChoiceProps } from './CharacterMapChoice';

interface NativeChoiceProps extends ViewProps {
  sourceId: string;
  selectedId: string;
  dark: boolean;
  disabled: boolean;
  triggerIcon: string;
  triggerSurface: boolean;
  triggerTrailing: boolean;
  triggerFeedback: boolean;
  colors: Pick<CharacterMapChoiceProps['theme'], 'label' | 'secondary' | 'muted' | 'accent' | 'tab' | 'border' | 'backButtonBorder' | 'raised' | 'buttonSurface' | 'buttonSurfaceOpacity' | 'buttonPressed' | 'buttonPressedLabel'>;
  items: { id: string; label: string; icon: string }[];
  labels: { title: string; value: string; expanded: string; collapsed: string };
  onSelectionChange: (event: NativeSyntheticEvent<{ id: string }>) => void;
  onExpandedChange: (event: NativeSyntheticEvent<{ expanded: boolean }>) => void;
}

const ChoiceMenu = requireNativeView<NativeChoiceProps>('FolioNavigation', 'FolioPresetMenuView');

// 字款、来源和脚本复用现有玻璃菜单的材质、锚点与拖动回弹。
export function CharacterMapChoice({ label, options, value, onChange, theme, sourceId, triggerSize, triggerFeedback = true }: CharacterMapChoiceProps) {
  const { t } = useTranslation();
  const { label: textColor, secondary, muted, accent, tab, border, backButtonBorder, raised, buttonSurface, buttonSurfaceOpacity, buttonPressed, buttonPressedLabel } = theme;
  return <ChoiceMenu sourceId={sourceId} selectedId={value || 'all'} dark={theme.dark} disabled={options.length < 2}
    triggerIcon="chevron.down" triggerSurface={false} triggerTrailing={!!triggerSize} triggerFeedback={triggerFeedback}
    style={triggerSize ?? { width: 44, height: 44 }}
    colors={{ label: textColor, secondary, muted, accent, tab, border, backButtonBorder, raised, buttonSurface, buttonSurfaceOpacity, buttonPressed, buttonPressedLabel }}
    items={options.map((option) => ({ id: option.value || 'all', label: option.label, icon: '' }))}
    labels={{ title: label, value: options.find((option) => option.value === value)?.label ?? '', expanded: t('inspector.expanded'), collapsed: t('inspector.collapsed') }}
    onExpandedChange={({ nativeEvent }) => { if (nativeEvent.expanded) Keyboard.dismiss(); }}
    onSelectionChange={({ nativeEvent }) => {
      const option = options.find((item) => (item.value || 'all') === nativeEvent.id);
      if (option) onChange(option.value);
    }} />;
}
