import { useUiEventGuard } from './UiTheme';
import { androidPageBackdropProps, usesGlasmioControls } from './android-glass';
import { Children, isValidElement } from 'react';
import { requireNativeView } from 'expo';
import { type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { useGlassControl } from './GlassControlScope';
import type { AndroidGlassButtonProps } from './AndroidGlassButton';

export { usesGlasmioControls } from './android-glass';
const NativeButton = usesGlasmioControls ? requireNativeView<ViewProps & {
  sourceId: string; controlId: string; label: string; systemImage: string; enabled: boolean;
  busy: boolean; selected: boolean; primary: boolean; dark: boolean; accentColor: string;
  onPress: (event: NativeSyntheticEvent<{ themeRevision?: string }>) => void;
}>('FolioNavigation', 'FolioHeaderActionButtonView') : null;

const iconNames: Record<string, string> = {
  FunnelSimple: 'line.3.horizontal.decrease', Plus: 'plus', SquaresFour: 'square.grid.2x2', List: 'list.bullet',
  CaretLeft: 'chevron.left', X: 'xmark', MagnifyingGlass: 'magnifyingglass', DotsThree: 'ellipsis',
};

export function AndroidGlassButton({ label, onPress, children, theme, disabled, busy, selected, style, systemImage, primary }: AndroidGlassButtonProps) {
  const control = useGlassControl();
  const accept = useUiEventGuard(theme);
  const child = Children.toArray(children).find(isValidElement);
  const type = child?.type as { displayName?: string; name?: string } | undefined;
  const name = (type?.displayName ?? type?.name ?? '').replace(/Icon$/, '');
  if (!NativeButton) return null;
  return <NativeButton {...androidPageBackdropProps(theme)} sourceId={control.sourceId} controlId={control.controlId} label={label}
    systemImage={systemImage ?? iconNames[name] ?? 'ellipsis'} enabled={!disabled && !busy && control.active}
    busy={!!busy} selected={!!selected} primary={!!primary} dark={theme.dark} accentColor={theme.accent}
    style={[{ width: theme.ui?.metrics.control ?? 44, height: theme.ui?.metrics.control ?? 44 }, style]} onPress={({ nativeEvent }) => { if (accept(nativeEvent) && !disabled && !busy && control.active) onPress(); }} />;
}
