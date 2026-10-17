import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Motion, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { CheckIcon, CopyIcon } from './icons';
import { settingsTypography } from './settings-ui';
import type { Theme } from './ui';

export interface CopyFeedbackProps {
  copied: boolean;
  label?: string;
  theme: Theme;
}

// 两层内容同时交接模糊与透明度，成功和复原使用同一动效。
export function CopyFeedback({ copied, label, theme }: CopyFeedbackProps) {
  const { t } = useTranslation();
  const progress = useSharedValue(copied ? 1 : 0);
  useEffect(() => {
    progress.set(withTiming(copied ? 1 : 0, { duration: 220, easing: Easing.inOut(Easing.ease), reduceMotion: ReduceMotion.System }));
  }, [copied, progress]);
  const normal = useAnimatedStyle(() => ({ opacity: 1 - progress.value, filter: [{ blur: 8 * progress.value }] }));
  const success = useAnimatedStyle(() => ({ opacity: progress.value, filter: [{ blur: 8 * (1 - progress.value) }] }));
  const color = label ? theme.label : theme.secondary;
  const textStyle = [label ? settingsTypography.body : settingsTypography.detail, styles.text, { color }];
  const row = [styles.row, !label && styles.trailing];
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={label ? styles.fullWidth : undefined}>
    <View style={[row, styles.measure]}><View style={styles.icon} /><Text style={textStyle}>{label ?? t('common.copied')}</Text></View>
    <Motion.View style={[StyleSheet.absoluteFill, row, normal]}>
      <CopyIcon size={20} color={color} />{label && <Text style={textStyle}>{label}</Text>}
    </Motion.View>
    <Motion.View style={[StyleSheet.absoluteFill, row, success]}>
      <CheckIcon size={20} color={color} /><Text style={textStyle}>{t('common.copied')}</Text>
    </Motion.View>
  </View>;
}

const styles = StyleSheet.create({
  fullWidth: { width: '100%' },
  row: { minHeight: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  trailing: { flexDirection: 'row-reverse', justifyContent: 'flex-start' },
  text: { fontWeight: '400', flexShrink: 1 },
  measure: { opacity: 0 }, icon: { width: 20, height: 20 },
});
