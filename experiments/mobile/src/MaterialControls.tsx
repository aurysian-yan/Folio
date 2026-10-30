import type { Theme } from './ui';
import type { Dialog } from './Dialogs';
export interface MaterialButtonProps { theme: Theme; label: string; systemImage?: string; primary?: boolean; destructive?: boolean; disabled?: boolean; onPress: () => void; fullWidth?: boolean }
export interface MaterialDialogProps { theme: Theme; dialog: Dialog | null; visible: boolean; onSelect: (index: number) => void; onDismiss: () => void }
export function MaterialButton(_props: MaterialButtonProps) { return null; }
export function MaterialDialog(_props: MaterialDialogProps) { return null; }
