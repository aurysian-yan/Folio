import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Animated, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type ViewToken } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { CharacterMapSession, characterForeground, characterMapError, characterPageSize, characterText, codepointLabel,
  type CharacterEntry, type CharacterGlyph, type CharacterMapInfo, type CharacterPage } from '../../../shared/character-map';
import type { FontFace, FontFamily } from './library';
import { characterMap, copyText } from './native';
import { PanelAction } from './panel-content';
import { DetailSlider } from './DetailSlider';
import { adjustableAxes, axisStep, defaultAxisValues, formatAxisValue } from './font-details';
import { SettingsGroup, settingsLayout, settingsTypography } from './settings-ui';
import { IconButton, type Theme } from './ui';
import { CaretLeftIcon } from './icons';
import { PageHeader, PageTitle, usePageHeader } from './PageHeader';
import { NavigationBackdrop } from './bottom-navigation';
import { NativeScrollContainer } from './native-controls';
import { CharacterMapChoice } from './CharacterMapChoice';

export function CharacterMap({ family, initialFace, initialAxes, theme, onClose, onDownload, deferClose }: {
  family: FontFamily; initialFace: FontFace; initialAxes: Record<string, number>; theme: Theme;
  onClose: () => void; onDownload: (fingerprint: string) => Promise<void>;
  deferClose?: (close: () => void) => boolean;
}) {
  const { t } = useTranslation();
  const list = useRef<FlatList<CharacterEntry>>(null);
  const header = usePageHeader({ bottomTabs: false,
    onSnap: (offset, animated) => list.current?.scrollToOffset({ offset, animated }) });
  const [chosenFace, setFace] = useState(initialFace);
  const face = family.faces.find((item) => item.id === chosenFace.id) ?? chosenFace;
  const sources = [...new Set([face.sourcePath, ...(face.location?.files.flatMap((file) => file.localSources.map((source) => source.path)) ?? [])].filter((path): path is string => !!path))];
  const [sourcePath, setSource] = useState(initialFace.sourcePath ?? '');
  const source = sourcePath || face.sourcePath || '';
  const [axes, setAxes] = useState(initialAxes);
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; session: CharacterMapSession; info: CharacterMapInfo } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const selectionKey = JSON.stringify([face.id, face.revisionId, source, retry]);
  const finishSession = useEffectEvent((session: CharacterMapSession) => {
    if (!deferClose?.(() => session.close())) session.close();
  });
  useEffect(() => {
    let current = true;
    const session = new CharacterMapSession(characterMap);
    const opening = !source && face.location?.cloudAvailable ? Promise.reject(new Error('characterMap.error.notDownloaded')) : session.open({ faceId: face.id, revisionId: face.revisionId, sourcePath: source });
    opening.then((info) => {
      if (current && info) setLoaded({ key: selectionKey, session, info });
    }).catch((cause) => { if (current) setFailure({ key: selectionKey, message: characterMapError(cause) }); });
    return () => { current = false; finishSession(session); };
  }, [selectionKey, face.id, face.revisionId, source, face.location?.cloudAvailable]);
  const active = loaded?.key === selectionKey ? loaded : null;
  const error = failure?.key === selectionKey ? failure.message : null;
  const controls = <>
    <PageTitle {...header} title={t('characterMap.title')} theme={theme} style={settingsLayout.pageTitle} />
    <Text style={[settingsLayout.section, settingsTypography.detail, { color: theme.secondary }]}>{family.displayName}</Text>
    <SettingsGroup theme={theme}>
      <ChoiceRow sourceId={header.sourceId} label={t('font.styles')} theme={theme} value={face.id} options={family.faces.map((item) => ({ value: item.id, label: item.styleName }))} onChange={(id) => {
        const next = family.faces.find((item) => item.id === id);
        if (!next) return;
        header.restoreTitle(); setFace(next); setSource(next.sourcePath ?? ''); setAxes(defaultAxisValues(next));
      }} />
      {sources.length > 0 && <ChoiceRow sourceId={header.sourceId} label={t('inspector.source')} theme={theme} value={source} options={sources.map((path) => ({ value: path, label: path }))} onChange={(path) => { header.restoreTitle(); setSource(path); }} />}
    </SettingsGroup>
    {adjustableAxes(face).length > 0 && <SettingsGroup theme={theme} title={t('inspector.variableAxes')}>
      {adjustableAxes(face).map((axis) => <DetailSlider key={axis.tag} label={axis.name || axis.tag} theme={theme}
        value={axes[axis.tag] ?? axis.defaultValue} minimum={axis.minimum} maximum={axis.maximum} step={axisStep(axis.minimum, axis.maximum)}
        formatValue={formatAxisValue} onChange={(value) => setAxes((values) => ({ ...values, [axis.tag]: value }))} />)}
    </SettingsGroup>}
  </>;
  const failureContent = error ? <View style={settingsLayout.content}>
    <Text accessibilityRole="alert" style={{ color: theme.danger }}>{t(error)}</Text>
    <PanelAction label={t('common.retry')} theme={theme} onPress={() => setRetry((value) => value + 1)} />
    {face.location?.files.filter((file) => file.cloudAvailable && !file.localSources.length).map((file) => <PanelAction key={file.fingerprint} label={t('fontLocation.download')} theme={theme}
      onPress={() => { void onDownload(file.fingerprint).catch((cause) => setFailure({ key: selectionKey, message: characterMapError(cause) })); }} />)}
  </View> : null;
  return <SafeAreaView edges={['left', 'right']} style={[styles.screen, { backgroundColor: theme.background }]}>
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <CharacterMapContent key={selectionKey} session={active?.session ?? null} info={active?.info ?? null} axes={axes} theme={theme}
        header={header} controls={controls} list={list} failureContent={failureContent} onClose={onClose} />
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function CharacterMapContent({ session, info, axes, theme, header, controls, list, failureContent, onClose }: {
  session: CharacterMapSession | null; info: CharacterMapInfo | null; axes: Record<string, number>; theme: Theme;
  header: ReturnType<typeof usePageHeader>; controls: ReactNode; list: RefObject<FlatList<CharacterEntry> | null>;
  failureContent: ReactNode; onClose: () => void;
}) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const wide = width >= 768;
  const gridWidth = wide ? width * 0.65 : width;
  const columns = Math.max(2, Math.floor(gridWidth / 80));
  const headerHeight = useRef(0);
  const pageScroll = useRef(false);
  const scrollFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);
  const [search, setSearch] = useState('');
  const [script, setScript] = useState('');
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; page: CharacterPage } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [selected, setSelected] = useState<CharacterEntry | null>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 24 });
  const queryKey = JSON.stringify([info?.handle, search, script, offset, retry]);
  const page = result?.key === queryKey ? result.page : null;
  const foreground = useMemo(() => characterForeground(theme.label), [theme.label]);
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<CharacterEntry>[] }) => {
    const indices = viewableItems.map((item) => item.index ?? 0);
    if (indices.length) setVisibleRange({ start: Math.min(...indices), end: Math.max(...indices) + 1 });
  }, []);
  useEffect(() => {
    if (!session) return;
    let current = true;
    const timer = setTimeout(() => {
      session.query({ text: search, script: script || null, offset, limit: characterPageSize }).then((value) => {
        if (current) {
          setResult({ key: queryKey, page: value }); setSelected(value.entries[0] ?? null); setVisibleRange({ start: 0, end: 24 });
          if (pageScroll.current) {
            pageScroll.current = false;
            scrollFrame.current = requestAnimationFrame(() => list.current?.scrollToOffset({ offset: headerHeight.current, animated: false }));
          }
        }
      }).catch((cause) => { if (current) setFailure({ key: queryKey, message: characterMapError(cause) }); });
    }, 120);
    return () => { current = false; clearTimeout(timer); };
  }, [session, queryKey, search, script, offset, list]);
  const visible = useMemo(() => page?.entries.slice(Math.max(0, visibleRange.start - columns), visibleRange.end + columns) ?? [], [page, visibleRange, columns]);
  const renderKey = JSON.stringify([queryKey, axes, foreground, visible.map((entry) => entry.glyphId)]);
  const [images, setImages] = useState<{ key: string; values: CharacterGlyph[] } | null>(null);
  useEffect(() => {
    let current = true;
    const glyphIds = [...new Set(visible.map((entry) => entry.glyphId))];
    if (!session || !glyphIds.length) return;
    session.render({ glyphIds, axes, foreground, size: 128 }).then((values) => { if (current) setImages({ key: renderKey, values }); })
      .catch((cause) => { if (current) setFailure({ key: queryKey, message: characterMapError(cause) }); });
    return () => { current = false; };
  }, [session, renderKey, queryKey, visible, axes, foreground]);
  const byGlyph = useMemo(() => new Map((images?.key === renderKey ? images.values : []).map((image) => [image.glyphId, image])), [images, renderKey]);
  const error = failure?.key === queryKey ? failure.message : null;
  const listHeader = <View onLayout={({ nativeEvent }) => { headerHeight.current = nativeEvent.layout.height; }}>
    {controls}
    {info && <View style={settingsLayout.content}>
      <TextInput value={search} onChangeText={(value) => { setSearch(value); setOffset(0); }} accessibilityLabel={t('characterMap.search')}
        placeholder={t('characterMap.search')} placeholderTextColor={theme.secondary} autoCapitalize="none" autoCorrect={false}
        style={[styles.search, settingsTypography.body, { color: theme.label, backgroundColor: theme.surface, borderColor: theme.border }]} />
      <ChoiceRow sourceId={header.sourceId} label={t('filters.script')} theme={theme} value={script} options={[{ value: '', label: t('characterMap.allScripts') }, ...info.scripts.map((item) => ({ value: item.name, label: `${item.name} (${item.count})` }))]}
        onChange={(value) => { setScript(value); setOffset(0); }} />
      <Text style={[settingsTypography.detail, { color: theme.secondary }]}>{t('characterMap.count', { count: page?.total ?? info.count })}</Text>
      {error && <View><Text accessibilityRole="alert" style={{ color: theme.danger }}>{t(error)}</Text><PanelAction label={t('common.retry')} theme={theme} onPress={() => setRetry((value) => value + 1)} /></View>}
    </View>}
    {failureContent}
  </View>;
  return <NativeScrollContainer hasHeader onInsetsChange={header.onInsetsChange} style={styles.screen}>
    <PageHeader {...header} title={t('characterMap.title')} theme={theme} style={styles.header} leading={
      <IconButton theme={theme} label={t('common.back')} systemImage="chevron.left" onPress={onClose}>
        <CaretLeftIcon size={20} color={theme.label} />
      </IconButton>
    } />
    <NavigationBackdrop sourceId={header.sourceId} active theme={theme} style={styles.screen}>
    <View style={[styles.screen, wide && styles.wide]}>
      <Animated.FlatList ref={list} key={columns} style={styles.grid}
        ListHeaderComponent={listHeader} {...header.snapScrollProps} onScroll={header.onScroll} scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="never" automaticallyAdjustsScrollIndicatorInsets={false}
        scrollIndicatorInsets={{ top: header.contentTop, bottom: header.contentBottom }}
        contentContainerStyle={{ paddingTop: header.contentTop, paddingBottom: 16 }} keyboardDismissMode="on-drag" data={page?.entries ?? []} numColumns={columns} keyExtractor={(entry) => String(entry.codepoint)}
        extraData={[byGlyph, selected, theme]} initialNumToRender={columns * 4} maxToRenderPerBatch={columns * 4} windowSize={3}
        onViewableItemsChanged={onViewableItemsChanged} keyboardShouldPersistTaps="handled"
        ListEmptyComponent={page ? <Text style={[settingsLayout.content, { color: theme.secondary }]}>{t('characterMap.empty')}</Text> : !error && !failureContent ? <ActivityIndicator color={theme.accent} /> : null}
        renderItem={({ item }) => {
          const image = byGlyph.get(item.glyphId);
          return <Pressable style={[styles.cell, { backgroundColor: selected?.codepoint === item.codepoint ? theme.raised : theme.background }]}
            accessibilityRole="button" accessibilityState={{ selected: selected?.codepoint === item.codepoint }}
            accessibilityLabel={t('characterMap.characterLabel', { codepoint: codepointLabel(item.codepoint), glyphId: item.glyphId, script: item.script })}
            onPress={() => setSelected(item)}>
            <Image source={image?.dataUrl ?? undefined} style={styles.cellImage} contentFit="contain" accessible={false} recyclingKey={`${renderKey}:${item.glyphId}`} />
            <Text style={[settingsTypography.detail, { color: theme.secondary }]}>{codepointLabel(item.codepoint)}</Text>
            {image?.status === 'error' && <Text style={{ color: theme.danger }}>{t('characterMap.error.renderFailed')}</Text>}
          </Pressable>;
        }} />
      {session && selected && page && <CharacterDetail key={`${selected.codepoint}:${JSON.stringify(axes)}:${foreground}`} session={session} entry={selected} axes={axes} foreground={foreground} theme={theme} wide={wide} topInset={wide ? header.contentTop : 0} maxHeight={height * (wide ? 0.7 : 0.3)} />}
    </View>
    <View style={[settingsLayout.content, styles.pager, { paddingBottom: header.contentBottom }]}>
      <PanelAction label={t('characterMap.previousPage')} theme={theme} disabled={offset === 0} onPress={() => { pageScroll.current = true; setOffset(Math.max(0, offset - characterPageSize)); }} />
      <Text style={{ color: theme.secondary }}>{t('characterMap.page', { page: Math.floor(offset / characterPageSize) + 1, pages: Math.max(1, Math.ceil((page?.total ?? 0) / characterPageSize)) })}</Text>
      <PanelAction label={t('characterMap.nextPage')} theme={theme} disabled={!page || offset + characterPageSize >= page.total} onPress={() => { pageScroll.current = true; setOffset(offset + characterPageSize); }} />
    </View>
    </NavigationBackdrop>
  </NativeScrollContainer>;
}

function CharacterDetail({ session, entry, axes, foreground, theme, wide, maxHeight, topInset }: {
  session: CharacterMapSession; entry: CharacterEntry; axes: Record<string, number>; foreground: [number, number, number, number]; theme: Theme; wide: boolean; maxHeight: number; topInset: number;
}) {
  const { t } = useTranslation();
  const [image, setImage] = useState<CharacterGlyph | null>(null);
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState('');
  useEffect(() => {
    let current = true;
    session.render({ glyphIds: [entry.glyphId], axes, foreground, size: 512 }).then((values) => { if (current) setImage(values[0] ?? null); })
      .catch((cause) => { if (current) setImage({ glyphId: entry.glyphId, status: 'error', dataUrl: null, error: characterMapError(cause) }); });
    return () => { current = false; };
  }, [session, entry.glyphId, axes, foreground, retry]);
  async function copy(value: string) {
    try { await copyText(value); setStatus(t('common.copied')); }
    catch { setStatus(t('characterMap.error.copyFailed')); }
  }
  return <ScrollView style={[wide && styles.detailWide, { maxHeight }]} contentContainerStyle={[settingsLayout.content, !wide && styles.detailRow, { paddingTop: topInset }]}>
    <View style={wide ? styles.largeImage : styles.phoneImage}>
      {image?.dataUrl && <Image source={image.dataUrl} style={styles.image} contentFit="contain" accessibilityLabel={codepointLabel(entry.codepoint)} />}
      {image?.status === 'empty' && <Text style={{ color: theme.secondary }}>{t('characterMap.blankGlyph')}</Text>}
      {image?.status === 'error' && <View><Text accessibilityRole="alert" style={{ color: theme.danger }}>{t(image.error ?? 'characterMap.error.renderFailed')}</Text><PanelAction label={t('common.retry')} theme={theme} onPress={() => setRetry((value) => value + 1)} /></View>}
      {!image && <ActivityIndicator color={theme.accent} />}
    </View>
    <View style={styles.screen}>
      <Text style={[settingsTypography.body, { color: theme.label }]}>{codepointLabel(entry.codepoint)}</Text>
      <Text style={[settingsTypography.detail, { color: theme.secondary }]}>{t('characterMap.glyphId')}: {entry.glyphId} · {entry.script}</Text>
      <View style={styles.pager}>
        <PanelAction label={t('characterMap.copyCharacter')} theme={theme} onPress={() => { void copy(characterText(entry)); }} />
        <PanelAction label={t('characterMap.copyCodepoint')} theme={theme} onPress={() => { void copy(codepointLabel(entry.codepoint)); }} />
      </View>
      {!!status && <Text accessibilityLiveRegion="polite" style={{ color: theme.secondary }}>{status}</Text>}
    </View>
  </ScrollView>;
}

function ChoiceRow({ label, options, value, onChange, theme, sourceId }: {
  label: string; options: { value: string; label: string }[]; value: string; onChange: (value: string) => void; theme: Theme; sourceId: string;
}) {
  return <View style={[settingsLayout.row, styles.choiceRow]}>
    <Text style={[settingsTypography.body, { color: theme.label }]}>{label}</Text>
    <Text numberOfLines={1} style={[styles.choiceValue, settingsTypography.detail, { color: theme.secondary }]}>{options.find((item) => item.value === value)?.label}</Text>
    <CharacterMapChoice label={label} options={options} value={value} onChange={onChange} theme={theme} sourceId={sourceId} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { paddingHorizontal: 16 }, wide: { flexDirection: 'row' },
  grid: { flex: 1 }, cell: { flex: 1, height: 96, alignItems: 'center', justifyContent: 'center' }, cellImage: { width: 64, height: 64 },
  detailWide: { width: '35%' }, detailRow: { flexDirection: 'row', alignItems: 'center' },
  phoneImage: { width: 112, height: 112 }, largeImage: { width: '100%', aspectRatio: 1 }, image: { width: '100%', height: '100%' },
  pager: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  search: { minHeight: 44, paddingHorizontal: 16, borderWidth: StyleSheet.hairlineWidth },
  choiceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, choiceValue: { flex: 1, textAlign: 'right' },
});
