import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import { MaterialDialog } from './MaterialControls';
import { FilterDrawer, FilterScrollView } from './FilterDrawer';
import { NavigationScrollContext } from './NavigationScroll';
import { PanelAction } from './panel-content';
import type { Theme } from './ui';

export interface DialogButton { text: string; style?: 'cancel' | 'destructive' | 'default'; onPress?: () => void }
export interface Dialog { title: string; message: string; buttons: DialogButton[] }
const DialogContext = createContext<{ alert: (title: string, message: string, buttons: DialogButton[]) => void }>({ alert: () => {} });

// 确认操作复用筛选面板，关闭动画结束后再打开后续面板。
export function DialogProvider({ children, theme }: { children: ReactNode; theme: Theme }) {
  const navigation = useContext(NavigationScrollContext);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [visible, setVisible] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const alert = useCallback((title: string, message: string, buttons: DialogButton[]) => {
    if (timer.current) clearTimeout(timer.current);
    pending.current = null; setDialog({ title, message, buttons }); setVisible(true);
  }, []);
  const finish = () => { const next = pending.current; pending.current = null; setDialog(null); next?.(); };
  const close = (action?: () => void) => {
    setVisible(false); pending.current = action ?? null;
    if (Platform.OS !== 'ios') timer.current = setTimeout(finish, 0);
  };
  return <DialogContext.Provider value={{ alert }}><NavigationScrollContext.Provider value={{ ...navigation, enabled: navigation.enabled && !dialog }}>
    {children}
    {theme.ui?.material ? <MaterialDialog theme={theme} dialog={dialog} visible={visible}
      onDismiss={() => close()} onSelect={(index) => { const button = dialog?.buttons[index]; if (button) close(button.onPress); }} />
      : <FilterDrawer visible={visible} title={dialog?.title ?? ''} theme={theme} onClose={() => close()} onDismissed={finish}>
      {dialog && <DialogContent dialog={dialog} theme={theme} onSelect={(button) => close(button.onPress)} />}
    </FilterDrawer>}
  </NavigationScrollContext.Provider></DialogContext.Provider>;
}
export function useDialogs() { return useContext(DialogContext); }
const styles = StyleSheet.create({ content: { padding: 16, gap: 16 } });

export function usePanelDialog() {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  return { dialog, dismiss: () => setDialog(null), alert: (title: string, message: string, buttons: DialogButton[]) => setDialog({ title, message, buttons }) };
}
export function DialogContent({ dialog, theme, onSelect }: { dialog: Dialog; theme: Theme; onSelect: (button: DialogButton) => void }) {
  return <FilterScrollView contentContainerStyle={styles.content}>
    <Text style={{ color: theme.label }}>{dialog.message}</Text>
    {dialog.buttons.map((button, index) => <PanelAction key={index} theme={theme} label={button.text} destructive={button.style === 'destructive'}
      primary={button.style !== 'cancel'} onPress={() => onSelect(button)} />)}
  </FilterScrollView>;
}
