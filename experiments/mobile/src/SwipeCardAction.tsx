import { Pressable, StyleSheet, Text } from 'react-native';
import type { TrashIcon } from './icons';
import { settingsLayout } from './settings-ui';
import type { Theme } from './ui';

// 短距离侧滑即可展开，临界阻尼让松手后的吸附快速稳定。
export const swipeCardGesture = {
  enableTrackpadTwoFingerGesture: true,
  overshootLeft: false,
  overshootRight: false,
  rightThreshold: 40,
  animationOptions: { mass: 1, damping: 40, stiffness: 400, overshootClamping: true },
};

// 两端侧滑操作统一为等高卡片，操作区透出页面底色。
export function SwipeCardAction({ label, Icon, theme, destructive = false, disabled = false, cornerRadius = settingsLayout.card.borderRadius, onPress }: {
  label: string; Icon: typeof TrashIcon; theme: Theme; destructive?: boolean; disabled?: boolean; cornerRadius?: number; onPress: () => void;
}) {
  const color = destructive ? theme.onAccent : theme.accent;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, {
      borderRadius: cornerRadius,
      backgroundColor: destructive ? theme.danger : theme.selection,
      opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
    }]}>
    <Icon size={22} color={color} />
    <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.85}
      style={[styles.label, { color }]}>{label}</Text>
  </Pressable>;
}

export const swipeCardStyles = StyleSheet.create({
  container: { ...settingsLayout.card, backgroundColor: 'transparent' },
  actions: { flexDirection: 'row', alignItems: 'stretch', paddingLeft: 8, gap: 8 },
});

const styles = StyleSheet.create({
  action: { width: 88, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 8 },
  label: { fontSize: 12, lineHeight: 16, textAlign: 'center' },
});
