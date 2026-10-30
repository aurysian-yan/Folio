import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator } from './UiActivityIndicator';
import { TextInput } from './UiTextInput';
import { Animated, FlatList, Platform, Pressable, StyleSheet, Text, View, type ViewToken } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CharacterGlyphImage } from './CharacterGlyphImage';
import { CharacterPreviewRenderer } from './character-preview';
import { CharacterMapSession, characterForeground, characterMapError, characterPageSize, characterText, codepointLabel,
  type CharacterEntry, type CharacterGlyph, type CharacterMapInfo, type CharacterPage } from '../../../shared/character-map';
import { characterMatchesQuery, firstNonEmptyCharacter, mergeCharacterPage, renderCharacterAxisTransition } from '../../../shared/character-preview';
import type { FontFace, FontFamily } from './library';
import { characterMap } from './native';
import { CopyButton } from './CopyButton';
import { PanelAction } from './panel-content';
import { DetailSlider } from './DetailSlider';
import { adjustableAxes, axisStep, defaultAxisValues, formatAxisValue } from './font-details';
import { SettingsGroup, settingsLayout, settingsTypography } from './settings-ui';
import { IconButton, type Theme } from './ui';
import { CaretLeftIcon } from './icons';
import { PageHeader, usePageHeader } from './PageHeader';
import { NavigationBackdrop } from './bottom-navigation';
import { NativeScrollContainer } from './native-controls';
import { FontChoiceRow, FontStylePicker } from './FontStylePicker';
import { CharacterInspectorSheet } from './CharacterInspectorSheet';
import { canCopyCharacter, characterGridLayout, fontSourceOptions } from './character-map-layout';
import { FontActionsMenu } from './FontActionsMenu';
import { usePreferences } from './settings';

export function CharacterMap({ family, initialFace, initialAxes, theme, onClose, onDownload, deferClose }: {
  family: FontFamily; initialFace: FontFace; initialAxes: Record<string, number>; theme: Theme;
  onClose: () => void; onDownload: (fingerprint: string) => Promise<void>;
  deferClose?: (close: () => void) => boolean;
}) {
  const { t } = useTranslation();
  const { preferences, ready } = usePreferences();
  const list = useRef<FlatList<CharacterEntry>>(null);
  const header = usePageHeader({ bottomTabs: false,
    onSnap: (offset, animated) => list.current?.scrollToOffset({ offset, animated }) });
  const [chosenFace, setFace] = useState(initialFace);
  const face = family.faces.find((item) => item.id === chosenFace.id) ?? chosenFace;
  const sources = fontSourceOptions(face, t);
  const [sourcePath, setSource] = useState(initialFace.sourcePath ?? '');
  const source = sourcePath || face.sourcePath || '';
  const [axes, setAxes] = useState(() => preferences.characterMapInheritAxes ? { ...initialAxes } : defaultAxisValues(initialFace));
  const [committedAxes, setCommittedAxes] = useState(axes);
  const [adjusting, setAdjusting] = useState(false);
  const editing = useRef(false);
  const latestAxes = useRef(axes);
  const updateAxes = (next: Record<string, number>) => {
    latestAxes.current = next;
    setAxes(next);
    if (!editing.current) setCommittedAxes(next);
  };
  const editAxes = (active: boolean) => {
    editing.current = active;
    setAdjusting(active);
    if (!active) setCommittedAxes(latestAxes.current);
  };
  const axesChanged = adjustableAxes(face).some((axis) => (axes[axis.tag] ?? axis.defaultValue) !== axis.defaultValue);
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
  const cardBackground = Platform.OS === 'android' ? (theme.dark ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.05)') : undefined;
  const controls = <>
    <SettingsGroup theme={theme} backgroundColor={cardBackground}>
      <FontStylePicker sourceId={header.sourceId} faces={family.faces} selectedFaceId={face.id} theme={theme} onChange={(id) => {
        const next = family.faces.find((item) => item.id === id);
        if (!next) return;
        setFace(next); setSource(next.sourcePath ?? ''); editAxes(false); updateAxes(defaultAxisValues(next));
      }} />
      {sources.length > 0 && <FontChoiceRow sourceId={header.sourceId} label={t('inspector.source')} theme={theme}
        value={source} options={sources} onChange={setSource} />}
    </SettingsGroup>
    {adjustableAxes(face).length > 0 && <SettingsGroup theme={theme} backgroundColor={cardBackground} title={t('inspector.variableAxes')}>
      {adjustableAxes(face).map((axis) => <DetailSlider key={axis.tag} label={axis.name || axis.tag} theme={theme}
        value={axes[axis.tag] ?? axis.defaultValue} minimum={axis.minimum} maximum={axis.maximum} step={axisStep(axis.minimum, axis.maximum)}
        formatValue={formatAxisValue} onEditingChanged={editAxes} onChange={(value) => updateAxes({ ...latestAxes.current, [axis.tag]: value })} />)}
    </SettingsGroup>}
  </>;
  const failureContent = error ? <View style={settingsLayout.content}>
    <Text accessibilityRole="alert" style={{ color: theme.danger }}>{t(error)}</Text>
    <PanelAction label={t('common.retry')} theme={theme} onPress={() => setRetry((value) => value + 1)} />
    {face.location?.files.filter((file) => file.cloudAvailable && !file.localSources.length).map((file) => <PanelAction key={file.fingerprint} label={t('fontLocation.download')} theme={theme}
      onPress={() => { void onDownload(file.fingerprint).catch((cause) => setFailure({ key: selectionKey, message: characterMapError(cause) })); }} />)}
  </View> : null;
  return <SafeAreaView edges={['left', 'right']} style={[styles.screen, { backgroundColor: theme.background }]}>
    <GestureHandlerRootView style={styles.screen}>
      <CharacterMapContent selectionKey={selectionKey} session={active?.session ?? null} info={active?.info ?? null} axes={axes} committedAxes={committedAxes} axisDefaults={defaultAxisValues(face)} adjusting={adjusting} autoSelectFirstNonEmpty={ready && preferences.characterMapAutoSelectFirstNonEmpty} theme={theme}
        title={family.displayName} header={header} controls={controls} list={list} failureContent={failureContent} onClose={onClose}
        actions={<FontActionsMenu theme={theme} sourceId={header.sourceId} resetDisabled={!axesChanged}
          onReset={() => { editAxes(false); updateAxes(defaultAxisValues(face)); }} />} />
    </GestureHandlerRootView>
  </SafeAreaView>;
}

function CharacterMapContent({ selectionKey, session, info, axes, committedAxes, axisDefaults, adjusting, autoSelectFirstNonEmpty, theme, header, controls, list, failureContent, onClose, title, actions }: {
  committedAxes: Record<string, number>; axisDefaults: Record<string, number>; adjusting: boolean; autoSelectFirstNonEmpty: boolean;
  selectionKey: string; title: string; session: CharacterMapSession | null; info: CharacterMapInfo | null; axes: Record<string, number>; theme: Theme;
  header: ReturnType<typeof usePageHeader>; controls: ReactNode; list: RefObject<FlatList<CharacterEntry> | null>;
  failureContent: ReactNode; onClose: () => void; actions: ReactNode;
}) {
  const { t } = useTranslation();
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const { columns, cellWidth } = characterGridLayout(viewport.width);
  const [collapsedHeight, setCollapsedHeight] = useState(200);
  const [query, setQuery] = useState({ key: selectionKey, search: '', script: '', offset: 0, retry: 0 });
  const currentQuery = query.key === selectionKey ? query : { key: selectionKey, search: '', script: '', offset: 0, retry: 0 };
  if (query.key !== selectionKey) setQuery(currentQuery);
  const { search, script, offset, retry } = currentQuery;
  function updateQuery(patch: Partial<typeof query>) { setQuery({ ...currentQuery, ...patch }); }
  const [result, setResult] = useState<{ key: string; page: CharacterPage } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string; render?: boolean } | null>(null);
  const [selection, setSelection] = useState<{ key: string; entry: CharacterEntry } | null>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 24 });
  const queryKey = JSON.stringify([selectionKey, info?.handle, search, script]);
  const requestKey = JSON.stringify([queryKey, offset, retry]);
  const page = result?.key === queryKey ? result.page : null;
  const selected = page && selection?.key === queryKey ? selection.entry : null;
  const selectedRef = useRef<CharacterEntry | null>(null);
  useEffect(() => { selectedRef.current = null; }, [selectionKey]);
  const autoGeneration = useRef(0);
  const renderer = useMemo(() => session ? new CharacterPreviewRenderer(session) : null, [session]);
  useEffect(() => { renderer?.retain(); return () => renderer?.release(); }, [renderer]);
  useEffect(() => {
    autoGeneration.current += 1;
    renderer?.cancel('auto-select');
    return () => { autoGeneration.current += 1; renderer?.cancel('auto-select'); };
  }, [queryKey, renderer, autoSelectFirstNonEmpty]);
  const select = (entry: CharacterEntry) => {
    autoGeneration.current += 1;
    renderer?.cancel('auto-select');
    selectedRef.current = entry;
    setSelection({ key: queryKey, entry });
  };
  const foreground = useMemo(() => characterForeground(theme.label), [theme.label]);
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<CharacterEntry>[] }) => {
    const indices = viewableItems.map((item) => item.index ?? 0);
    if (indices.length) setVisibleRange({ start: Math.min(...indices), end: Math.max(...indices) + 1 });
  }, []);
  const initializeSelection = useEffectEvent((page: CharacterPage) => {
    const previous = selectedRef.current;
    if (previous && characterMatchesQuery(previous, search, script)) { setSelection({ key: queryKey, entry: previous }); return; }
    selectedRef.current = null;
    setSelection(null);
    const generation = ++autoGeneration.current;
    if (!autoSelectFirstNonEmpty || !session || !renderer) return;
    const current = () => generation === autoGeneration.current;
    void firstNonEmptyCharacter({ session, renderer, page, text: search, script, axes, foreground, current,
      onPage: (page) => setResult((previous) => previous?.key === queryKey && previous.page.entries.length > page.entries.length ? previous : { key: queryKey, page }),
    }).then((entry) => {
      if (current() && entry) { selectedRef.current = entry; setSelection({ key: queryKey, entry }); }
    }).catch((cause) => { if (current()) setFailure({ key: requestKey, message: characterMapError(cause) }); });
  });
  const applySelectionPreference = useEffectEvent(() => {
    if (autoSelectFirstNonEmpty && page && !selectedRef.current) initializeSelection(page);
  });
  useEffect(() => { applySelectionPreference(); }, [autoSelectFirstNonEmpty]);
  useEffect(() => {
    if (!session) return;
    let current = true;
    const timer = setTimeout(() => {
      session.query({ text: search, script: script || null, offset, limit: characterPageSize }).then((value) => {
        if (current) {
          setResult((previous) => ({ key: queryKey, page: mergeCharacterPage(previous?.key === queryKey ? previous.page : undefined, value, offset) }));
          if (offset === 0) { setVisibleRange({ start: 0, end: 24 }); initializeSelection(value); }
        }
      }).catch((cause) => { if (current) setFailure({ key: requestKey, message: characterMapError(cause) }); });
    }, 120);
    return () => { current = false; clearTimeout(timer); };
  }, [session, queryKey, requestKey, search, script, offset]);
  const visible = useMemo(() => page?.entries.slice(Math.max(0, visibleRange.start - columns), visibleRange.end + columns) ?? [], [page, visibleRange, columns]);
  const [images, setImages] = useState<{ renderer: CharacterPreviewRenderer; values: Map<number, CharacterGlyph> } | null>(null);
  const displayedAxes = useRef<Record<string, number> | null>(null);
  const defaults = useRef(axisDefaults);
  const [animatedImages, setAnimatedImages] = useState(false);
  useLayoutEffect(() => { defaults.current = axisDefaults; }, [axisDefaults]);
  useEffect(() => { displayedAxes.current = null; }, [renderer]);
  const renderRequest = useMemo(() => ({ glyphIds: [...new Set(visible.map((entry) => entry.glyphId))], axes: committedAxes, foreground, size: 128 }), [visible, committedAxes, foreground]);
  useEffect(() => {
    if (adjusting) { renderer?.cancel('grid'); return; }
    if (!renderer || !renderRequest.glyphIds.length) return;
    let current = true;
    const accept = (values: CharacterGlyph[], animated = false) => {
      if (!current || !values.length) return;
      setAnimatedImages(animated);
      setImages((previous) => {
        const next = new Map([...(previous?.renderer === renderer ? previous.values : [])].filter(([id]) => renderRequest.glyphIds.includes(id)));
        for (const image of values) {
          const previous = next.get(image.glyphId);
          next.delete(image.glyphId);
          next.set(image.glyphId, image.status === 'error' && previous?.dataUrl ? { ...image, dataUrl: previous.dataUrl } : image);
        }
        while (next.size > 512) next.delete(next.keys().next().value!);
        return { renderer, values: next };
      });
      const failed = values.find((image) => image.status === 'error');
      setFailure((previous) => failed ? { key: requestKey, message: failed.error ?? 'characterMap.error.renderFailed', render: true } : previous?.render && previous.key === requestKey ? null : previous);
    };
    void renderCharacterAxisTransition(renderer, renderRequest, { from: displayedAxes.current, defaults: defaults.current, reducedMotion: header.reduceMotion, current: () => current,
      onProgress: accept, onAxes: (axes) => { displayedAxes.current = axes; },
    }).catch((cause) => { if (current) setFailure({ key: requestKey, message: characterMapError(cause), render: true }); });
    return () => { current = false; renderer.cancel('grid'); };
  }, [renderer, renderRequest, requestKey, adjusting, header.reduceMotion]);
  const selectedPreview = useCharacterGlyph(renderer, selected, axes, foreground, 128, 'selected-cell', 3);
  const byGlyph = new Map(images?.renderer === renderer ? images.values : []);

  const error = failure?.key === requestKey ? failure.message : null;
  const loading = !page || page.entries.length === offset;
  const loadMore = () => {
    if (page && !loading && !error && page.entries.length < page.total) updateQuery({ offset: page.entries.length });
  };
  const listHeader = <View style={styles.listHeader}>
    {info && <View style={styles.filters}>
      <TextInput value={search} onChangeText={(value) => { updateQuery({ search: value, offset: 0 }); list.current?.scrollToOffset({ offset: 0, animated: false }); }} accessibilityLabel={t('characterMap.search')}
        placeholder={t('characterMap.search')} placeholderTextColor={theme.secondary} autoCapitalize="none" autoCorrect={false}
        style={[styles.search, settingsTypography.body, { color: theme.label, backgroundColor: theme.surface }]} />
      <FontChoiceRow sourceId={header.sourceId} label={t('filters.script')} theme={theme} value={script} triggerFeedback={false}
        options={[{ value: '', label: t('characterMap.allScripts') }, ...info.scripts.map((item) => ({ value: item.name, label: `${item.name} (${item.count})` }))]}
        onChange={(value) => { updateQuery({ script: value, offset: 0 }); list.current?.scrollToOffset({ offset: 0, animated: false }); }} />
      {error && <View><Text accessibilityRole="alert" style={{ color: theme.danger }}>{t(error)}</Text><PanelAction label={t('common.retry')} theme={theme} onPress={() => updateQuery({ retry: retry + 1 })} /></View>}
    </View>}
    {failureContent}
  </View>;
  return <NativeScrollContainer hasHeader onInsetsChange={header.onInsetsChange} style={styles.screen}>
    <PageHeader {...header} title={title} subtitle={info ? t('characterMap.count', { count: page?.total ?? info.count }) : t('common.loading')}
      fixed theme={theme} style={styles.header} leading={<IconButton theme={theme} label={t('common.back')} systemImage="chevron.left" onPress={onClose}>
        <CaretLeftIcon size={20} color={theme.label} />
      </IconButton>} actions={actions} />
    <View style={styles.screen} onLayout={({ nativeEvent: { layout } }) => {
      if (layout.width > 0 && layout.height > 0) setViewport(layout);
    }}>
    <NavigationBackdrop sourceId={header.sourceId} active theme={theme} style={styles.screen}>
      <Animated.FlatList ref={list} key={`${selectionKey}:${columns}`} style={styles.grid}
        ListHeaderComponent={listHeader} onScroll={header.onScroll} scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="never" automaticallyAdjustsScrollIndicatorInsets={false}
        scrollIndicatorInsets={{ top: header.contentTop, bottom: collapsedHeight + 16 }}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={{ paddingHorizontal: 12, paddingTop: header.contentTop, paddingBottom: collapsedHeight + 32 }} keyboardDismissMode="on-drag" data={page?.entries ?? []} numColumns={columns} keyExtractor={(entry) => String(entry.codepoint)}
        extraData={[byGlyph, selected, theme]} initialNumToRender={columns * 4} maxToRenderPerBatch={columns * 4} windowSize={3}
        onViewableItemsChanged={onViewableItemsChanged} keyboardShouldPersistTaps="handled"
        onEndReached={loadMore} onEndReachedThreshold={0.5}
        ListFooterComponent={page && loading && !error ? <ActivityIndicator color={theme.accent} /> : null}
        ListEmptyComponent={page ? <Text style={[settingsLayout.content, { color: theme.secondary }]}>{t('characterMap.empty')}</Text> : !error && !failureContent ? <ActivityIndicator color={theme.accent} /> : null}
        renderItem={({ item }) => {
          const image = selected?.codepoint === item.codepoint ? selectedPreview.image ?? byGlyph.get(item.glyphId) : byGlyph.get(item.glyphId);
          const isSelected = selected?.codepoint === item.codepoint;
          return <Pressable style={[styles.cell, { width: cellWidth, backgroundColor: theme.surface }]}
            accessibilityRole="button" accessibilityState={{ selected: isSelected }}
            accessibilityLabel={t('characterMap.characterLabel', { codepoint: codepointLabel(item.codepoint), glyphId: item.glyphId, script: item.script })}
            onPress={() => select(item)}>
            {isSelected && <Svg pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill} width="100%" height="100%">
              <Defs><LinearGradient id="characterSelection" x1="0%" y1="0%" x2="0%" y2="100%">
                <Stop offset={0.53125} stopColor={theme.accent} stopOpacity={0} />
                <Stop offset={1} stopColor={theme.accent} stopOpacity={0.4} />
              </LinearGradient></Defs>
              <Rect width="100%" height="100%" fill="url(#characterSelection)" />
            </Svg>}
            <CharacterGlyphImage dataUrl={image?.dataUrl} transition={animatedImages && !adjusting && !isSelected && !header.reduceMotion ? 75 : 0} style={styles.cellImage} identity={`${info?.handle}:${item.glyphId}`} />
            <Text style={[settingsTypography.detail, { color: theme.secondary }]}>{codepointLabel(item.codepoint)}</Text>
            {image?.status === 'error' && <Text style={{ color: theme.danger }}>{t('characterMap.error.renderFailed')}</Text>}
            {isSelected && <View pointerEvents="none" accessible={false} style={[styles.cellSelection, { borderColor: theme.accent }]} />}
          </Pressable>;
        }} />
    </NavigationBackdrop>
    <CharacterInspectorSheet theme={theme} sourceId={header.sourceId} topInset={header.contentTop} height={viewport.height}
      controls={controls} onCollapsedHeight={setCollapsedHeight} summary={renderer && selected ?
        <CharacterDetail key={`${info?.handle}:${selected.codepoint}`}
          renderer={renderer} entry={selected} axes={axes} foreground={foreground} theme={theme} /> :
        <View style={styles.emptyDetail}><Text style={[settingsTypography.detail, { color: theme.secondary }]}>
          {t(info || failureContent ? 'characterMap.selectCharacter' : 'common.loading')}
        </Text></View>} />
    </View>
  </NativeScrollContainer>;
}

// 同一字符允许执行中的中间轴值回显，较旧请求不能覆盖已完成的新结果。
function useCharacterGlyph(renderer: CharacterPreviewRenderer | null, entry: CharacterEntry | null, axes: Record<string, number>, foreground: [number, number, number, number], size: number, channel: string, priority: number) {
  const [result, setResult] = useState<{ renderer: CharacterPreviewRenderer; codepoint: number; image: CharacterGlyph } | null>(null);
  const [retry, setRetry] = useState(0);
  const mounted = useRef(false);
  const identity = useRef(entry?.codepoint);
  const sequence = useRef(0);
  const accepted = useRef(0);
  useLayoutEffect(() => {
    identity.current = entry?.codepoint;
    renderer?.cancel(channel);
  }, [renderer, channel, entry?.codepoint]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; renderer?.cancel(channel); };
  }, [renderer, channel]);
  const codepoint = entry?.codepoint;
  const glyphId = entry?.glyphId;
  useEffect(() => {
    if (!renderer || codepoint == null || glyphId == null) return;
    const request = ++sequence.current;
    const accept = (value: CharacterGlyph | undefined) => {
      if (!value || !mounted.current || identity.current !== codepoint || request < accepted.current) return;
      accepted.current = request;
      setResult((previous) => ({ renderer, codepoint, image: value.status === 'error' && previous?.renderer === renderer && previous.codepoint === codepoint && previous.image.dataUrl ? { ...value, dataUrl: previous.image.dataUrl } : value }));
    };
    renderer.render({ glyphIds: [glyphId], axes, foreground, size }, { channel, priority }).then((values) => accept(values[0]))
      .catch((cause) => accept({ glyphId, status: 'error', dataUrl: null, error: characterMapError(cause) }));
  }, [renderer, channel, priority, glyphId, codepoint, axes, foreground, size, retry]);
  return { image: result?.renderer === renderer && result?.codepoint === codepoint ? result?.image ?? null : null, attempt: retry, retry: () => setRetry((value) => value + 1),
    onDecodeError: () => setResult((previous) => previous ? { ...previous, image: { ...previous.image, status: 'error', error: 'characterMap.error.renderFailed' } } : previous) };
}

function CharacterDetail({ renderer, entry, axes, foreground, theme }: {
  renderer: CharacterPreviewRenderer; entry: CharacterEntry; axes: Record<string, number>; foreground: [number, number, number, number]; theme: Theme;
}) {
  const { t } = useTranslation();
  const { image, retry, attempt, onDecodeError } = useCharacterGlyph(renderer, entry, axes, foreground, 512, 'detail', 3);
  const [status, setStatus] = useState('');
  return <View style={styles.detail}>
    <View style={styles.detailRow}>
      <View style={styles.phoneImage}
        accessible={image?.status === 'empty'} accessibilityLabel={image?.status === 'empty' ? t('characterMap.blankGlyph') : undefined}>
        {image?.status === 'empty' ? <View style={[styles.emptyGlyph, { borderColor: theme.secondary }]} />
          : image?.dataUrl && <CharacterGlyphImage dataUrl={image.dataUrl} identity={String(entry.glyphId)} attempt={attempt} onError={onDecodeError} style={styles.image} accessibilityLabel={codepointLabel(entry.codepoint)} />}
        {image?.status === 'error' && <View><Text accessibilityRole="alert" style={{ color: theme.danger }}>{t(image.error ?? 'characterMap.error.renderFailed')}</Text><PanelAction label={t('common.retry')} theme={theme} onPress={retry} /></View>}
        {!image && <ActivityIndicator color={theme.accent} />}
      </View>
      <View style={styles.detailMeta}>
        <Text style={[styles.codepoint, { color: theme.label }]}>{codepointLabel(entry.codepoint)}</Text>
        <Text style={[settingsTypography.detail, { color: theme.secondary }]}>{entry.script}</Text>
        <Text style={[settingsTypography.detail, { color: theme.secondary }]}>{t('characterMap.glyphId')}: {entry.glyphId}</Text>
      </View>
    </View>
    <View style={styles.pager}>
      <View style={styles.screen}><CopyButton label={t('characterMap.copyCharacter')} value={characterText(entry)} theme={theme} disabled={!canCopyCharacter(entry.codepoint)}
        onSuccess={() => setStatus('')} onError={() => setStatus(t('characterMap.error.copyFailed'))} /></View>
      <View style={styles.screen}><CopyButton label={t('characterMap.copyCodepoint')} value={codepointLabel(entry.codepoint)} theme={theme}
        onSuccess={() => setStatus('')} onError={() => setStatus(t('characterMap.error.copyFailed'))} /></View>
    </View>
    {!!status && <Text accessibilityLiveRegion="polite" style={[settingsTypography.detail, { color: theme.secondary }]}>{status}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { paddingHorizontal: 16 },
  grid: { flex: 1 }, gridRow: { gap: 8, marginBottom: 8 }, listHeader: { paddingBottom: 16 },
  filters: { gap: 8 },
  cell: { ...settingsLayout.control, height: 96, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cellSelection: { ...StyleSheet.absoluteFill, ...settingsLayout.control, borderWidth: 3 },
  cellImage: { width: 64, height: 64 },
  detail: { paddingHorizontal: 8, gap: 8 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 16 }, detailMeta: { flex: 1, minWidth: 0, gap: 4 },
  codepoint: { ...settingsTypography.body, fontVariant: ['tabular-nums'] },
  phoneImage: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }, image: { width: '100%', height: '100%' },
  emptyGlyph: { width: 82, height: 82, borderWidth: 1, borderStyle: 'dashed', borderRadius: settingsLayout.control.borderRadius },
  emptyDetail: { minHeight: 96, padding: 16, alignItems: 'center', justifyContent: 'center' },
  pager: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  search: { ...settingsLayout.control, minHeight: 44, paddingHorizontal: 16, paddingVertical: 12 },
});
