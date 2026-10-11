import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type ViewToken } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { CharacterMapSession, characterForeground, characterMapError, characterPageSize, characterText, codepointLabel,
  type CharacterEntry, type CharacterGlyph, type CharacterMapInfo, type CharacterPage } from '../../../shared/character-map';
import type { FontFace, FontFamily } from './library';
import { characterMap, copyText } from './native';
import { PanelAction, PanelHeader } from './panel-content';
import { DetailSlider } from './DetailSlider';
import { adjustableAxes, axisStep, defaultAxisValues, formatAxisValue } from './font-details';
import { settingsLayout, settingsTypography } from './settings-ui';
import type { Theme } from './ui';

export function CharacterMap({ family, initialFace, initialAxes, theme, onClose, onDownload }: {
  family: FontFamily; initialFace: FontFace; initialAxes: Record<string, number>; theme: Theme;
  onClose: () => void; onDownload: (fingerprint: string) => Promise<void>;
}) {
  const { t } = useTranslation();
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
  useEffect(() => {
    let current = true;
    const session = new CharacterMapSession(characterMap);
    const opening = !source && face.location?.cloudAvailable ? Promise.reject(new Error('characterMap.error.notDownloaded')) : session.open({ faceId: face.id, revisionId: face.revisionId, sourcePath: source });
    opening.then((info) => {
      if (current && info) setLoaded({ key: selectionKey, session, info });
    }).catch((cause) => { if (current) setFailure({ key: selectionKey, message: characterMapError(cause) }); });
    return () => { current = false; session.close(); };
  }, [selectionKey, face.id, face.revisionId, source, face.location?.cloudAvailable]);
  const active = loaded?.key === selectionKey ? loaded : null;
  const error = failure?.key === selectionKey ? failure.message : null;
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={[styles.screen, { backgroundColor: theme.background }]}>
    <PanelHeader title={t('characterMap.title')} theme={theme} onClose={onClose} backButton closeLabel={t('common.back')} />
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.controls} contentContainerStyle={settingsLayout.content} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={[settingsTypography.title, { color: theme.label }]}>{family.displayName}</Text>
        <ChoiceRow label={t('font.styles')} theme={theme} value={face.id} options={family.faces.map((item) => ({ value: item.id, label: item.styleName }))} onChange={(id) => {
          const next = family.faces.find((item) => item.id === id)!;
          setFace(next); setSource(next.sourcePath ?? ''); setAxes(defaultAxisValues(next));
        }} />
        {sources.length > 0 && <ChoiceRow label={t('inspector.source')} theme={theme} value={source} options={sources.map((path) => ({ value: path, label: path }))} onChange={setSource} />}
        {adjustableAxes(face).map((axis) => <DetailSlider key={axis.tag} label={axis.name || axis.tag} theme={theme}
          value={axes[axis.tag] ?? axis.defaultValue} minimum={axis.minimum} maximum={axis.maximum} step={axisStep(axis.minimum, axis.maximum)}
          formatValue={formatAxisValue} onChange={(value) => setAxes((values) => ({ ...values, [axis.tag]: value }))} />)}
      </ScrollView>
      {error ? <View style={settingsLayout.content}>
        <Text accessibilityRole="alert" style={{ color: theme.danger }}>{t(error)}</Text>
        <PanelAction label={t('common.retry')} theme={theme} onPress={() => setRetry((value) => value + 1)} />
        {face.location?.files.filter((file) => file.cloudAvailable && !file.localSources.length).map((file) => <PanelAction key={file.fingerprint} label={t('fontLocation.download')} theme={theme}
          onPress={() => { void onDownload(file.fingerprint).catch((cause) => setFailure({ key: selectionKey, message: characterMapError(cause) })); }} />)}
      </View> : active ? <CharacterMapContent key={active.info.handle} session={active.session} info={active.info} axes={axes} theme={theme} /> : <ActivityIndicator color={theme.accent} accessibilityLabel={t('common.loading')} />}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function CharacterMapContent({ session, info, axes, theme }: { session: CharacterMapSession; info: CharacterMapInfo; axes: Record<string, number>; theme: Theme }) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const wide = width >= 768;
  const gridWidth = wide ? width * 0.65 : width;
  const columns = Math.max(2, Math.floor(gridWidth / 80));
  const [search, setSearch] = useState('');
  const [script, setScript] = useState('');
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; page: CharacterPage } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [selected, setSelected] = useState<CharacterEntry | null>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 24 });
  const queryKey = JSON.stringify([search, script, offset, retry]);
  const page = result?.key === queryKey ? result.page : null;
  const foreground = useMemo(() => characterForeground(theme.label), [theme.label]);
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<CharacterEntry>[] }) => {
    const indices = viewableItems.map((item) => item.index ?? 0);
    if (indices.length) setVisibleRange({ start: Math.min(...indices), end: Math.max(...indices) + 1 });
  }, []);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      session.query({ text: search, script: script || null, offset, limit: characterPageSize }).then((value) => {
        if (current) { setResult({ key: queryKey, page: value }); setSelected(value.entries[0] ?? null); setVisibleRange({ start: 0, end: 24 }); }
      }).catch((cause) => { if (current) setFailure({ key: queryKey, message: characterMapError(cause) }); });
    }, 120);
    return () => { current = false; clearTimeout(timer); };
  }, [session, queryKey, search, script, offset]);
  const visible = useMemo(() => page?.entries.slice(Math.max(0, visibleRange.start - columns), visibleRange.end + columns) ?? [], [page, visibleRange, columns]);
  const renderKey = JSON.stringify([queryKey, axes, foreground, visible.map((entry) => entry.glyphId)]);
  const [images, setImages] = useState<{ key: string; values: CharacterGlyph[] } | null>(null);
  useEffect(() => {
    let current = true;
    const glyphIds = [...new Set(visible.map((entry) => entry.glyphId))];
    if (!glyphIds.length) return;
    session.render({ glyphIds, axes, foreground, size: 128 }).then((values) => { if (current) setImages({ key: renderKey, values }); })
      .catch((cause) => { if (current) setFailure({ key: queryKey, message: characterMapError(cause) }); });
    return () => { current = false; };
  }, [session, renderKey, queryKey, visible, axes, foreground]);
  const byGlyph = useMemo(() => new Map((images?.key === renderKey ? images.values : []).map((image) => [image.glyphId, image])), [images, renderKey]);
  const error = failure?.key === queryKey ? failure.message : null;
  return <View style={styles.screen}>
    <View style={settingsLayout.content}>
      <TextInput value={search} onChangeText={(value) => { setSearch(value); setOffset(0); }} accessibilityLabel={t('characterMap.search')}
        placeholder={t('characterMap.search')} placeholderTextColor={theme.secondary} autoCapitalize="none" autoCorrect={false}
        style={[styles.search, settingsTypography.body, { color: theme.label, backgroundColor: theme.surface, borderColor: theme.border }]} />
      <ChoiceRow label={t('filters.script')} theme={theme} value={script} options={[{ value: '', label: t('characterMap.allScripts') }, ...info.scripts.map((item) => ({ value: item.name, label: `${item.name} (${item.count})` }))]}
        onChange={(value) => { setScript(value); setOffset(0); }} />
      <Text style={[settingsTypography.detail, { color: theme.secondary }]}>{t('characterMap.count', { count: page?.total ?? info.count })}</Text>
      {error && <View><Text accessibilityRole="alert" style={{ color: theme.danger }}>{t(error)}</Text><PanelAction label={t('common.retry')} theme={theme} onPress={() => setRetry((value) => value + 1)} /></View>}
    </View>
    <View style={[styles.screen, wide && styles.wide]}>
      <FlatList key={`${columns}:${queryKey}`} style={styles.grid} data={page?.entries ?? []} numColumns={columns} keyExtractor={(entry) => String(entry.codepoint)}
        extraData={[byGlyph, selected, theme]} initialNumToRender={columns * 4} maxToRenderPerBatch={columns * 4} windowSize={3}
        onViewableItemsChanged={onViewableItemsChanged} keyboardShouldPersistTaps="handled"
        getItemLayout={(_, index) => ({ length: 96, offset: Math.floor(index / columns) * 96, index })}
        ListEmptyComponent={page ? <Text style={[settingsLayout.content, { color: theme.secondary }]}>{t('characterMap.empty')}</Text> : !error ? <ActivityIndicator color={theme.accent} /> : null}
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
      {selected && page && <CharacterDetail key={`${selected.codepoint}:${JSON.stringify(axes)}:${foreground}`} session={session} entry={selected} axes={axes} foreground={foreground} theme={theme} wide={wide} maxHeight={height * (wide ? 0.7 : 0.3)} />}
    </View>
    <View style={[settingsLayout.content, styles.pager]}>
      <PanelAction label={t('characterMap.previousPage')} theme={theme} disabled={offset === 0} onPress={() => setOffset(Math.max(0, offset - characterPageSize))} />
      <Text style={{ color: theme.secondary }}>{t('characterMap.page', { page: Math.floor(offset / characterPageSize) + 1, pages: Math.max(1, Math.ceil((page?.total ?? 0) / characterPageSize)) })}</Text>
      <PanelAction label={t('characterMap.nextPage')} theme={theme} disabled={!page || offset + characterPageSize >= page.total} onPress={() => setOffset(offset + characterPageSize)} />
    </View>
  </View>;
}

function CharacterDetail({ session, entry, axes, foreground, theme, wide, maxHeight }: {
  session: CharacterMapSession; entry: CharacterEntry; axes: Record<string, number>; foreground: [number, number, number, number]; theme: Theme; wide: boolean; maxHeight: number;
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
  return <ScrollView style={[wide && styles.detailWide, { maxHeight }]} contentContainerStyle={[settingsLayout.content, !wide && styles.detailRow]}>
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

function ChoiceRow({ label, options, value, onChange, theme }: { label: string; options: { value: string; label: string }[]; value: string; onChange: (value: string) => void; theme: Theme }) {
  return <View>
    <Text style={[settingsTypography.detail, { color: theme.secondary }]}>{label}</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.choices}>
      {options.map((option) => <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected: value === option.value }} onPress={() => onChange(option.value)}
        style={[styles.choice, { backgroundColor: value === option.value ? theme.raised : theme.surface }]}>
        <Text style={[settingsTypography.body, { color: theme.label }]}>{option.label}</Text>
      </Pressable>)}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, controls: { maxHeight: '24%', flexGrow: 0 }, wide: { flexDirection: 'row' },
  grid: { flex: 1 }, cell: { flex: 1, height: 96, alignItems: 'center', justifyContent: 'center' }, cellImage: { width: 64, height: 64 },
  detailWide: { width: '35%' }, detailRow: { flexDirection: 'row', alignItems: 'center' },
  phoneImage: { width: 112, height: 112 }, largeImage: { width: '100%', aspectRatio: 1 }, image: { width: '100%', height: '100%' },
  pager: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  search: { minHeight: 44, paddingHorizontal: 16, borderWidth: StyleSheet.hairlineWidth },
  choices: { gap: 8, paddingVertical: 8 }, choice: { paddingHorizontal: 16, paddingVertical: 8 },
});
