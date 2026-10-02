import { ArrowCounterClockwiseIcon, CloudIcon, DotsThreeIcon, DownloadSimpleIcon, FileTextIcon, TrashIcon } from './icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import type { CloudAction, CloudFont } from './sync';
import { formatBytes, settingsLayout, settingsTypography } from './settings-ui';
import type { Theme } from './ui';

// 云端卡片收起文件明细，侧滑、更多入口与读屏提供相同操作。
export function CloudFontCard({ font, status, theme, disabled, onAction, onOpen }: {
  font: CloudFont; status: string; theme: Theme; disabled: boolean;
  onAction: (action: CloudAction) => void; onOpen: (methods: SwipeableMethods) => void;
}) {
  const { t } = useTranslation();
  const swipe = useRef<SwipeableMethods>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (disabled) swipe.current?.close(); }, [disabled]);
  const actions = font.deleted
    ? [{ action: 'restore' as const, label: t('cloud.restore'), Icon: ArrowCounterClockwiseIcon }]
    : [{ action: font.localAvailable ? 'cloudOnly' as const : 'download' as const,
      label: t(font.localAvailable ? 'cloud.keepCloudOnly' : 'cloud.downloadAgain'),
      Icon: font.localAvailable ? CloudIcon : DownloadSimpleIcon },
    { action: 'delete' as const, label: t('cloud.deleteEverywhere'), Icon: TrashIcon }];
  function execute(action: CloudAction) {
    if (disabled) return;
    swipe.current?.close();
    onAction(action);
  }
  function toggle() {
    if (open) swipe.current?.close(); else swipe.current?.openRight();
  }
  const name = font.displayName || font.filename;
  return <Swipeable ref={swipe} enabled={!disabled} enableTrackpadTwoFingerGesture overshootRight={false}
    containerStyle={styles.swipeCard} onSwipeableWillOpen={() => {
      if (swipe.current) onOpen(swipe.current);
      setOpen(true);
    }} onSwipeableClose={() => setOpen(false)} renderRightActions={() =>
      <View style={styles.actions} accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}>
        {actions.map(({ action, label, Icon }) => <Pressable key={action} accessibilityRole="button" accessibilityLabel={label}
          accessibilityState={{ disabled }} disabled={disabled} onPress={() => execute(action)}
          style={({ pressed }) => [styles.action, { backgroundColor: action === 'delete' ? theme.danger : theme.selection,
            opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}>
          <Icon size={22} color={action === 'delete' ? theme.onAccent : theme.accent} />
          <Text style={[styles.actionLabel, { color: action === 'delete' ? theme.onAccent : theme.accent }]}>{label}</Text>
        </Pressable>)}
      </View>}>
    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${name}, ${formatBytes(font.fileSize)}, ${status}`}
        accessibilityHint={t('mobile.swipeCloudFont')} accessibilityState={{ disabled }} disabled={disabled}
        accessibilityActions={disabled ? [] : actions.map(({ action, label }) => ({ name: action, label }))}
        onAccessibilityAction={({ nativeEvent }) => {
          const action = actions.find((item) => item.action === nativeEvent.actionName)?.action;
          if (action) execute(action);
        }} onPress={toggle} onLongPress={() => swipe.current?.openRight()} style={styles.body}>
        <View style={styles.fileIcon}>
          <FileTextIcon size={20} color={theme.accent} />
        </View>
        <View style={styles.info}>
          <Text numberOfLines={1} style={[styles.name, { color: theme.label }]}>{name}</Text>
          <Text numberOfLines={1} style={[styles.detail, { color: theme.secondary }]}>{formatBytes(font.fileSize)} · {status}</Text>
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('mobile.cloudFontActions', { name })}
        accessibilityState={{ disabled }} disabled={disabled} onPress={toggle}
        style={({ pressed }) => [styles.more, { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}>
        <DotsThreeIcon size={24} color={theme.secondary} />
      </Pressable>
    </View>
  </Swipeable>;
}

const styles = StyleSheet.create({
  swipeCard: { ...settingsLayout.card },
  card: { ...settingsLayout.card, minHeight: 80, flexDirection: 'row', alignItems: 'center', paddingRight: 8 },
  body: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  fileIcon: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0, gap: 4 },
  name: { ...settingsTypography.body },
  detail: { ...settingsTypography.detail, fontVariant: ['tabular-nums'] },
  more: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  actions: { ...settingsLayout.controls, flexDirection: 'row', gap: 8 },
  action: { ...settingsLayout.control, width: 88, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 8 },
  actionLabel: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
