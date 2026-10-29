import { requireNativeView } from 'expo';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View, useWindowDimensions, type NativeSyntheticEvent, type ViewProps } from 'react-native';
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
  const { fontScale } = useWindowDimensions();
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
      style={{ width: '100%', height: 80 + Math.ceil(36 * fontScale) }}
      onSelectionChange={({ nativeEvent }) => {
        if (!Number.isSafeInteger(nativeEvent.eventCount) || nativeEvent.eventCount <= lastEventCount.current) return;
        lastEventCount.current = nativeEvent.eventCount;
        setEventCount(nativeEvent.eventCount);
        if (enabled && options.some((option) => option.value === nativeEvent.id)) onChange(nativeEvent.id);
      }} />
  </View></SettingsControlFocus>;
}

const styles = StyleSheet.create({ row: { ...settingsLayout.formControls, paddingVertical: 12 } });
