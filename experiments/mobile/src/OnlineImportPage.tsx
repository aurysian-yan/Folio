import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator } from './UiActivityIndicator';
import { Animated, Pressable, StyleSheet, Text, View, type ScrollView } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaretLeftIcon, CheckIcon } from './icons';
import { NativeFontPreview, online } from './native';
import { NativeScrollContainer } from './native-controls';
import { NavigationBackdrop } from './bottom-navigation';
import { PageHeader, PageTitle, usePageHeader } from './PageHeader';
import { PanelAction, PanelSection } from './panel-content';
import { formatBytes, settingsLayout } from './settings-ui';
import { IconButton, type Theme } from './ui';
import { onlineErrorKey, type OnlineEntry } from './online';
import { importFamilies, importSelection, isVariableEntry, type ImportSelection } from './online-import';
import { useOnlineSession } from './OnlineSession';
import type { LibrarySnapshot } from './library';

export function OnlineImportPage(props: { jobId: string; theme: Theme; onClose: () => void; onSnapshotChange: (snapshot: LibrarySnapshot) => void }) {
  return <SafeAreaProvider><ImportContent {...props} /></SafeAreaProvider>;
}

// 收录使用独立导航页面，分组与预览折叠后释放原生预览视图。
function ImportContent({ jobId, theme, onClose, onSnapshotChange }: Parameters<typeof OnlineImportPage>[0]) {
  const { t } = useTranslation();
  const inset = useSafeAreaInsets();
  const { state, invalidate } = useOnlineSession();
  const scroll = useRef<ScrollView>(null);
  const header = usePageHeader({ bottomTabs: false, onSnap: (offset, animated) => scroll.current?.scrollTo({ y: offset, animated }) });
  const [entries, setEntries] = useState<OnlineEntry[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef(false);
  const alive = useRef(true);
  const request = useRef(0);
  const load = useCallback(() => {
    const id = ++request.current;
    return online.inspect(jobId).then((values) => {
      if (!alive.current || id !== request.current) return;
      setEntries(values); setSelected(importSelection(values, 'variable'));
      setLoading(false);
    }).catch((cause) => {
      if (!alive.current || id !== request.current) return;
      setError(onlineErrorKey(cause)); setLoading(false);
    });
  }, [jobId]);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; request.current += 1; };
  }, [load]);
  const families = useMemo(() => importFamilies(entries), [entries]);
  const chosen = useMemo(() => new Set(selected), [selected]);
  const title = t('online.browser.review');
  const job = state?.jobs.find((item) => item.id === jobId);
  const presets: { kind: ImportSelection; label: string }[] = [
    { kind: 'variable', label: t('font.variable') }, { kind: 'static', label: t('font.static') },
    { kind: 'all', label: t('desktop.selectAll') }, { kind: 'none', label: t('online.browser.selectNone') },
  ];
  function toggle(ids: string[]) {
    setSelected((values) => ids.every((id) => values.includes(id)) ? values.filter((id) => !ids.includes(id)) : [...new Set([...values, ...ids])]);
  }
  async function collect() {
    if (operation.current || !selected.length) return;
    operation.current = true; setBusy(true); setError(null);
    try {
      const result = await online.collect(jobId, selected);
      onSnapshotChange(result.snapshot);
      if (result.items.some((item) => item.status === 'failed' || item.status === 'unprocessed')) {
        const values = await online.inspect(jobId);
        if (alive.current) {
          setEntries(values); setSelected((ids) => ids.filter((id) => values.some((entry) => entry.id === id && entry.eligible && !entry.duplicate)));
          setError('online.browser.importError');
        }
      } else if (alive.current) onClose();
      await invalidate();
    } catch (cause) { if (alive.current) setError(onlineErrorKey(cause)); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  return <SafeAreaView edges={['left', 'right']} style={[styles.screen, { backgroundColor: theme.background }]}>
    <NativeScrollContainer hasHeader accessibilityViewIsModal onInsetsChange={header.onInsetsChange} style={styles.screen}>
      <PageHeader {...header} title={title} theme={theme} style={styles.toolbar} leading={
        <IconButton theme={theme} label={t('common.back')} systemImage="chevron.left" disabled={busy} onPress={onClose}>
          <CaretLeftIcon size={20} color={theme.label} />
        </IconButton>
      } />
      <NavigationBackdrop sourceId={header.sourceId} active theme={theme} style={styles.screen}>
        <Animated.ScrollView ref={scroll} {...header.snapScrollProps} onScroll={header.onScroll} scrollEventThrottle={16}
          contentInsetAdjustmentBehavior="never" automaticallyAdjustsScrollIndicatorInsets={false}
          scrollIndicatorInsets={{ top: header.contentTop, bottom: header.contentBottom + 64 }}
          contentContainerStyle={[settingsLayout.content, { paddingTop: header.contentTop, paddingBottom: header.contentBottom + 80 }]}>
          <PageTitle {...header} title={title} theme={theme} style={settingsLayout.pageTitle} />
          {!!job?.name && <Text style={{ color: theme.label }}>{job.name}</Text>}
          <Text style={{ color: theme.secondary }}>{t('online.browser.importNotice')}</Text>
          {error && <Text accessibilityRole="alert" style={{ color: theme.danger }}>{t(error)}</Text>}
          {loading ? <ActivityIndicator accessibilityLabel={t('common.loading')} color={theme.accent} /> : <>
            <View style={styles.options}>{presets.map(({ kind, label }) => {
              const ids = importSelection(entries, kind);
              const checked = (ids.length > 0 || kind === 'none') && ids.length === selected.length && ids.every((id) => chosen.has(id));
              return <Pressable key={kind} accessibilityRole="button" accessibilityState={{ selected: checked, disabled: busy }} disabled={busy || !entries.length}
                onPress={() => setSelected(ids)} style={[styles.chip, { backgroundColor: checked ? theme.accent : theme.raised }]}>
                {checked && <CheckIcon size={16} color={theme.onAccent} />}
                <Text style={[styles.chipLabel, { color: checked ? theme.onAccent : theme.label }]}>{label}</Text>
              </Pressable>;
            })}</View>
            {!entries.length && (error ? <PanelAction theme={theme} label={t('common.retry')} onPress={() => { setLoading(true); setError(null); void load(); }} />
              : <Text style={{ color: theme.secondary }}>{t('online.browser.noFonts')}</Text>)}
            {families.map((family) => <PanelSection key={family.id} title={family.name} theme={theme} action={
              <ImportCheckbox theme={theme} label={t('desktop.selectFamily', { name: family.name })} disabled={busy || !family.entries.some((entry) => entry.eligible && !entry.duplicate)}
                checked={importSelection(family.entries, 'all').length > 0 && importSelection(family.entries, 'all').every((id) => chosen.has(id))}
                mixed={family.entries.some((entry) => chosen.has(entry.id))}
                onPress={() => toggle(importSelection(family.entries, 'all'))} />
            }>
              {(['variable', 'static'] as const).map((kind) => {
                const values = family.entries.filter((entry) => isVariableEntry(entry) === (kind === 'variable'));
                return values.length > 0 && <PanelSection key={kind} title={`${t(`font.${kind}`)} · ${values.length}`} theme={theme} initiallyExpanded={kind === 'variable'} action={
                  <ImportCheckbox theme={theme} label={t(`font.${kind}`)} disabled={busy || !values.some((entry) => entry.eligible && !entry.duplicate)}
                    checked={importSelection(values, 'all').length > 0 && importSelection(values, 'all').every((id) => chosen.has(id))}
                    mixed={values.some((entry) => chosen.has(entry.id))} onPress={() => toggle(importSelection(values, 'all'))} />
                }>{values.map((entry) => <ImportEntry key={entry.id} entry={entry} theme={theme} busy={busy} checked={chosen.has(entry.id)} onToggle={() => toggle([entry.id])} />)}</PanelSection>;
              })}
            </PanelSection>)}
          </>}
        </Animated.ScrollView>
      </NavigationBackdrop>
      <View pointerEvents="box-none" style={[styles.floating, { bottom: inset.bottom + 16 }]}>
        <PanelAction primary systemImage="plus" theme={theme} label={t('online.browser.collect', { count: selected.length })}
          disabled={loading || busy || !selected.length} onPress={() => void collect()} />
        {busy && <ActivityIndicator accessibilityLabel={t('common.loading')} color={theme.accent} />}
      </View>
    </NativeScrollContainer>
  </SafeAreaView>;
}

function ImportCheckbox({ theme, label, checked, mixed = false, disabled, onPress }: {
  theme: Theme; label: string; checked: boolean; mixed?: boolean; disabled: boolean; onPress: () => void;
}) {
  const partial = !checked && mixed;
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: partial ? 'mixed' : checked, disabled }}
    disabled={disabled} onPress={onPress} style={[styles.checkboxTarget, { opacity: disabled ? 0.4 : 1 }]}>
    <View style={[styles.checkbox, { borderColor: checked || partial ? theme.accent : theme.secondary, backgroundColor: checked || partial ? theme.accent : 'transparent' }]}>
      {checked ? <CheckIcon size={16} color={theme.onAccent} /> : partial ? <View style={[styles.partial, { backgroundColor: theme.onAccent }]} /> : null}
    </View>
  </Pressable>;
}

function ImportEntry({ entry, theme, checked, busy, onToggle }: { entry: OnlineEntry; theme: Theme; checked: boolean; busy: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState(false);
  const face = entry.analysis?.faces[0];
  const fileName = entry.name.split('/').at(-1) ?? entry.name;
  return <View style={[styles.entry, { borderColor: theme.border }]}>
    <View style={styles.row}>
      <ImportCheckbox theme={theme} label={fileName} checked={checked} disabled={busy || !entry.eligible || entry.duplicate} onPress={onToggle} />
      <Pressable accessibilityRole="checkbox" accessibilityLabel={fileName} accessibilityState={{ checked, disabled: busy || !entry.eligible || entry.duplicate }}
        disabled={busy || !entry.eligible || entry.duplicate} onPress={onToggle} style={styles.entryBody}>
        <Text style={[styles.name, { color: theme.label }]}>{fileName}</Text>
        <Text style={{ color: theme.secondary }}>{formatBytes(entry.size)} · {t(!entry.eligible ? 'online.browser.invalidFont' : entry.duplicate ? 'online.browser.duplicate' : 'online.browser.available')}</Text>
        {entry.analysis?.faces.map((item, index) => <Text key={index} style={{ color: theme.secondary }}>{item.style || t('font.regular')}{item.conflict ? ` · ${t('online.browser.conflict')}` : ''}</Text>)}
      </Pressable>
      {entry.eligible && entry.previewPath && <Pressable accessibilityRole="button" accessibilityLabel={`${t('common.preview')} ${fileName}`} accessibilityState={{ expanded: preview }}
        disabled={busy} onPress={() => setPreview(!preview)} style={[styles.chip, { backgroundColor: theme.raised }]}>
        <Text style={[styles.chipLabel, { color: theme.accent }]}>{t(preview ? 'common.collapse' : 'common.preview')}</Text>
      </Pressable>}
    </View>
    {preview && entry.previewPath && face && <NativeFontPreview style={styles.preview} accessibilityLabel={t('common.preview')}
      selection={{ sourcePath: entry.previewPath, faceIndex: face.faceIndex, revisionId: entry.analysis!.fingerprint,
        axes: {}, text: face.family || fileName, fontSize: 28, foregroundColor: theme.label }} onStatus={() => {}} />}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, toolbar: { paddingHorizontal: 16, minHeight: 68 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 40, maxWidth: '100%', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  chipLabel: { fontSize: 14, lineHeight: 20, fontWeight: '500', flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  entry: { paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 12 }, entryBody: { flex: 1, minWidth: 0, gap: 4 },
  name: { fontSize: 16, fontWeight: '600' }, checkboxTarget: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  checkbox: { width: 22, height: 22, borderWidth: 2, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  partial: { width: 12, height: 2 }, preview: { height: 120 },
  floating: { position: 'absolute', right: 16, left: 16, alignItems: 'flex-end', gap: 8 },
});
