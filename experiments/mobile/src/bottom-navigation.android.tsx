import { requireNativeView } from 'expo';
import { Dimensions, StyleSheet, useWindowDimensions, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import i18n from './i18n/instance';
import { screenMetrics } from './native';
import { navigationBottomOffset, navigationMarginReduction, navigationSideMargin } from './navigation-metrics';
import type { BottomNavigationProps, MobileTab, NavigationBackdropProps } from './bottom-navigation';

// 导航按可用宽度居中，承载层为按压形变保留溢出空间。
const containerHeight = 64;
const pressedHeight = 88;
const overflow = (pressedHeight - containerHeight) / 2;
let metricsCache: { width: number; height: number; shortestSide: number; cornerRadius: number } | null = null;
const items = [
  { id: 'local', label: i18n.t('navigation.local'), icon: 'text-aa' },
  { id: 'search', label: i18n.t('globalSearch.title'), icon: 'search' },
  { id: 'online', label: i18n.t('online.title'), icon: 'globe' },
  { id: 'cloud', label: i18n.t('navigation.cloud'), icon: 'cloud' },
  { id: 'settings', label: i18n.t('navigation.settings'), icon: 'gear' },
] as const;
export const navigationItems = items;

interface NativeTabsProps extends ViewProps {
  sourceId: string;
  selectedId: MobileTab;
  dark: boolean;
  accentColor: string;
  enabled: boolean;
  collapsed: boolean;
  collapsible: boolean;
  expandHint: string;
  items: typeof items;
  onSelectionChange: (event: NativeSyntheticEvent<{ id: MobileTab }>) => void;
  onExpand: () => void;
  onCollapse: () => void;
}

const BackdropSource = requireNativeView<Omit<NavigationBackdropProps, 'theme'>>('FolioNavigation', 'FolioBackdropSourceView');
const LiquidTabs = requireNativeView<NativeTabsProps>('FolioNavigation', 'FolioLiquidTabsView');

const bottomOffset = (bottomInset: number) => navigationBottomOffset(bottomInset, marginReduction());

// 窗口尺寸变化时重新读取原生指标；圆角映射到 8–32dp，短边映射到 360–600dp。
function currentScreen() {
  const window = Dimensions.get('window');
  if (metricsCache?.width !== window.width || metricsCache?.height !== window.height) {
    const value = screenMetrics();
    metricsCache = {
      width: window.width,
      height: window.height,
      shortestSide: value.shortestSide > 0 ? value.shortestSide : Math.min(window.width, window.height),
      cornerRadius: value.bottomCornerRadius > 0 ? value.bottomCornerRadius : value.topCornerRadius,
    };
  }
  return metricsCache;
}

function marginReduction() {
  const screen = currentScreen();
  return navigationMarginReduction(screen.shortestSide, screen.cornerRadius);
}

// 左右外边距沿用 8% 比例，再应用同一缩减量，保持导航与屏幕圆角协调。
const sideMargin = (availableWidth: number) => navigationSideMargin(availableWidth, marginReduction());

export function navigationContentInset(bottomInset: number) {
  return bottomOffset(bottomInset) + containerHeight + overflow;
}

// 浮层控制条停在展开导航表面的顶边上方。
export function navigationBarTopInset(bottomInset: number) {
  return bottomOffset(bottomInset) + containerHeight;
}

export function navigationCompactBarFrame(bottomInset: number, availableWidth: number) {
  return { bottom: bottomOffset(bottomInset) + 8, sideInset: sideMargin(availableWidth) + 56 };
}

// 采样包含页面底色，避免透明模糊与下方清晰正文叠加。
export function NavigationBackdrop({ theme, style, ...props }: NavigationBackdropProps) {
  return <BackdropSource {...props} collapsable={false} style={[style, { backgroundColor: theme.background }]} />;
}

export function BottomNavigation({ hidden = false, collapsed = false, collapsible = false, sourceId, selectedId, dark, theme, bottomInset, leftInset, rightInset, onSelectionChange, onExpand, onCollapse }: BottomNavigationProps) {
  const { width } = useWindowDimensions();
  const availableWidth = Math.max(0, width - leftInset - rightInset);
  const margin = sideMargin(availableWidth);
  // 键盘避让保持宿主挂载，避免改变原生搜索框的窗口关系。
  return <LiquidTabs pointerEvents={hidden ? 'none' : 'auto'} accessibilityElementsHidden={hidden}
    importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'} sourceId={sourceId} selectedId={selectedId} dark={dark} accentColor={theme.accent} items={items}
    enabled={!hidden} collapsed={collapsed} collapsible={collapsible} expandHint={i18n.t('navigation.expandBar')}
    style={[styles.tabs, {
      opacity: hidden ? 0 : 1,
      width: availableWidth - margin * 2,
      left: leftInset + margin,
      bottom: bottomOffset(bottomInset) - overflow,
    }]}
    onExpand={() => onExpand?.()}
    onCollapse={() => onCollapse?.()}
    onSelectionChange={({ nativeEvent }) => {
      if (items.some(({ id }) => id === nativeEvent.id)) onSelectionChange(nativeEvent.id);
    }} />;
}

const styles = StyleSheet.create({ tabs: { position: 'absolute', height: pressedHeight } });
