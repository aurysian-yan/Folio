import { requireNativeView } from 'expo';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';
import { androidPageBackdropProps, usesGlasmioControls } from './android-glass';
import { useUiEventGuard } from './UiTheme';
import type { MaterialButtonProps, MaterialDialogProps } from './MaterialControls';
interface ButtonProps extends ViewProps {
  label: string; systemImage: string; primary: boolean; destructive: boolean; enabled: boolean;
  onPress: (event: NativeSyntheticEvent<{ themeRevision?: string }>) => void;
}
interface DialogProps extends ViewProps {
  visible: boolean; title: string; message: string; actions: { id: string; label: string; destructive: boolean }[];
  onSelect: (event: NativeSyntheticEvent<{ id: string; themeRevision?: string }>) => void;
  onDismiss: () => void;
}
const Button = usesGlasmioControls ? requireNativeView<ButtonProps>('FolioNavigation', 'FolioMaterialButtonView') : null;
const Dialog = usesGlasmioControls ? requireNativeView<DialogProps>('FolioNavigation', 'FolioMaterialDialogView') : null;
export function MaterialButton({ theme, label, systemImage = '', primary = false, destructive = false, disabled = false, onPress, fullWidth }: MaterialButtonProps) {
  const accept = useUiEventGuard(theme);
  if (!Button) return null;
  return <Button {...androidPageBackdropProps(theme)} label={label} systemImage={systemImage} primary={primary} destructive={destructive} enabled={!disabled}
    style={{ height: 48, minWidth: 80, ...(fullWidth ? { width: '100%' } : { flexGrow: 1, flexShrink: 1 }) }}
    onPress={({ nativeEvent }) => { if (accept(nativeEvent) && !disabled) onPress(); }} />;
}
export function MaterialDialog({ theme, dialog, visible, onSelect, onDismiss }: MaterialDialogProps) {
  const accept = useUiEventGuard(theme);
  if (!Dialog) return null;
  return <Dialog {...androidPageBackdropProps(theme)} visible={visible && !!dialog} title={dialog?.title ?? ''} message={dialog?.message ?? ''}
    actions={dialog?.buttons.map((button, index) => ({ id: String(index), label: button.text, destructive: button.style === 'destructive' })) ?? []}
    style={{ width: 0, height: 0 }} onDismiss={onDismiss}
    onSelect={({ nativeEvent }) => { if (accept(nativeEvent)) onSelect(Number(nativeEvent.id)); }} />;
}
