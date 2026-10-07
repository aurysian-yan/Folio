import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { ArrowClockwiseIcon, BookmarkIcon, CaretRightIcon, CloudArrowDownIcon, CloudArrowUpIcon, CloudCheckIcon,
  CloudIcon, HardDrivesIcon, LassoIcon, StethoscopeIcon, TrayArrowUpIcon, WarningIcon } from './icons';
import type { HeroAction, HeroKind, HeroPresentation } from './library-hero';
import type { Theme } from './ui';

const icons = { normal: LassoIcon, damaged: StethoscopeIcon, update: TrayArrowUpIcon, cloudAhead: CloudArrowDownIcon,
  localUnsynced: CloudArrowUpIcon, cloudStorageLow: HardDrivesIcon, conflict: BookmarkIcon } satisfies Record<HeroKind, typeof LassoIcon>;

// 文案采用桌面状态，窄屏沿用移动设计的图标、标题与说明排列。
export function LibraryHero({ presentation, theme, onAction, onLayout }: {
  presentation: HeroPresentation; theme: Theme; onAction: (action: HeroAction) => void;
  onLayout: (event: LayoutChangeEvent) => void;
}) {
  const Icon = icons[presentation.kind];
  const standaloneIcon = ['normal', 'damaged', 'update'].includes(presentation.kind);
  const color = presentation.kind === 'normal' ? theme.heroNormal : presentation.kind === 'damaged' ? theme.heroDamaged
    : presentation.kind === 'update' ? theme.heroUpdate : presentation.kind === 'conflict' ? theme.heroConflict : theme.heroCloud;
  const SyncIcon = ['checking', 'running'].includes(presentation.sync.state) ? ArrowClockwiseIcon
    : presentation.sync.state === 'error' ? WarningIcon : presentation.sync.state === 'synced' ? CloudCheckIcon : CloudIcon;
  const action = presentation.action === 'fontHealth' ? undefined : presentation.action;
  const title = <Text accessibilityRole="header" style={[styles.title, { color: theme.label }]}>{presentation.title}</Text>;
  const heading = action ? <Pressable accessibilityRole="button" accessibilityLabel={`${presentation.title}，${presentation.actionLabel}`}
    onPress={() => onAction(action)} style={styles.titleAction}>
    {title}<CaretRightIcon size={16} color={theme.muted} />
  </Pressable> : title;
  const sync = <><View style={styles.syncIcon}><SyncIcon size={16}
    color={['pending', 'error'].includes(presentation.sync.state) ? theme.heroCloud : theme.secondary} /></View>
    <Text style={[styles.syncText, { color: theme.secondary }]}>{presentation.sync.text}</Text></>;
  return <View style={styles.hero} onLayout={onLayout}>
    {standaloneIcon ? <><Icon size={32} color={color} /><View style={styles.heading}>{heading}</View></>
      : <View style={styles.headingRow}><Icon size={24} color={color} />{heading}</View>}
    <Text style={[styles.subtitle, { color: theme.secondary }]}>{presentation.subtitle}</Text>
    {presentation.sync.action ? <Pressable accessibilityRole="button" onPress={() => onAction(presentation.sync.action!)} style={styles.sync}>{sync}</Pressable>
      : <View accessibilityLiveRegion="polite" style={styles.sync}>{sync}</View>}
    {presentation.detail && <View style={styles.detail}><View style={styles.syncIcon}><LassoIcon size={16} color={theme.secondary} /></View>
      <Text style={[styles.syncText, { color: theme.secondary }]}>{presentation.detail}</Text></View>}
  </View>;
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 16, paddingVertical: 12 },
  heading: { paddingTop: 8, paddingBottom: 8 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 8 },
  titleAction: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flexShrink: 1, fontSize: 30, fontWeight: '600', lineHeight: 36 },
  subtitle: { fontSize: 18, fontWeight: '600', lineHeight: 22 },
  sync: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, paddingTop: 8 },
  detail: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  syncIcon: { height: 32, justifyContent: 'center' },
  syncText: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 32 },
});
