import { useCallback, useEffect, useRef, useState } from 'react';
import { getDocumentAsync } from 'expo-document-picker';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CaretRightIcon } from './icons';
import { LibraryPanel } from './LibraryPanel';
import { online } from './native';
import { onlineErrorKey, providerCustomCss, providerThemeEnabled, type OnlineProvider, type OnlineState } from './online';
import { OnlineSourceIcon } from './OnlineSourceIcon';
import { PanelAction } from './panel-content';
import { usePreferences } from './settings';
import { SettingsActionRow, SettingsGroup, SettingsNote, SettingsPage, SettingsSwitchRow, settingsLayout, settingsTypography } from './settings-ui';
import { GlassSwitch } from './GlassSwitch';
import type { Theme } from './ui';

// 来源管理、网站数据与站内配色统一放在通用设置。
export function SettingsOnlinePage({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const { t } = useTranslation();
  const { preferences, update } = usePreferences();
  const [state, setState] = useState<OnlineState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<OnlineProvider | null>(null);
  const [draftTheme, setDraftTheme] = useState(false);
  const [draftCss, setDraftCss] = useState('');
  const mounted = useRef(true);
  const operation = useRef(false);
  const refresh = useCallback(async () => {
    const value = await online.state();
    if (mounted.current) setState(value);
    return value;
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((cause) => { if (mounted.current) setError(onlineErrorKey(cause)); });
    return () => { mounted.current = false; };
  }, [refresh]);

  async function run(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(null); setNotice(null);
    try { await action(); } catch (cause) { if (mounted.current) setError(onlineErrorKey(cause)); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  function openEditor(item: OnlineProvider) {
    setDraft({ ...item });
    setDraftTheme(providerThemeEnabled(preferences.onlineTheme[item.id], item.id));
    setDraftCss(providerCustomCss(preferences.onlineCss[item.id], item.id));
    setError(null);
    setNotice(null);
  }
  function updateTheme(id: string, enabled: boolean) {
    update({ onlineTheme: { ...preferences.onlineTheme, [id]: enabled } });
  }
  function updateCss(id: string, css: string) {
    const next = { ...preferences.onlineCss };
    next[id] = css;
    update({ onlineCss: next });
  }
  async function save(values: OnlineProvider[]) {
    await online.saveProviders(values);
    await refresh();
  }
  function saveDraft() {
    if (!state || !draft) return;
    void run(async () => {
      const values = state.providers.some((item) => item.id === draft.id)
        ? state.providers.map((item) => item.id === draft.id ? draft : item)
        : [...state.providers, draft];
      await save(values);
      updateTheme(draft.id, draftTheme);
      updateCss(draft.id, draftCss);
      setDraft(null);
      setNotice(t('online.browser.sourceSaved'));
    });
  }
  async function chooseIcon() {
    if (!draft) return;
    await run(async () => {
      const result = await getDocumentAsync({ type: ['image/png', 'image/jpeg', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon'], copyToCacheDirectory: true, multiple: false });
      if (result.canceled) return;
      const file = result.assets[0];
      if (!file || (file.size ?? 0) > 8 * 1024 * 1024) throw new Error('online.browser.invalidIcon');
      const icon = await online.importIcon(file.uri);
      setDraft((value) => value ? { ...value, icon: { kind: 'custom', assetId: icon.assetId }, iconUri: icon.uri } : value);
    });
  }
  async function move(index: number, delta: number) {
    if (!state) return;
    const target = index + delta;
    if (target < 0 || target >= state.providers.length) return;
    await run(async () => {
      const values = [...state.providers];
      [values[index], values[target]] = [values[target]!, values[index]!];
      await save(values);
    });
  }
  const errorNode = error && <Text accessibilityRole="alert" style={{ color: theme.danger }}>{t(error)}</Text>;
  const inputStyle = [styles.input, { color: theme.label, backgroundColor: theme.raised, borderColor: theme.border }];

  return <SettingsPage title={t('settings.onlineFonts')} theme={theme} onClose={onClose}>
    <SettingsGroup theme={theme} title={t('online.browser.sources')}>
      {state?.providers.map((item, index) => {
        const fallback = providerThemeEnabled(undefined, item.id);
        return <View key={item.id} style={[styles.sourceRow, { borderBottomColor: theme.border }]}>
          <View style={styles.sourceHeader}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${t('common.edit')} ${item.name}`}
              onPress={() => openEditor(item)} style={({ pressed }) => [styles.sourceMain, { opacity: pressed ? 0.7 : 1 }]}>
              <OnlineSourceIcon provider={item} theme={theme} size={30} />
              <View style={styles.sourceText}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.label }]}>{item.name}</Text>
                <Text numberOfLines={1} style={[styles.rowDetail, { color: theme.secondary }]}>{item.homepage}</Text>
              </View>
              <CaretRightIcon size={16} color={theme.secondary} />
            </Pressable>
            <GlassSwitch label={item.name} value={item.enabled} disabled={busy} theme={theme}
              onChange={(enabled) => void run(async () => {
                await save(state.providers.map((value) => value.id === item.id ? { ...value, enabled } : value));
              })} />
          </View>
          <View style={styles.actions}>
            <PanelAction label={t('online.browser.moveUp')} theme={theme} disabled={busy || index === 0}
              onPress={() => void move(index, -1)} />
            <PanelAction label={t('online.browser.moveDown')} theme={theme} disabled={busy || index === state.providers.length - 1}
              onPress={() => void move(index, 1)} />
            <Text style={[styles.defaultNote, { color: theme.secondary }]}>
              {t(providerThemeEnabled(preferences.onlineTheme[item.id], item.id) ? 'online.browser.themeOn' : 'online.browser.themeOff')}
              {fallback ? ` · ${t('online.browser.themeDefault')}` : ''}
            </Text>
          </View>
        </View>;
      })}
      {!state && <View style={styles.loading}><ActivityIndicator color={theme.accent} /></View>}
      <SettingsActionRow theme={theme} title={t('online.browser.addSource')} disabled={busy || !state?.accepted}
        onPress={() => setDraft({
          id: `custom-${Date.now()}`, name: '', homepage: '', searchTemplate: 'https://example.com/?q={{query}}',
          enabled: true, builtin: false,
        })} />
    </SettingsGroup>
    {errorNode}
    {notice && <SettingsNote theme={theme}>{notice}</SettingsNote>}
    <SettingsGroup theme={theme} title={t('online.browser.themeGroup')} footer={t('online.browser.themeFooter')}>
      <SettingsNote theme={theme}>{t('online.browser.themeHelp')}</SettingsNote>
    </SettingsGroup>
    <SettingsGroup theme={theme} footer={t('online.browser.regionHintsFooter')}>
      <SettingsSwitchRow title={t('online.browser.regionHints')} detail={t('online.browser.regionHintsDetail')}
        value={preferences.onlineRegionHints} theme={theme}
        onChange={(onlineRegionHints) => update({ onlineRegionHints })} />
    </SettingsGroup>
    <SettingsGroup theme={theme} title={t('online.browser.websiteData')}>
      <SettingsActionRow destructive theme={theme} title={t('online.browser.clearData')} disabled={busy}
        onPress={() => Alert.alert(t('online.browser.clearData'), t('online.browser.clearDataNotice'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('common.delete'), style: 'destructive', onPress: () => void run(async () => {
            await online.clearData(); setNotice(t('online.browser.dataCleared'));
          }) },
        ])} />
    </SettingsGroup>
    <LibraryPanel visible={draft !== null} title={t('online.browser.editSource')} theme={theme} busy={busy}
      onClose={() => { if (!busy) setDraft(null); }}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {draft && <>
          {errorNode}
          {notice && <Text style={{ color: theme.secondary }}>{notice}</Text>}
          <View style={styles.iconRow}>
            <OnlineSourceIcon provider={draft} theme={theme} size={40} />
            <PanelAction label={t('online.browser.chooseIcon')} theme={theme} disabled={busy} onPress={() => void chooseIcon()} />
            <PanelAction label={t('online.browser.automaticIcon')} theme={theme} disabled={busy || !draft.icon}
              onPress={() => setDraft({ ...draft, icon: null, iconUri: null })} />
          </View>
          <Text style={{ color: theme.secondary }}>{t('online.browser.iconHelp')}</Text>
          <TextInput accessibilityLabel={t('common.name')} placeholder={t('common.name')} placeholderTextColor={theme.secondary}
            style={inputStyle} value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
          <TextInput accessibilityLabel={t('online.browser.homepage')} placeholder={t('online.browser.homepage')}
            placeholderTextColor={theme.secondary} style={inputStyle} value={draft.homepage} autoCapitalize="none"
            autoCorrect={false} keyboardType="url" onChangeText={(homepage) => setDraft({ ...draft, homepage })} />
          <TextInput accessibilityLabel={t('online.browser.template')} placeholder={t('online.browser.template')}
            placeholderTextColor={theme.secondary} style={inputStyle} value={draft.searchTemplate} autoCapitalize="none"
            autoCorrect={false} keyboardType="url" onChangeText={(searchTemplate) => setDraft({ ...draft, searchTemplate })} />
          <Text style={{ color: theme.secondary }}>{t('online.browser.templateHelp')}</Text>
          <View style={[styles.themeRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.sourceText}>
              <Text style={[styles.rowTitle, { color: theme.label }]}>{t('online.browser.themeSite')}</Text>
              <Text style={[styles.rowDetail, { color: theme.secondary }]}>{t('online.browser.themeSiteDetail')}</Text>
            </View>
            <GlassSwitch label={t('online.browser.themeSite')} value={draftTheme} disabled={busy} theme={theme} onChange={setDraftTheme} />
          </View>
          <Text style={[styles.fieldTitle, { color: theme.label }]}>{t('online.browser.customCss')}</Text>
          <TextInput accessibilityLabel={t('online.browser.customCss')} placeholder={t('online.browser.customCssPlaceholder')}
            placeholderTextColor={theme.secondary} style={[inputStyle, styles.css]} value={draftCss} multiline
            autoCapitalize="none" autoCorrect={false} onChangeText={setDraftCss} />
          <Text style={{ color: theme.secondary }}>{t('online.browser.customCssHelp')}</Text>
          <View style={[styles.row, styles.wrap]}>
            <PanelAction label={t('common.cancel')} theme={theme} disabled={busy} onPress={() => setDraft(null)} />
            <PanelAction primary label={t('common.save')} theme={theme} disabled={busy} onPress={saveDraft} />
            {draft.builtin && <PanelAction label={t('common.reset')} theme={theme} disabled={busy} onPress={() => void run(async () => {
              const original = state?.defaultProviders.find((value) => value.id === draft.id);
              if (original && state) {
                const values = state.providers.map((value) => value.id === draft.id ? { ...original, enabled: value.enabled } : value);
                await save(values); setDraft(null);
              }
            })} />}
            {!draft.builtin && <PanelAction label={t('common.delete')} theme={theme} disabled={busy} onPress={() => void run(async () => {
              if (!state) return;
              await save(state.providers.filter((value) => value.id !== draft.id));
              const themeValues = { ...preferences.onlineTheme }; delete themeValues[draft.id];
              const cssValues = { ...preferences.onlineCss }; delete cssValues[draft.id];
              update({ onlineTheme: themeValues, onlineCss: cssValues });
              setDraft(null);
            })} />}
          </View>
        </>}
      </ScrollView>
    </LibraryPanel>
  </SettingsPage>;
}

const styles = StyleSheet.create({
  content: { padding: settingsLayout.section.paddingHorizontal, gap: 12 },
  sourceRow: { paddingHorizontal: settingsLayout.section.paddingHorizontal, paddingVertical: 12, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  sourceHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sourceMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  sourceText: { flex: 1, gap: 2 },
  rowTitle: { ...settingsTypography.body },
  rowDetail: { ...settingsTypography.detail },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  defaultNote: { ...settingsTypography.detail, flexShrink: 1 },
  loading: { paddingVertical: 24, alignItems: 'center' },
  input: { minHeight: 44, paddingHorizontal: 12, fontSize: 15, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  iconRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  themeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  fieldTitle: { ...settingsTypography.body, marginTop: 4 },
  css: { minHeight: 160, paddingTop: 12, textAlignVertical: 'top', fontSize: 13, lineHeight: 18,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wrap: { flexWrap: 'wrap' },
});
