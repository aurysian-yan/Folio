import { Host, HStack, Image, Text, ZStack } from '@expo/ui/swift-ui';
import { accessibilityHidden, animation, Animation, blur, environment, font, foregroundStyle, frame, opacity } from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import type { CopyFeedbackProps } from './CopyFeedback';

// iOS 用系统模糊与原生动画同步交接整组文字和图标。
export function CopyFeedback({ copied, label, theme }: CopyFeedbackProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const color = label ? theme.label : theme.secondary;
  const size = (label ? 16 : 13) * fontScale;
  const symbol = (name: 'doc.on.doc' | 'checkmark') => <Image systemName={name} color={color}
    modifiers={[font({ size: 20, weight: 'regular' }), frame({ width: 20, height: 20 }), environment('locale', 'en')]} />;
  const text = (value: string) => <Text modifiers={[font({ size, weight: 'regular' }), foregroundStyle(color)]}>{value}</Text>;
  const transition = (visible: boolean) => [opacity(visible ? 1 : 0), blur(visible || reduceMotion ? 0 : 8),
    animation(Animation.easeInOut({ duration: reduceMotion ? 0 : 0.22 }), copied)];
  return <Host pointerEvents="none" ignoreSafeArea="all" matchContents={label ? { vertical: true } : true}
    colorScheme={theme.dark ? 'dark' : 'light'} style={label ? { width: '100%' } : undefined}
    modifiers={[accessibilityHidden()]}>
    <ZStack alignment={label ? 'center' : 'trailing'} modifiers={[frame({ minHeight: 22 * fontScale })]}>
      <HStack spacing={8} modifiers={transition(!copied)}>{symbol('doc.on.doc')}{label && text(label)}</HStack>
      <HStack spacing={8} modifiers={transition(copied)}>
        {label ? <>{symbol('checkmark')}{text(t('common.copied'))}</> : <>{text(t('common.copied'))}{symbol('checkmark')}</>}
      </HStack>
    </ZStack>
  </Host>;
}
