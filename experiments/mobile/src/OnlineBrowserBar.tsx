import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Animated, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaretLeftIcon, CaretRightIcon, CheckIcon, XIcon } from './icons';
import { browserPageTitle, type BrowserState, type OnlineProvider } from './online';
import { OnlineSourceIcon } from './OnlineSourceIcon';
import { PanelBackdrop } from './PanelBackdrop';
import { navigationCompactBarFrame } from './bottom-navigation';
import type { Theme } from './ui';

// 地址栏与页面标题合并为迷你播放器式浮动条；点击后才进入编辑模式。
export function OnlineBrowserBar({ theme, provider, browser, address, bottom, sourceId, compact = false, onAddressChange, onNavigate, onBack, onForward, onClose }: {
  theme: Theme;
  provider: OnlineProvider | null;
  browser: BrowserState;
  address: string;
  bottom: number;
  sourceId: string;
  compact?: boolean;
  onAddressChange: (value: string) => void;
  onNavigate: () => void;
  onBack: () => void;
  onForward: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [progress] = useState(() => new Animated.Value(compact ? 1 : 0));
  const { width, height } = useWindowDimensions();
  const inset = useSafeAreaInsets();
  const frame = navigationCompactBarFrame(inset.bottom, width - inset.left - inset.right);
  const expandedSide = Platform.OS === 'android' ? Math.max(0, frame.sideInset - 56) : 12;
  const input = useRef<TextInput>(null);
  const lastUrl = useRef(browser.url);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReduceMotion(value); });
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const show = Keyboard.addListener('keyboardDidShow', (event) => setKeyboardTop(event.endCoordinates.screenY));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(null));
    return () => { mounted = false; motion.remove(); show.remove(); hide.remove(); };
  }, []);
  useEffect(() => {
    if (reduceMotion) { progress.setValue(compact ? 1 : 0); return; }
    const animation = Animated.spring(progress, { toValue: compact ? 1 : 0, stiffness: 200, damping: 28.3, mass: 1, useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [compact, progress, reduceMotion]);

  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);
  // 來源切换或站内跳转后退出地址编辑，回到标题展示。
  useEffect(() => {
    if (browser.url !== lastUrl.current) {
      lastUrl.current = browser.url;
      setEditing(false);
    }
  }, [browser.url]);
  function submit() {
    if (!address.trim()) return;
    Keyboard.dismiss();
    setEditing(false);
    onNavigate();
  }
  function cancel() {
    Keyboard.dismiss();
    setEditing(false);
  }
  function close() {
    Keyboard.dismiss();
    setEditing(false);
    onClose();
  }
  const url = (browser.url || address).replace(/^https:\/\//, '');
  const title = browserPageTitle(browser.title, provider, browser.url || address) || provider?.name || t('online.title');
  const glass = Platform.OS === 'android';

  return <Animated.View style={[styles.wrap, editing ? {
    bottom: keyboardTop === null ? bottom : Math.max(8, height - keyboardTop + 8), left: expandedSide + inset.left, right: expandedSide + inset.right,
  } : {
    bottom: progress.interpolate({ inputRange: [0, 1], outputRange: [bottom, frame.bottom], extrapolate: 'clamp' }),
    left: Animated.add(inset.left, progress.interpolate({ inputRange: [0, 1], outputRange: [expandedSide, frame.sideInset], extrapolate: 'clamp' })),
    right: Animated.add(inset.right, progress.interpolate({ inputRange: [0, 1], outputRange: [expandedSide, frame.sideInset], extrapolate: 'clamp' })),
    height: compact ? 48 : 56,
  }]}>
    {glass && <PanelBackdrop navigationGlass sourceId={sourceId} theme={theme} style={StyleSheet.absoluteFill} />}
    <View style={[styles.bar, editing ? styles.editing : [styles.display, { height: compact ? 48 : 56 }], !glass && {
      backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow, borderWidth: StyleSheet.hairlineWidth,
    }]}>
      {editing ? <>
        <View style={styles.inputRow}>
          <TextInput ref={input} value={address} onChangeText={onAddressChange} selectTextOnFocus
            autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="go" onSubmitEditing={submit}
            accessibilityLabel={t('online.browser.address')} placeholder={t('online.browser.address')}
            placeholderTextColor={theme.muted} selectionColor={theme.selection} style={[styles.input, { color: theme.label, backgroundColor: theme.raised }]} />
          <SmallButton theme={theme} label={t('common.cancel')} onPress={cancel}><XIcon size={17} color={theme.label} /></SmallButton>
          <SmallButton theme={theme} label={t('online.browser.go')} primary onPress={submit}><CheckIcon size={17} color={theme.onAccent} /></SmallButton>
        </View>
        <View style={styles.actionRow}>
          <SmallButton theme={theme} label={t('common.back')} disabled={!browser.canGoBack} onPress={onBack}>
            <CaretLeftIcon size={17} color={theme.label} />
          </SmallButton>
          <SmallButton theme={theme} label={t('online.browser.forward')} disabled={!browser.canGoForward} onPress={onForward}>
            <CaretRightIcon size={17} color={theme.label} />
          </SmallButton>
          <SmallButton theme={theme} label={t('online.browser.closePage')} onPress={close}>
            <XIcon size={17} color={theme.danger} />
          </SmallButton>
        </View>
      </> : <Pressable accessibilityRole="button" accessibilityLabel={`${t('online.browser.editAddress')}，${title}`}
        onPress={() => { if (browser.url) onAddressChange(browser.url); setEditing(true); }}
        style={({ pressed }) => [styles.summary, { opacity: pressed ? 0.7 : 1 }]}>
        <View style={styles.titleRow}>
          <OnlineSourceIcon provider={provider} theme={theme} size={20} />
          <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.title, { color: theme.label }]}>{title}</Text>
        </View>
        {!compact && <Text numberOfLines={1} style={[styles.url, { color: theme.secondary }]}>{url || t('online.browser.address')}</Text>}
      </Pressable>}
    </View>
  </Animated.View>;
}

function SmallButton({ theme, label, onPress, disabled, primary, children }: {
  theme: Theme; label: string; onPress: () => void; disabled?: boolean; primary?: boolean; children: ReactNode;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
    disabled={disabled} hitSlop={6} onPress={onPress}
    style={({ pressed }) => [styles.smallButton, {
      backgroundColor: primary ? theme.accent : theme.raised,
      opacity: disabled ? 0.35 : pressed ? 0.65 : 1,
    }]}>
    {children}
  </Pressable>;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute' },
  bar: { borderRadius: 28, paddingHorizontal: 12 },
  display: { width: '100%' },
  editing: { paddingVertical: 8, gap: 6, borderRadius: 22 },
  summary: { position: 'absolute', left: 12, right: 12, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', gap: 2 },
  titleRow: { height: 20, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, maxWidth: '100%' },
  title: { flexShrink: 1, fontSize: 15, lineHeight: 19, fontWeight: '600', textAlign: 'center' },
  url: { fontSize: 11, lineHeight: 15, textAlign: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: { flex: 1, minHeight: 38, fontSize: 14, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 2 },
  smallButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
