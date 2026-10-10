import { requireNativeView } from 'expo';
import { useTranslation } from 'react-i18next';
import { Keyboard, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { useHeaderShadowProgress } from './HeaderButtonShadow';
import type { FontActionsMenuProps } from './FontActionsMenu';

interface NativeActionsMenuProps extends ViewProps {
  sourceId: string;
  selectedId: string;
  disabled: boolean;
  dark: boolean;
  triggerIcon: string;
  triggerSurface: boolean;
  shadowProgress: number;
  colors: Pick<FontActionsMenuProps['theme'], 'label' | 'secondary' | 'muted' | 'accent' | 'tab' | 'border' | 'backButtonBorder' | 'raised' | 'shadow' | 'buttonSurface' | 'buttonSurfaceOpacity' | 'buttonPressed' | 'buttonPressedLabel'>;
  items: { id: string; label: string; icon: string; disabled?: boolean }[];
  labels: { title: string; expanded: string; collapsed: string };
  onSelectionChange: (event: NativeSyntheticEvent<{ id: string }>) => void;
  onExpandedChange: (event: NativeSyntheticEvent<{ expanded: boolean }>) => void;
}

const ActionsMenu = requireNativeView<NativeActionsMenuProps>('FolioNavigation', 'FolioPresetMenuView');

// 安卓复用主页菜单的材质、锚点与拖动回弹。
export function FontActionsMenu({ theme, sourceId, favorite, favoritePending, onFavorite, onAddToCollection }: FontActionsMenuProps) {
  const { t } = useTranslation();
  const shadowProgress = useHeaderShadowProgress();
  const { label, secondary, muted, accent, tab, border, backButtonBorder, surface: raised, shadow, buttonSurface, buttonSurfaceOpacity, buttonPressed, buttonPressedLabel } = theme;
  return <ActionsMenu sourceId={sourceId} selectedId="" disabled={false} dark={theme.dark}
    triggerIcon="more" triggerSurface shadowProgress={shadowProgress}
    colors={{ label, secondary, muted, accent, tab, border, backButtonBorder, raised, shadow, buttonSurface, buttonSurfaceOpacity, buttonPressed, buttonPressedLabel }}
    labels={{ title: t('font.operations'), expanded: t('inspector.expanded'), collapsed: t('inspector.collapsed') }}
    items={[
      { id: 'favorite', label: t(favorite ? 'collection.unfavorite' : 'collection.favorite'), icon: favorite ? 'star-fill' : 'star', disabled: favoritePending },
      { id: 'collection', label: t('collection.addTo'), icon: 'folder-plus' },
    ]} style={{ width: 64, height: 44 }}
    onExpandedChange={({ nativeEvent }) => { if (nativeEvent.expanded) Keyboard.dismiss(); }}
    onSelectionChange={({ nativeEvent }) => {
      if (nativeEvent.id === 'favorite' && !favoritePending) onFavorite();
      else if (nativeEvent.id === 'collection') onAddToCollection();
    }} />;
}
