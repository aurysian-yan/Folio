import { CaretDownIcon, CaretLeftIcon, CaretUpIcon, CheckIcon, PencilSimpleIcon, PlusIcon, SparkleIcon, TrashIcon, XIcon } from './icons';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import type { SharedValue } from 'react-native-reanimated';
import { NativeActionButton, usesNativeControls } from './native-controls';
import { IconButton, type Theme } from './ui';

const actionIcons: Record<string, typeof CheckIcon> = { checkmark: CheckIcon, xmark: XIcon, plus: PlusIcon,
  pencil: PencilSimpleIcon, trash: TrashIcon, sparkles: SparkleIcon };

export interface LibraryPanelProps {
  visible: boolean;
  title: string;
  theme: Theme;
  onClose: () => void;
  onBack?: () => void;
  children: ReactNode;
  busy?: boolean;
  closeLabel?: string;
  backButton?: boolean;
  nested?: boolean;
  stackIndex?: SharedValue<number>;
  headerAction?: ReactNode;
  headerAccessory?: ReactNode;
}

// 面板沿用现有导入明细的间距与语义主题。
export function PanelAction({ label, theme, onPress, disabled, destructive = false, primary = false, systemImage }: {
  label: string; theme: Theme; onPress: () => void; disabled?: boolean; destructive?: boolean; primary?: boolean; systemImage?: string;
}) {
  const color = destructive ? theme.danger : theme.accent;
  const Icon = systemImage ? actionIcons[systemImage] : undefined;
  return usesNativeControls ? <NativeActionButton label={label} systemImage={systemImage} color={color} onPress={onPress}
    disabled={disabled} prominent={primary} minimumWidth={80} />
    : <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled}
      onPress={onPress} style={({ pressed }) => [panelStyles.button, {
        backgroundColor: primary ? color : theme.raised, borderColor: primary ? color : theme.border,
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      }]}>
      {Icon && <Icon size={18} color={primary ? theme.onAccent : color} />}
      <Text style={[panelStyles.buttonLabel, { color: primary ? theme.onAccent : color }]}>{label}</Text>
    </Pressable>;
}

// 分类标题与卡片复用筛选面板的折叠行为。
export function PanelSectionHeader({ title, theme, expanded, onToggle, action }: {
  title: string; theme: Theme; expanded: boolean; onToggle: () => void; action?: ReactNode;
}) {
  const Chevron = expanded ? CaretUpIcon : CaretDownIcon;
  return <View style={panelStyles.sectionHeading}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded }}
      onPress={onToggle} style={panelStyles.sectionToggle}>
      <Text style={[panelStyles.cardTitle, { color: theme.label }]}>{title}</Text>
      <Chevron size={16} color={theme.secondary} />
    </Pressable>
    {action}
  </View>;
}

export function PanelSection({ title, theme, children, action, initiallyExpanded = true }: {
  title: string; theme: Theme; children: ReactNode; action?: ReactNode; initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  return <View style={[panelStyles.card, { backgroundColor: theme.surface }]}>
    <PanelSectionHeader title={title} theme={theme} expanded={expanded} onToggle={() => setExpanded(!expanded)} action={action} />
    {expanded && <View style={panelStyles.cardContent}>{children}</View>}
  </View>;
}

export function PanelBody(props: LibraryPanelProps) {
  return <SafeAreaProvider>
    <SafeAreaView edges={['top', 'bottom', 'left', 'right']}
      style={[panelStyles.screen, { backgroundColor: Platform.OS === 'ios' ? 'transparent' : props.theme.background }]}>
      <GestureHandlerRootView style={panelStyles.screen}><PanelContent {...props} /></GestureHandlerRootView>
    </SafeAreaView>
  </SafeAreaProvider>;
}

export function PanelHeader({ title, theme, onClose, onBack, busy, closeLabel, headerAction, backButton = false }: Omit<LibraryPanelProps, 'children' | 'visible'>) {
  const { t } = useTranslation();
  return <View style={[panelStyles.header, panelStyles.topBar]}>
    <IconButton label={closeLabel ?? t('common.close')} theme={theme} onPress={onBack ?? onClose} disabled={busy} systemImage={backButton ? 'chevron.left' : 'xmark'}>
      {backButton ? <CaretLeftIcon size={20} color={theme.secondary} /> : <XIcon size={20} color={theme.secondary} />}
    </IconButton>
    <Text accessibilityRole="header" style={[panelStyles.title, { color: theme.label }]}>{title}</Text>
    {headerAction ?? <View style={panelStyles.headerSpacer} />}
  </View>;
}

export function PanelContent({ children, hideHeader = false, ...props }: LibraryPanelProps & { hideHeader?: boolean }) {
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    accessibilityViewIsModal style={panelStyles.screen}>
    {!hideHeader && <PanelHeader {...props} />}
    {children}
  </KeyboardAvoidingView>;
}

export const panelStyles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  topBar: { paddingVertical: 12 },
  title: { fontSize: 18, fontWeight: '600', flex: 1, textAlign: 'center' },
  headerSpacer: { width: 44 },
  action: { minHeight: 44, justifyContent: 'center' },
  button: { minHeight: 44, minWidth: 80, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', gap: 8,
    alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  buttonLabel: { fontSize: 16, fontWeight: '600', lineHeight: 22 },
  card: { marginTop: 8, padding: 12, borderRadius: 24 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionToggle: { flex: 1, minHeight: 44, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: '600' },
  cardContent: { paddingTop: 8, gap: 8 },
  content: { paddingHorizontal: 16, paddingBottom: 16 },
  row: { paddingVertical: 12, minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { flex: 1, fontSize: 16, lineHeight: 22 },
  detail: { fontSize: 14, lineHeight: 20 },
  section: { paddingVertical: 12, fontSize: 14, fontWeight: '600' },
  input: { minHeight: 44, paddingHorizontal: 12, fontSize: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 12 },
  choice: { paddingHorizontal: 12, minHeight: 44, justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
});
