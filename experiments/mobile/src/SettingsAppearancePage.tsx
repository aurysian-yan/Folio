import { CheckIcon, CircleHalfIcon, ListIcon, SquaresFourIcon } from './icons';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { wallpaperSeed } from './native';
import { FontCard } from './FontCard';
import { AppearanceChoiceRow } from './AppearanceChoiceRow';
import type { FontFamily } from './library';
import { previewScaleOptions, usePreferences, type AccentId, type LibraryMode } from './settings';
import { SettingsGroup, SettingsIcon, SettingsPage, SettingsSwitchRow, settingsLayout, settingsTypography } from './settings-ui';
import { resolveAccentColor, type Theme } from './ui';

// 主题、字体卡片与预览字号集中管理，深浅色跟随系统。
export function SettingsAppearancePage({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const { t } = useTranslation();
  const { preferences, ready, update } = usePreferences();
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
      {android && <SettingsSwitchRow theme={theme} title={t('mobile.settings.materialTheme')} detail={t('mobile.settings.materialThemeDetail')}
        value={preferences.materialTheme} disabled={!ready} onChange={(value) => update({ materialTheme: value })} last />}
    </SettingsGroup>
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
