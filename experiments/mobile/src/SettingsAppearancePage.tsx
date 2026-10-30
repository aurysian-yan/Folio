import { GlassSlider } from './GlassSlider';
import { GlassSwitch } from './GlassSwitch';
import { PanelAction } from './panel-content';
import { useDialogs } from './Dialogs';
import { CheckIcon, CircleHalfIcon, ListIcon, SquaresFourIcon } from './icons';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { supportsM3e } from './android-ui-capability';
import { wallpaperSeed } from './native';
import { FontCard } from './FontCard';
import { AppearanceChoiceRow } from './AppearanceChoiceRow';
import type { FontFamily } from './library';
import { previewScaleOptions, usePreferences, type AccentId, type LibraryMode } from './settings';
import { SettingsGroup, SettingsIcon, SettingsPage, SettingsSwitchRow, SettingsValueRow, SettingsActionRow, SettingsNote, settingsLayout, settingsTypography } from './settings-ui';
import { resolveAccentColor, type Theme } from './ui';

// 主题、字体卡片与预览字号集中管理，深浅色跟随系统。
export function SettingsAppearancePage({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const { t } = useTranslation();
  const { preferences, ready, update, saveError, retrySave } = usePreferences();
  const [sampleSwitch, setSampleSwitch] = useState(true);
  const [sampleSlider, setSampleSlider] = useState(50);
  const { alert } = useDialogs();
  const compact = preferences.defaultViewMode === 'list';
  const sampleFamily: FontFamily = {
    id: 'settings-card-preview', displayName: t('mobile.settings.systemFont'), isFavorite: true,
    identityIds: [], matchedFaceIds: [],
    faces: ['Regular', 'Bold', 'Italic'].map((styleName) => ({
      id: `settings-preview-${styleName}`, identityId: `settings-preview-${styleName}`,
      revisionId: 'settings-preview', styleName, sourcePath: null, faceIndex: 0, axes: [],
    })),
  };
  const viewOptions: { value: LibraryMode; label: string; icon: ReactNode; systemImage: string }[] = [
    { value: 'grid', systemImage: 'square.grid.2x2', label: t('mobile.gridView'), icon: <SquaresFourIcon size={24} color={compact ? theme.label : theme.onAccent} /> },
    { value: 'list', systemImage: 'list.bullet', label: t('mobile.listView'), icon: <ListIcon size={24} color={compact ? theme.onAccent : theme.label} /> },
  ];
  // 仅 Android 12 及以上可取到壁纸种子，取不到时不显示壁纸配色项。
  const [wallpaperAccent] = useState<string | null>(() => (Platform.OS === 'android' ? wallpaperSeed() : null));
  const android = Platform.OS === 'android';
  const scaleOptions = previewScaleOptions.map((scale) => ({
    value: String(scale),
    label: scale === 18 ? t('mobile.settings.scaleSmall') : scale === 24 ? t('mobile.settings.scaleMedium') : t('mobile.settings.scaleLarge'),
  }));
  const accents: { id: AccentId; label: string }[] = [
    { id: 'folio', label: t('theme.folioOrange') },
    { id: 'blue', label: t('mobile.settings.accentBlue') },
    { id: 'green', label: t('mobile.settings.accentGreen') },
    { id: 'purple', label: t('mobile.settings.accentPurple') },
    { id: 'yellow', label: t('color.yellow') },
    { id: 'pink', label: t('color.pink') },
    { id: 'cyan', label: t('color.cyan') },
    ...(wallpaperAccent ? [{ id: 'wallpaper' as AccentId, label: t('mobile.settings.accentWallpaper') }] : []),
  ];

  return <SettingsPage title={t('mobile.settings.appearanceAndDisplay')} theme={theme} onClose={onClose}>
    {supportsM3e && __DEV__ && <SettingsGroup theme={theme} title={t('mobile.settings.uiStyle')}>
      {(['glasmio', 'material3-expressive'] as const).map((value) => <Pressable key={value} disabled={!ready}
        accessibilityRole="radio" accessibilityState={{ selected: preferences.androidUiStyle === value, disabled: !ready }}
        accessibilityLabel={t(value === 'glasmio' ? 'mobile.settings.uiGlasmio' : 'mobile.settings.uiM3e')}
        onPress={() => update({ androidUiStyle: value })}
        style={[styles.themeCard, { backgroundColor: preferences.androidUiStyle === value ? theme.activeTab : theme.surface, borderColor: theme.border }]}>
        <View style={styles.themePreview}><View style={{ width: 48, height: 24, borderRadius: value === 'glasmio' ? 12 : 8, backgroundColor: theme.accent }} />
          <View style={{ flex: 1, height: 32, borderRadius: value === 'glasmio' ? 16 : 8, backgroundColor: theme.raised }} />
          <CheckIcon size={24} color={preferences.androidUiStyle === value ? theme.accent : theme.muted} /></View>
        <Text style={[styles.title, { color: theme.label }]}>{t(value === 'glasmio' ? 'mobile.settings.uiGlasmio' : 'mobile.settings.uiM3e')}</Text>
      </Pressable>)}
    </SettingsGroup>}
    {saveError && <SettingsGroup theme={theme}><SettingsNote theme={theme}>{t('mobile.settings.saveFailed')}</SettingsNote>
      <SettingsActionRow theme={theme} title={t('common.retry')} onPress={retrySave} /></SettingsGroup>}
    <SettingsGroup theme={theme} title={t('settings.appearance')}>
      <View style={styles.systemTheme}>
        <SettingsIcon><CircleHalfIcon size={22} color={theme.label} /></SettingsIcon>
        <View style={styles.systemBody}>
          <Text style={[styles.title, { color: theme.label }]}>{t('mobile.settings.appearanceMode')}</Text>
          <Text style={[styles.detail, { color: theme.secondary }]}>{t('mobile.settings.appearanceSystem')}</Text>
        </View>
        <Text style={[styles.modeValue, { color: theme.secondary }]}>{t(theme.dark ? 'mobile.settings.appearanceDark' : 'mobile.settings.appearanceLight')}</Text>
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('settings.theme')} style={styles.swatches}>
        {accents.map(({ id, label }) => {
          const selected = preferences.accent === id;
          const color = resolveAccentColor(id, theme.dark, wallpaperAccent ?? undefined);
          return <Pressable key={id} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected }}
            onPress={() => update({ accent: id })}
            style={({ pressed }) => [styles.swatchOption, { opacity: pressed ? 0.7 : 1 }]}>
            <View style={[styles.swatchOutline, { borderColor: selected ? color : 'transparent' }]}>
              <View style={[styles.swatch, { backgroundColor: color }]}>
                {selected && <CheckIcon size={20} color={theme.label} weight="bold" />}
              </View>
            </View>
            <Text style={[styles.swatchLabel, { color: selected ? theme.label : theme.secondary }]}>{id === 'folio' ? t('color.orange') : label}</Text>
          </Pressable>;
        })}
      </View>
      {android && (supportsM3e ? <SettingsValueRow theme={theme} title={t('mobile.settings.materialTheme')}
        detail={t('mobile.settings.materialManaged')} value={t(preferences.materialTheme ? 'mobile.settings.materialEnabled' : 'mobile.settings.materialDisabled')} last />
        : <SettingsSwitchRow theme={theme} title={t('mobile.settings.materialTheme')} detail={t('mobile.settings.materialThemeDetail')}
          value={preferences.materialTheme} disabled={!ready} onChange={(value) => update({ materialTheme: value })} last />)}
    </SettingsGroup>
    {supportsM3e && __DEV__ && <SettingsGroup theme={theme} title={t('mobile.settings.componentPreview')}>
      <View style={{ padding: 16, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: theme.label }}>{t('mobile.settings.previewSwitch')}</Text>
          <GlassSwitch theme={theme} label={t('mobile.settings.previewSwitch')} value={sampleSwitch} onChange={setSampleSwitch} />
        </View>
        <GlassSlider theme={theme} label={t('preview.size')} value={sampleSlider} minimum={0} maximum={100} step={1}
          valueText={String(sampleSlider)} onChange={setSampleSlider} />
        <PanelAction theme={theme} label={t('mobile.settings.previewDialog')} primary fullWidth onPress={() => alert(
          t('mobile.settings.componentPreview'), t('mobile.settings.previewDialogMessage'), [{ text: t('common.close'), style: 'cancel' }])} />
      </View>
    </SettingsGroup>}
    <View style={styles.previewSection}>
      <Text style={[styles.previewTitle, { color: theme.secondary }]}>{t('mobile.settings.cardPreview')}</Text>
      <View style={styles.previewArea}>
        <View key={preferences.defaultViewMode} style={compact ? styles.listCard : styles.previewCard}>
          <FontCard family={sampleFamily} mode={preferences.defaultViewMode} theme={{ ...theme, accent: theme.secondary }}
            sampleText={t('mobile.settings.previewSample')} />
        </View>
      </View>
    </View>
    <View style={styles.cardControls}>
      <Text style={[styles.previewTitle, { color: theme.secondary }]}>{t('settings.cards')}</Text>
      <AppearanceChoiceRow kind="view" disabled={!ready} theme={theme} title={t('settings.defaultLibraryView')} options={viewOptions}
        value={preferences.defaultViewMode} onChange={(value) => { if (value === 'grid' || value === 'list') update({ defaultViewMode: value }); }} />
      <AppearanceChoiceRow kind="size" disabled={!ready} theme={theme} title={t('preview.size')} options={scaleOptions}
        value={String(preferences.previewScale)} onChange={(value) => update({ previewScale: Number(value) })} />
    </View>
    <SettingsGroup theme={theme}>
      <SettingsSwitchRow theme={theme} title={t('settings.showCardMetadata')} value={preferences.showCardMetadata} disabled={!ready}
        onChange={(value) => update({ showCardMetadata: value })} />
      <SettingsSwitchRow theme={theme} title={t('mobile.settings.showFavoriteBadge')} value={preferences.showFavoriteBadge} disabled={!ready}
        onChange={(value) => update({ showFavoriteBadge: value })} last />
    </SettingsGroup>
  </SettingsPage>;
}

const styles = StyleSheet.create({
  themeCard: { margin: 8, padding: 16, borderRadius: 20, borderWidth: 1, gap: 12 },
  themePreview: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  systemTheme: { minHeight: 64, ...settingsLayout.row, flexDirection: 'row', alignItems: 'center', gap: 12 },
  systemBody: { flex: 1, gap: 4 },
  title: { ...settingsTypography.body },
  detail: { ...settingsTypography.detail },
  modeValue: { fontSize: 14, lineHeight: 20 },
  previewSection: { gap: 8 },
  cardControls: { gap: 8 },
  previewTitle: { ...settingsTypography.section, ...settingsLayout.section },
  previewArea: { ...settingsLayout.card, ...settingsLayout.formControls, height: 240, alignItems: 'center', justifyContent: 'center' },
  previewCard: { width: '50%', maxWidth: 200, aspectRatio: 1 },
  listCard: { width: '100%' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', padding: settingsLayout.section.paddingHorizontal, rowGap: 12 },
  swatchOption: { width: '25%', alignItems: 'center', gap: 8 },
  swatchOutline: { padding: 4, borderRadius: 26, borderWidth: 2 },
  swatch: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  swatchLabel: { ...settingsTypography.detail, textAlign: 'center' },
});
