import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { ScreenStack, ScreenStackItem } from 'react-native-screens';
import type { FontNavigationProps } from './FontNavigation';

// UIKit 导航栈提供系统侧滑、取消手势与页面转场。
export function FontNavigation({ children, detail, visible, theme, onDismissed }: FontNavigationProps) {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReduceMotion(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);

  return <ScreenStack style={styles.stack} onFinishTransitioning={() => {
    if (!visible && detail) onDismissed();
  }}>
    <ScreenStackItem screenId="library" activityState={2} headerConfig={{ hidden: true }} style={StyleSheet.absoluteFill}
      contentStyle={{ backgroundColor: theme.background }}>
      {children}
    </ScreenStackItem>
    {visible && detail && <ScreenStackItem screenId="font-details" activityState={2} style={StyleSheet.absoluteFill}
      headerConfig={{ hidden: true }} stackPresentation="push" gestureEnabled
      stackAnimation={reduceMotion ? 'none' : 'default'} onDismissed={onDismissed}
      contentStyle={{ backgroundColor: theme.background }}>
      {detail}
    </ScreenStackItem>}
  </ScreenStack>;
}

const styles = StyleSheet.create({ stack: { flex: 1 } });
