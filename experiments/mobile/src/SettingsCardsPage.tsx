import { ListIcon, SquaresFourIcon } from './icons';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { FontCard } from './FontCard';
import type { FontFamily } from './library';
import { usePreferences, type LibraryMode } from './settings';
import { SettingsChoiceRow, SettingsGroup, SettingsPage, SettingsSwitchRow, settingsLayout, settingsTypography } from './settings-ui';
import type { Theme } from './ui';

// 示例数据只用于现有字体卡片的展示，不写入字体库。
export function SettingsCardsPage({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const { t } = useTranslation();
  const { preferences, update } = usePreferences();
  const compact = preferences.defaultViewMode === 'list';
  const sampleFamily: FontFamily = {
    id: 'settings-card-preview', displayName: t('mobile.settings.systemFont'), isFavorite: true,
    identityIds: [], matchedFaceIds: [],
    faces: ['Regular', 'Bold', 'Italic'].map((styleName) => ({
      id: `settings-preview-${styleName}`, identityId: `settings-preview-${styleName}`,
      revisionId: 'settings-preview', styleName, sourcePath: null, faceIndex: 0, axes: [],
    })),
  };
  const viewOptions: { value: LibraryMode; label: string; icon: ReactNode }[] = [
    { value: 'grid', label: t('mobile.gridView'), icon: <SquaresFourIcon size={24} color={compact ? theme.secondary : theme.onAccent} /> },
    { value: 'list', label: t('mobile.listView'), icon: <ListIcon size={24} color={compact ? theme.onAccent : theme.secondary} /> },
  ];

  return <SettingsPage title={t('settings.cards')} theme={theme} onClose={onClose}>
    <View style={styles.previewSection}>
      <Text style={[styles.previewTitle, { color: theme.secondary }]}>{t('mobile.settings.cardPreview')}</Text>
      <View style={[styles.previewArea, { borderColor: theme.border }]}>
        <View key={preferences.defaultViewMode} style={compact ? styles.listCard : styles.previewCard}>
          <FontCard family={sampleFamily} mode={preferences.defaultViewMode} theme={theme}
            sampleText={t('mobile.settings.previewSample')} />
        </View>
      </View>
    </View>
    <SettingsGroup theme={theme}>
      <SettingsSwitchRow theme={theme} title={t('settings.showCardMetadata')} value={preferences.showCardMetadata}
        onChange={(value) => update({ showCardMetadata: value })} />
      <SettingsSwitchRow theme={theme} title={t('mobile.settings.showFavoriteBadge')} value={preferences.showFavoriteBadge}
        onChange={(value) => update({ showFavoriteBadge: value })} last />
    </SettingsGroup>
    <SettingsGroup theme={theme} title={t('settings.defaultLibraryView')}>
      <SettingsChoiceRow theme={theme} title={t('mobile.viewMode')} options={viewOptions}
        value={preferences.defaultViewMode} onChange={(value) => update({ defaultViewMode: value })} hideTitle last />
    </SettingsGroup>
  </SettingsPage>;
}

const styles = StyleSheet.create({
  previewSection: { gap: 8 },
  previewTitle: { ...settingsTypography.section, ...settingsLayout.section },
  previewArea: { ...settingsLayout.card, ...settingsLayout.formControls, height: 240,
    borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  previewCard: { width: '50%', maxWidth: 200, aspectRatio: 1 },
  listCard: { width: '100%' },
});
