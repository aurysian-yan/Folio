import { requireNativeView } from 'expo';
import { useTranslation } from 'react-i18next';
import { Keyboard, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { matchingWebdavPreset, webdavPresets } from './sync';
import type { WebDAVPresetMenuProps } from './WebDAVPresetMenu';

interface NativePresetMenuProps extends ViewProps {
  sourceId: string;
  selectedId: string;
  disabled: boolean;
  dark: boolean;
  colors: Pick<WebDAVPresetMenuProps['theme'], 'label' | 'secondary' | 'muted' | 'accent' | 'tab' | 'border' | 'backButtonBorder' | 'raised' | 'buttonSurface' | 'buttonSurfaceOpacity' | 'buttonPressed' | 'buttonPressedLabel'>;
  items: { id: string; label: string; icon: string }[];
  labels: { title: string; expanded: string; collapsed: string };
  onSelectionChange: (event: NativeSyntheticEvent<{ id: string }>) => void;
  onExpandedChange: (event: NativeSyntheticEvent<{ expanded: boolean }>) => void;
}

const PresetMenu = requireNativeView<NativePresetMenuProps>('FolioNavigation', 'FolioPresetMenuView');

// 安卓地址菜单复用主页视图菜单的原生玻璃弹层。
export function WebDAVPresetMenu({ theme, serverUrl, disabled, sourceId = '', onChange }: WebDAVPresetMenuProps) {
  const { t } = useTranslation();
  const { label, secondary, muted, accent, tab, border, backButtonBorder, surface: raised, buttonSurface, buttonSurfaceOpacity, buttonPressed, buttonPressedLabel } = theme;
  return <PresetMenu sourceId={sourceId} selectedId={matchingWebdavPreset(serverUrl)} disabled={disabled} dark={theme.dark}
    colors={{ label, secondary, muted, accent, tab, border, backButtonBorder, raised, buttonSurface, buttonSurfaceOpacity, buttonPressed, buttonPressedLabel }}
    items={webdavPresets.map((preset) => ({ id: preset.id, label: t(preset.label), icon: '' }))}
    labels={{ title: t('cloud.provider'), expanded: t('inspector.expanded'), collapsed: t('inspector.collapsed') }}
    style={{ width: 44, height: 44 }}
    onExpandedChange={({ nativeEvent }) => { if (nativeEvent.expanded) Keyboard.dismiss(); }}
    onSelectionChange={({ nativeEvent }) => {
      const preset = webdavPresets.find((item) => item.id === nativeEvent.id);
      if (preset && !disabled) onChange(preset.url);
    }} />;
}
