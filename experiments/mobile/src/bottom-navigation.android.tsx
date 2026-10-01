import { requireNativeView } from 'expo';
import { StyleSheet, useWindowDimensions, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import i18n from './i18n/instance';
import type { BottomNavigationProps, MobileTab, NavigationBackdropProps } from './bottom-navigation';

// 导航按可用宽度居中，承载层为按压形变保留溢出空间。
const containerHeight = 60;
const pressedHeight = 78;
const overflow = (pressedHeight - containerHeight) / 2;
const items = [
  { id: 'local', label: i18n.t('navigation.local'), icon: 'text-aa' },
  { id: 'search', label: i18n.t('common.search'), icon: 'search' },
  { id: 'cloud', label: i18n.t('navigation.cloud'), icon: 'cloud' },
  { id: 'settings', label: i18n.t('navigation.settings'), icon: 'gear' },
] as const;
export const navigationItems = items;

interface NativeTabsProps extends ViewProps {
  sourceId: string;
  selectedId: MobileTab;
  dark: boolean;
  accentColor: string;
  items: typeof items;
  onSelectionChange: (event: NativeSyntheticEvent<{ id: MobileTab }>) => void;
}

const BackdropSource = requireNativeView<NavigationBackdropProps>('FolioNavigation', 'FolioBackdropSourceView');
const LiquidTabs = requireNativeView<NativeTabsProps>('FolioNavigation', 'FolioLiquidTabsView');

const bottomOffset = (bottomInset: number) => Math.max(32, bottomInset + 16);

export function navigationContentInset(bottomInset: number) {
  return bottomOffset(bottomInset) + containerHeight + overflow;
}

export function NavigationBackdrop(props: NavigationBackdropProps) {
  return <BackdropSource {...props} collapsable={false} />;
}

export function BottomNavigation({ sourceId, selectedId, dark, theme, bottomInset, leftInset, rightInset, onSelectionChange }: BottomNavigationProps) {
  const { width } = useWindowDimensions();
  const availableWidth = Math.max(0, width - leftInset - rightInset);
  const sideMargin = Math.max(0, availableWidth * 0.08 - 4);
  return <LiquidTabs sourceId={sourceId} selectedId={selectedId} dark={dark} accentColor={theme.accent} items={items}
    style={[styles.tabs, {
      width: availableWidth - sideMargin * 2,
      left: leftInset + sideMargin,
      bottom: bottomOffset(bottomInset) - overflow,
    }]}
    onSelectionChange={({ nativeEvent }) => {
      if (items.some(({ id }) => id === nativeEvent.id)) onSelectionChange(nativeEvent.id);
    }} />;
}

const styles = StyleSheet.create({ tabs: { position: 'absolute', height: pressedHeight } });
