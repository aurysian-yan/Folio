import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Motion, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { InfoIcon } from './icons';
import { OnlineSourceIcon } from './OnlineSourceIcon';
import { pageFailureDetailKey, type OnlineProvider } from './online';
import { PanelAction } from './panel-content';
import type { Theme } from './ui';

// 整页加载失败使用独立失败页，保留重试和来源切换，不再露出空白网页区域。
export function OnlineBrowserFailure({ theme, provider, errorKey, url, hint, preferSwitch = false, onRetry, onSwitchSource }: {
  theme: Theme;
  provider: OnlineProvider | null;
  errorKey: string | null;
  url: string;
  hint: string | null;
  preferSwitch?: boolean;
  onRetry: () => void;
  onSwitchSource: () => void;
}) {
  const { t } = useTranslation();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(withTiming(1, {
      duration: 220, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System,
    }));
  }, [progress]);
  const entering = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 6 }],
  }));
  const host = /^https:\/\/([^/?#]+)/i.exec(url.trim())?.[1]?.replace(/^www\./, '') ?? '';

  return <Motion.View style={[styles.failure, { backgroundColor: theme.background }, entering]}>
    <View style={styles.content}>
      <View style={[styles.emblem, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <OnlineSourceIcon provider={provider} theme={theme} size={40} />
      </View>
      {provider?.name ? <Text numberOfLines={1} style={[styles.provider, { color: theme.secondary }]}>{provider.name}</Text> : null}
      <Text accessibilityRole="alert" style={[styles.title, { color: theme.label }]}>{t('online.browser.failureTitle')}</Text>
      <Text style={[styles.detail, { color: theme.secondary }]}>{t(pageFailureDetailKey(errorKey))}</Text>
      {host ? <Text numberOfLines={1} style={[styles.host, { color: theme.muted }]}>{host}</Text> : null}
      {hint ? <View style={[styles.hint, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <InfoIcon size={16} color={theme.secondary} />
        <Text style={[styles.hintText, { color: theme.secondary }]}>{hint}</Text>
      </View> : null}
      <View style={styles.actions}>
        <PanelAction primary={!preferSwitch} label={t('common.retry')} theme={theme} onPress={onRetry} />
        <PanelAction primary={preferSwitch} label={t('online.browser.switchSource')} theme={theme} onPress={onSwitchSource} />
      </View>
    </View>
  </Motion.View>;
}

const styles = StyleSheet.create({
  failure: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 3, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28, paddingTop: 24 },
  content: { width: '100%', maxWidth: 380, alignItems: 'center', gap: 6 },
  emblem: { width: 64, height: 64, borderRadius: 32, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  provider: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  title: { fontSize: 18, lineHeight: 26, fontWeight: '600', textAlign: 'center' },
  detail: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 2 },
  host: { fontSize: 12, lineHeight: 16, textAlign: 'center' },
  hint: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginTop: 8 },
  hintText: { flexShrink: 1, fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 10, marginTop: 14 },
});
