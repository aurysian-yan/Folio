import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { NativeActionButton, usesNativeControls } from './native-controls';
import type { Theme } from './ui';

export interface LibraryPanelProps {
  visible: boolean;
  title: string;
  theme: Theme;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
  closeLabel?: string;
}

// 面板沿用现有导入明细的间距与语义主题。
export function PanelAction({ label, theme, onPress, disabled, destructive = false }: {
  label: string; theme: Theme; onPress: () => void; disabled?: boolean; destructive?: boolean;
}) {
  const color = destructive ? theme.danger : theme.accent;
  return usesNativeControls ? <NativeActionButton label={label} color={color} onPress={onPress} disabled={disabled} plain />
    : <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled}
      onPress={onPress} style={[panelStyles.action, disabled && { opacity: 0.4 }]}>
      <Text style={{ color }}>{label}</Text>
    </Pressable>;
}

export function PanelBody(props: LibraryPanelProps) {
  return <SafeAreaProvider>
    <SafeAreaView edges={['top', 'bottom', 'left', 'right']}
      style={[panelStyles.screen, { backgroundColor: props.theme.background }]}>
      <PanelContent {...props} />
    </SafeAreaView>
  </SafeAreaProvider>;
}

export function PanelContent({ title, theme, onClose, children, busy, closeLabel }: LibraryPanelProps) {
  const { t } = useTranslation();
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    accessibilityViewIsModal style={panelStyles.screen}>
    <View style={panelStyles.header}>
      <Text accessibilityRole="header" style={[panelStyles.title, { color: theme.label }]}>{title}</Text>
      <PanelAction label={closeLabel ?? t('common.done')} theme={theme} onPress={onClose} disabled={busy} />
    </View>
    {children}
  </KeyboardAvoidingView>;
}

export const panelStyles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 18, fontWeight: '600', flex: 1 },
  action: { minHeight: 44, justifyContent: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: 16 },
  row: { paddingVertical: 12, minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { flex: 1, fontSize: 16, lineHeight: 22 },
  detail: { fontSize: 14, lineHeight: 20 },
  section: { paddingVertical: 12, fontSize: 14, fontWeight: '600' },
  input: { minHeight: 44, paddingHorizontal: 12, fontSize: 16, borderWidth: StyleSheet.hairlineWidth },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 12 },
  choice: { paddingHorizontal: 12, minHeight: 44, justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
});
