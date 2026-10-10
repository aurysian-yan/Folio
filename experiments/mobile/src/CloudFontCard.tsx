import { ArrowCounterClockwiseIcon, CloudIcon, DotsThreeIcon, DownloadSimpleIcon, FileTextIcon, TrashIcon } from './icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import type { CloudAction, CloudFont } from './sync';
import { formatBytes, settingsLayout, settingsTypography } from './settings-ui';
import type { Theme } from './ui';
import { FontLocationIcons } from './FontLocationIcons';
import { SwipeCardAction, swipeCardGesture, swipeCardStyles } from './SwipeCardAction';

// 云端卡片收起文件明细，侧滑、更多入口与读屏提供相同操作。
export function CloudFontCard({ font, status, theme, disabled, onAction, onOpen, onDetails, canDownload = false }: {
  font: CloudFont; status: string; theme: Theme; disabled: boolean;
  onDetails?: () => void;
  canDownload?: boolean;
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
    if (disabled && !(action === 'download' && canDownload)) return;
    swipe.current?.close();
    onAction(action);
  }
  function toggle() {
    if (open) swipe.current?.close(); else swipe.current?.openRight();
  }
  const name = font.displayName || font.filename;
  return <Swipeable ref={swipe} enabled={!disabled || canDownload} {...swipeCardGesture}
    containerStyle={swipeCardStyles.container} onSwipeableWillOpen={() => {
      if (swipe.current) onOpen(swipe.current);
      setOpen(true);
    }} onSwipeableClose={() => setOpen(false)} renderRightActions={() =>
      <View style={swipeCardStyles.actions} accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}>
        {actions.map(({ action, label, Icon }) => {
          const actionDisabled = disabled && !(action === 'download' && canDownload);
          return <SwipeCardAction key={action} label={label} Icon={Icon} theme={theme} destructive={action === 'delete'}
            disabled={actionDisabled} onPress={() => execute(action)} />;
        })}
      </View>}>
    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${name}, ${t(font.deleted ? 'cloud.recentlyDeleted' : font.localAvailable ? 'fontLocation.both' : 'fontLocation.cloudOnly')}, ${formatBytes(font.fileSize)}, ${status}`}
        accessibilityHint={t('mobile.swipeCloudFont')} accessibilityState={{ disabled: font.deleted }} disabled={font.deleted}
        accessibilityActions={actions.filter(({action}) => !disabled || (action === 'download' && canDownload)).map(({ action, label }) => ({ name: action, label }))}
        onAccessibilityAction={({ nativeEvent }) => {
          const action = actions.find((item) => item.action === nativeEvent.actionName)?.action;
          if (action) execute(action);
        }} onPress={onDetails ?? toggle} onLongPress={() => swipe.current?.openRight()} style={styles.body}>
        <View style={styles.fileIcon}>
          <FileTextIcon size={20} color={theme.accent} />
        </View>
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text numberOfLines={1} style={[styles.name, { color: theme.label }]}>{name}</Text>
            <FontLocationIcons local={font.localAvailable} cloud={!font.deleted} color={theme.secondary} />
          </View>
          <Text numberOfLines={1} style={[styles.detail, { color: theme.secondary }]}>{formatBytes(font.fileSize)}</Text>
          {!!status && <Text accessibilityLiveRegion="polite" style={[styles.detail,{color:theme.secondary}]}>{status}</Text>}
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('mobile.cloudFontActions', { name })}
        accessibilityState={{ disabled: disabled && !canDownload }} disabled={disabled && !canDownload} onPress={toggle}
        style={({ pressed }) => [styles.more, { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}>
        <DotsThreeIcon size={24} color={theme.secondary} />
      </Pressable>
    </View>
  </Swipeable>;
}

const styles = StyleSheet.create({
  card: { ...settingsLayout.card, minHeight: 80, flexDirection: 'row', alignItems: 'center', paddingRight: 8 },
  body: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  fileIcon: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0 },
  name: { ...settingsTypography.body, flexShrink: 1, minWidth: 0 },
  detail: { ...settingsTypography.detail, fontVariant: ['tabular-nums'] },
  more: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
