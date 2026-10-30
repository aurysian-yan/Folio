import type { ReactNode } from 'react';
import { MagnifyingGlassIcon, GlobeIcon, CloudIcon, GearIcon, TextAaIcon } from './icons';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle, type ViewProps } from 'react-native';
import i18n from './i18n/instance';
import type { Theme } from './ui';

export const navigationItems = [
  { id: 'local', label: i18n.t('navigation.local'), icon: 'text-aa' },
  { id: 'search', label: i18n.t('globalSearch.title'), icon: 'search' },
  { id: 'online', label: i18n.t('online.title'), icon: 'globe' },
  { id: 'cloud', label: i18n.t('navigation.cloud'), icon: 'cloud' },
  { id: 'settings', label: i18n.t('navigation.settings'), icon: 'gear' },
] as const;

export type MobileTab = typeof navigationItems[number]['id'];

export interface NavigationBackdropProps extends ViewProps {
  children: ReactNode;
  sourceId: string;
  active: boolean;
  theme: Theme;
  /** 内容含 WebView 等一次性绘制表面时启用合成层，供多处采样复用同一帧纹理。 */
  compositingLayer?: boolean;
  style?: StyleProp<ViewStyle>;
}

export interface BottomNavigationProps {
  sourceId: string;
  hidden?: boolean;
  selectedId: MobileTab;
  dark: boolean;
  theme: Theme;
  bottomInset: number;
  leftInset: number;
  rightInset: number;
  collapsed?: boolean;
  collapsible?: boolean;
  onSelectionChange: (id: MobileTab) => void;
  onExpand?: () => void;
  onCollapse?: () => void;
}

export function navigationContentInset(bottomInset: number, _material = false) { return bottomInset + 96; }

// 按展开导航或紧凑按钮的实际顶边计算内容避让。
export function navigationBarTopInset(bottomInset: number, collapsed = false, _material = false) { return bottomInset + 8 + (collapsed ? 48 : 64); }

export function navigationCompactBarFrame(bottomInset: number, _availableWidth: number) {
  return { bottom: bottomInset + 8, sideInset: 84 };
}

export function NavigationBackdrop({ children, style }: NavigationBackdropProps) {
  return <View style={style}>{children}</View>;
}

const icons = { local: TextAaIcon, search: MagnifyingGlassIcon, online: GlobeIcon, cloud: CloudIcon, settings: GearIcon };

export function BottomNavigation({ hidden = false, collapsed = false, selectedId, theme, bottomInset, leftInset, rightInset, onSelectionChange, onExpand }: BottomNavigationProps) {
  if (collapsed) {
    const item = navigationItems.find(({ id }) => id === selectedId) ?? navigationItems[0];
    const Icon = icons[item.id];
    return <View pointerEvents={hidden ? 'none' : 'auto'} accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      style={[styles.dock, { opacity: hidden ? 0 : 1, bottom: bottomInset + 8, left: leftInset + 20 }]}>
      <Pressable accessibilityRole="tab" accessibilityLabel={`${item.label}，${i18n.t('navigation.expandBar')}`}
        accessibilityState={{ selected: true }} onPress={onExpand}
        style={({ pressed }) => [styles.compact, { backgroundColor: theme.tab, borderColor: theme.border, opacity: pressed ? 0.6 : 1 }]}>
        <Icon size={24} color={theme.accent} />
      </Pressable>
    </View>;
  }
  return <View pointerEvents={hidden ? 'none' : 'auto'} accessibilityElementsHidden={hidden}
    importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
    style={[styles.dock, { opacity: hidden ? 0 : 1, bottom: bottomInset + 8, left: leftInset + 20, right: rightInset + 20 }]}>
    <View accessibilityRole="tablist" style={[styles.bar, { backgroundColor: theme.tab, borderColor: theme.border }]}>
      {navigationItems.map(({ id, label }) => {
        const Icon = icons[id];
        const selected = id === selectedId;
        return <Pressable key={id} accessibilityRole="tab" accessibilityLabel={label}
          accessibilityState={{ selected }} onPress={() => onSelectionChange(id)}
          style={({ pressed }) => [styles.tab, {
            backgroundColor: selected ? theme.activeTab : 'transparent', opacity: pressed ? 0.6 : 1,
          }]}>
          <Icon size={27} color={selected ? theme.accent : theme.label} />
          <Text style={[styles.label, { color: selected ? theme.accent : theme.label }]}>{label}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  dock: { position: 'absolute' },
  bar: { minHeight: 64, borderRadius: 32, borderWidth: StyleSheet.hairlineWidth, padding: 4, flexDirection: 'row', alignItems: 'center' },
  compact: { width: 56, height: 56, borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  tab: { flex: 1, minHeight: 54, borderRadius: 27, justifyContent: 'center', alignItems: 'center', gap: 3, paddingVertical: 4 },
  label: { fontSize: 10, fontWeight: '600', lineHeight: 13 },
});
