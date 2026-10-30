import { useUiEventGuard } from './UiTheme';
import { requireNativeView } from 'expo';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { androidPageBackdropProps, usesGlasmioControls } from './android-glass';
import { AppearanceChoiceRow as FallbackChoiceRow, type AppearanceChoiceRowProps } from './AppearanceChoiceRowFallback';
import { useGlassControl } from './GlassControlScope';
import { SettingsControlFocus, settingsLayout, settingsTypography } from './settings-ui';

interface NativeAppearanceProps extends ViewProps {
  sourceId: string; controlId: string; kind: 'size' | 'view'; label: string;
  selectedId: string; items: { id: string; label: string; icon: string }[];
  enabled: boolean; reduceMotion: boolean; dark: boolean; accentColor: string; surfaceColor: string;
  mostRecentEventCount: number;
  onSelectionChange: (event: NativeSyntheticEvent<{ id: string; eventCount: number }>) => void;
}

const NativeControl = usesGlasmioControls
  ? requireNativeView<NativeAppearanceProps>('FolioNavigation', 'FolioAppearanceControlView') : null;

export function AppearanceChoiceRow(props: AppearanceChoiceRowProps) {
  return NativeControl ? <GlasmioChoiceRow {...props} /> : <FallbackChoiceRow {...props} />;
}

function GlasmioChoiceRow({ kind, title, options, value, theme, disabled, onChange }: AppearanceChoiceRowProps) {
  const control = useGlassControl();
  const accept = useUiEventGuard(theme);
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReduceMotion(value); });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; listener.remove(); };
  }, []);
  const [eventCount, setEventCount] = useState(0);
  const lastEventCount = useRef(0);
  const enabled = !disabled && control.active;
  if (!NativeControl) return null;
  return <SettingsControlFocus title={title}><View style={styles.row}>
    <Text style={[settingsTypography.body, { color: theme.label }]}>{title}</Text>
    <NativeControl {...androidPageBackdropProps(theme)} sourceId={control.sourceId} controlId={control.controlId}
      reduceMotion={reduceMotion} kind={kind} label={title} selectedId={value} enabled={enabled} dark={theme.dark}
      accentColor={theme.accent} surfaceColor={theme.surface} mostRecentEventCount={eventCount}
      items={options.map((option) => ({ id: option.value, label: option.label, icon: option.systemImage ?? '' }))}
      style={{ width: '100%', height: 80 }}
      onSelectionChange={({ nativeEvent }) => {
        if (!accept(nativeEvent)) return;
        if (!Number.isSafeInteger(nativeEvent.eventCount) || nativeEvent.eventCount <= lastEventCount.current) return;
        lastEventCount.current = nativeEvent.eventCount;
        setEventCount(nativeEvent.eventCount);
        const numeric = Number(nativeEvent.id);
        const valid = kind === 'size'
          ? nativeEvent.id.trim() !== '' && Number.isFinite(numeric)
            && numeric >= Number(options[0]?.value) && numeric <= Number(options[options.length - 1]?.value)
          : options.some((option) => option.value === nativeEvent.id);
        if (enabled && valid) onChange(nativeEvent.id);
      }} />
    <View style={styles.captions} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {options.map((option) => <Text key={option.value} style={[styles.caption, { color: theme.label }]}>{option.label}</Text>)}
    </View>
  </View></SettingsControlFocus>;
}

const styles = StyleSheet.create({
  row: { ...settingsLayout.section, paddingVertical: 12 },
  // 80 点原生容器居中放置 56 点轨道，扣除底部留白后保留 5 点标签间距。
  captions: { flexDirection: 'row', marginTop: 5 - (80 - 56) / 2 },
  caption: { ...settingsTypography.detail, flex: 1, textAlign: 'center' },
});
