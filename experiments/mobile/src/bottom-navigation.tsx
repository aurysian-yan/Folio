import type { ReactNode } from 'react';
import { MagnifyingGlassIcon, CloudIcon, GearIcon, TextAaIcon } from './icons';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle, type ViewProps } from 'react-native';
import i18n from './i18n/instance';
import type { Theme } from './ui';

export const navigationItems = [
  { id: 'local', label: i18n.t('navigation.local'), icon: 'text-aa' },
  { id: 'search', label: i18n.t('common.search'), icon: 'search' },
  { id: 'cloud', label: i18n.t('navigation.cloud'), icon: 'cloud' },
  { id: 'settings', label: i18n.t('navigation.settings'), icon: 'gear' },
] as const;

export type MobileTab = typeof navigationItems[number]['id'];

export interface NavigationBackdropProps extends ViewProps {
  children: ReactNode;
  sourceId: string;
  active: boolean;
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
  onSelectionChange: (id: MobileTab) => void;
}

export function navigationContentInset(bottomInset: number) { return bottomInset + 96; }

export function NavigationBackdrop({ children, style }: NavigationBackdropProps) {
  return <View style={style}>{children}</View>;
}

const icons = { local: TextAaIcon, search: MagnifyingGlassIcon, cloud: CloudIcon, settings: GearIcon };

export function BottomNavigation({ hidden = false, selectedId, theme, bottomInset, leftInset, rightInset, onSelectionChange }: BottomNavigationProps) {
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
  tab: { flex: 1, minHeight: 54, borderRadius: 27, justifyContent: 'center', alignItems: 'center', gap: 3, paddingVertical: 4 },
  label: { fontSize: 10, fontWeight: '600', lineHeight: 13 },
});
