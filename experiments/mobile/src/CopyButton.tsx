import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { CopyFeedback } from './CopyFeedback';
import { copyText } from './native';
import { settingsLayout, settingsTypography } from './settings-ui';
import type { Theme } from './ui';

// 每个复制入口独立计时，卸载后清理反馈与异步回传。
export function CopyButton({ label, value, detail, theme, variant = 'panel', disabled = false, onSuccess, onError }: {
  label: string; value: string; detail?: string; theme: Theme; variant?: 'panel' | 'row';
  disabled?: boolean; onSuccess: () => void; onError: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  const pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); };
  }, []);
  async function copy() {
    if (disabled || pending.current) return;
    pending.current = true;
    try {
      await copyText(value);
      if (!mounted.current) return;
      if (timer.current) clearTimeout(timer.current);
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 2000);
      onSuccess();
      AccessibilityInfo.announceForAccessibility(t('common.copied'));
    } catch { if (mounted.current) onError(); }
    finally { pending.current = false; }
  }
  const row = variant === 'row';
  return <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled }} accessibilityLabel={row
    ? `${t(copied ? 'common.copied' : 'inspector.copyAs')} ${label}` : copied ? t('common.copied') : label}
    onPress={() => { void copy(); }} style={({ pressed }) => row
      ? [styles.row, { backgroundColor: pressed ? theme.raised : undefined, opacity: disabled ? 0.4 : 1 }]
      : [styles.panel, { backgroundColor: theme.raised, borderColor: theme.border, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
    {row && <View style={styles.body}>
      <Text style={[settingsTypography.body, { color: theme.label }]}>{label}</Text>
      {!!detail && <Text style={[settingsTypography.detail, { color: theme.secondary }]}>{detail}</Text>}
    </View>}
    <CopyFeedback copied={copied} label={row ? undefined : label} theme={theme} />
  </Pressable>;
}

const styles = StyleSheet.create({
  row: { minHeight: 64, ...settingsLayout.row, flexDirection: 'row', alignItems: 'center', gap: 12 },
  body: { flex: 1, minWidth: 0, gap: 4 },
  panel: { minHeight: 44, flexGrow: 1, width: '100%', borderRadius: settingsLayout.control.borderRadius, paddingHorizontal: 16,
    paddingVertical: 8, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
});
