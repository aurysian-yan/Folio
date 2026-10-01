import { CaretDownIcon, CheckIcon, ListIcon, SquaresFourIcon } from 'phosphor-react-native';
import { useState } from 'react';
import { Keyboard, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton, type Theme } from './ui';

export interface ViewModeMenuProps {
  sourceId: string;
  theme: Theme;
  mode: 'grid' | 'list';
  active: boolean;
  onModeChange: (mode: 'grid' | 'list') => void;
}

// 非安卓入口保留现有视图菜单。
export function ViewModeMenu({ theme, mode, active, onModeChange }: ViewModeMenuProps) {
  const [open, setOpen] = useState(false);
  const inset = useSafeAreaInsets();
  if (!active && open) setOpen(false);

  return <>
    <IconButton theme={theme} label="视图选项" selected={open} disabled={!active}
      onPress={() => { Keyboard.dismiss(); setOpen(true); }} style={styles.trigger}>
      {mode === 'grid' ? <SquaresFourIcon size={20} color={theme.label} /> : <ListIcon size={20} color={theme.label} />}
      <CaretDownIcon size={10} color={theme.label} />
    </IconButton>
    <Modal transparent visible={open && active} animationType="none" onRequestClose={() => setOpen(false)}>
      <View style={styles.overlay}>
        <Pressable accessibilityLabel="关闭视图选项" onPress={() => setOpen(false)}
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]} />
        <View accessibilityViewIsModal style={[styles.menu, {
          top: inset.top + 62, right: Math.max(22, inset.right + 10),
          backgroundColor: theme.raised, borderColor: theme.border,
        }]}>
          <Text style={[styles.title, { color: theme.secondary }]}>视图</Text>
          {(['grid', 'list'] as const).map((value) => (
            <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: mode === value }}
              onPress={() => { onModeChange(value); setOpen(false); }}
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: theme.surface }]}>
              {value === 'grid' ? <SquaresFourIcon size={20} color={theme.label} /> : <ListIcon size={20} color={theme.label} />}
              <Text style={[styles.label, { color: theme.label }]}>{value === 'grid' ? '网格视图' : '列表视图'}</Text>
              {mode === value && <CheckIcon size={18} color={theme.accent} />}
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  trigger: { paddingHorizontal: 12 }, overlay: { flex: 1 },
  menu: { position: 'absolute', width: 220, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 6, overflow: 'hidden' },
  title: { fontSize: 12, paddingHorizontal: 16, paddingVertical: 8 },
  item: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  label: { flex: 1, fontSize: 16 },
});
