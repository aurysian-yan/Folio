import { CaretDownIcon, CheckIcon } from './icons';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { matchingWebdavPreset, webdavPresets } from './sync';
import type { Theme } from './ui';

export interface WebDAVPresetMenuProps { theme: Theme; serverUrl: string; disabled: boolean; sourceId?: string; onChange: (url: string) => void }

// 地址右侧菜单沿用移动端菜单的主题与行尺寸。
export function WebDAVPresetMenu({ theme, serverUrl, disabled, onChange }: WebDAVPresetMenuProps) {
  const { t } = useTranslation();
  const trigger = useRef<View>(null);
  const [anchor, setAnchor] = useState<{ right: number; top: number } | null>(null);
  const selected = matchingWebdavPreset(serverUrl);
  return <>
    <Pressable ref={trigger} accessibilityRole="button" accessibilityLabel={t('cloud.provider')}
      accessibilityState={{ disabled, expanded: !!anchor }} disabled={disabled}
      onPress={() => { Keyboard.dismiss(); trigger.current?.measureInWindow((x, y, width, height) => setAnchor({ right: x + width, top: y + height })); }}
      style={[styles.trigger, { opacity: disabled ? 0.4 : 1 }]}>
      <CaretDownIcon size={14} color={theme.secondary} />
    </Pressable>
    <Modal transparent visible={!!anchor && !disabled} animationType="none" onRequestClose={() => setAnchor(null)}>
      <View style={styles.overlay}>
        <Pressable accessibilityLabel={t('common.cancel')} style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]} onPress={() => setAnchor(null)} />
        {!!anchor && <View accessibilityViewIsModal style={[styles.menu, { left: Math.max(16, anchor.right - 220), top: anchor.top,
          backgroundColor: theme.raised, borderColor: theme.border }]}>
          {webdavPresets.map((preset) => <Pressable key={preset.id} accessibilityRole="radio" accessibilityState={{ checked: preset.id === selected }}
            onPress={() => { onChange(preset.url); setAnchor(null); }} style={({ pressed }) => [styles.item, pressed && { backgroundColor: theme.surface }]}>
            <Text style={[styles.itemLabel, { color: theme.label }]}>{t(preset.label)}</Text>
            {preset.id === selected && <CheckIcon size={18} color={theme.accent} />}
          </Pressable>)}
        </View>}
      </View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  trigger: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  overlay: { flex: 1 },
  menu: { position: 'absolute', width: 220, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 6, overflow: 'hidden' },
  item: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  itemLabel: { flex: 1, fontSize: 16 },
});
