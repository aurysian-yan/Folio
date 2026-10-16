import { ArrowCounterClockwiseIcon, CaretDownIcon, DotsThreeIcon, FolderPlusIcon, StarIcon } from './icons';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { IconButton, type Theme } from './ui';

export interface FontActionsMenuProps {
  theme: Theme;
  sourceId: string;
  favorite?: boolean;
  favoritePending?: boolean;
  onFavorite?: () => void;
  onAddToCollection?: () => void;
  onReset?: () => void;
  resetDisabled?: boolean;
}

// 通用入口沿用视图菜单的尺寸与操作行。
export function FontActionsMenu({ theme, favorite = false, favoritePending = false, onFavorite, onAddToCollection, onReset, resetDisabled = false }: FontActionsMenuProps) {
  const { t } = useTranslation();
  const trigger = useRef<View>(null);
  const [anchor, setAnchor] = useState<{ right: number; top: number } | null>(null);
  return <>
    <View ref={trigger} collapsable={false}>
      <IconButton theme={theme} label={t('font.operations')} selected={!!anchor} style={styles.trigger}
        onPress={() => { Keyboard.dismiss(); trigger.current?.measureInWindow((x, y, width, height) => setAnchor({ right: x + width, top: y + height })); }}>
        <DotsThreeIcon size={20} color={theme.label} /><CaretDownIcon size={10} color={theme.secondary} />
      </IconButton>
    </View>
    <Modal transparent visible={!!anchor} animationType="none" onRequestClose={() => setAnchor(null)}>
      <View style={styles.overlay}>
        <Pressable accessibilityLabel={t('common.cancel')} onPress={() => setAnchor(null)}
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]} />
        {!!anchor && <View accessibilityViewIsModal style={[styles.menu, { top: anchor.top, left: Math.max(16, anchor.right - 220),
          backgroundColor: theme.raised, borderColor: theme.border }]}>
          <Text style={[styles.title, { color: theme.secondary }]}>{t('font.operations')}</Text>
          {onFavorite && <Pressable accessibilityRole="button" disabled={favoritePending} accessibilityState={{ disabled: favoritePending }}
            onPress={() => { setAnchor(null); onFavorite(); }} style={styles.item}>
            <StarIcon size={20} color={theme.label} weight={favorite ? 'fill' : 'regular'} />
            <Text style={[styles.label, { color: theme.label, opacity: favoritePending ? 0.4 : 1 }]}>{t(favorite ? 'collection.unfavorite' : 'collection.favorite')}</Text>
          </Pressable>}
          {onAddToCollection && <Pressable accessibilityRole="button" onPress={() => { setAnchor(null); onAddToCollection(); }} style={styles.item}>
            <FolderPlusIcon size={20} color={theme.label} /><Text style={[styles.label, { color: theme.label }]}>{t('collection.addTo')}</Text>
          </Pressable>}
          {onReset && <Pressable accessibilityRole="button" disabled={resetDisabled} accessibilityState={{ disabled: resetDisabled }}
            onPress={() => { setAnchor(null); onReset(); }} style={[styles.item, { opacity: resetDisabled ? 0.4 : 1 }]}>
            <ArrowCounterClockwiseIcon size={20} color={theme.label} /><Text style={[styles.label, { color: theme.label }]}>{t('common.reset')}</Text>
          </Pressable>}
        </View>}
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  trigger: { width: 64 }, overlay: { flex: 1 },
  menu: { position: 'absolute', width: 220, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 6, overflow: 'hidden' },
  title: { fontSize: 12, paddingHorizontal: 16, paddingVertical: 8 },
  item: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  label: { flex: 1, fontSize: 16 },
});
