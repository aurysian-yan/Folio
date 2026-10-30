import { requireNativeView } from 'expo';
import { ActivityIndicator as SystemIndicator, type ActivityIndicatorProps, type ViewProps } from 'react-native';
import { useUiTheme } from './UiTheme';
import { androidPageBackdropProps, usesGlasmioControls } from './android-glass';
const Indicator = usesGlasmioControls ? requireNativeView<ViewProps & { indicatorColor: string }>('FolioNavigation', 'FolioMaterialProgressView') : null;
export function ActivityIndicator(props: ActivityIndicatorProps) {
  const theme = useUiTheme();
  if (!theme?.ui?.material || !Indicator) return <SystemIndicator {...props} />;
  if (props.animating === false) return null;
  const size = typeof props.size === 'number' ? props.size : props.size === 'large' ? 48 : 24;
  return <Indicator {...androidPageBackdropProps(theme)} indicatorColor={typeof props.color === 'string' ? props.color : theme.accent}
    accessibilityRole="progressbar" accessibilityLabel={props.accessibilityLabel} style={[{ width: size, height: size, alignSelf: 'center' }, props.style]} />;
}
