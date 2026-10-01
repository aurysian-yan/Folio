import { useTranslation } from 'react-i18next';
import { usePreferences, type LibraryMode } from './settings';
import { SettingsChoiceRow, SettingsGroup, SettingsPage, SettingsSwitchRow } from './settings-ui';
import type { Theme } from './ui';

// 字体卡片：控制卡片信息与收藏标记，并决定字体库默认视图。
export function SettingsCardsPage({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const { t } = useTranslation();
  const { preferences, update } = usePreferences();
  const viewOptions: { value: LibraryMode; label: string }[] = [
    { value: 'grid', label: t('mobile.gridView') },
    { value: 'list', label: t('mobile.listView') },
  ];

  return <SettingsPage title={t('settings.cards')} theme={theme} onClose={onClose}>
    <SettingsGroup theme={theme} footer={t('settings.cardsDescription')}>
      <SettingsSwitchRow theme={theme} title={t('settings.showCardMetadata')} value={preferences.showCardMetadata}
        onChange={(value) => update({ showCardMetadata: value })} />
      <SettingsSwitchRow theme={theme} title={t('mobile.settings.showFavoriteBadge')} value={preferences.showFavoriteBadge}
        onChange={(value) => update({ showFavoriteBadge: value })} last />
    </SettingsGroup>
    <SettingsGroup theme={theme} title={t('settings.defaultLibraryView')} footer={t('settings.browseDescription')}>
      <SettingsChoiceRow theme={theme} title={t('mobile.viewMode')} options={viewOptions}
        value={preferences.defaultViewMode} onChange={(value) => update({ defaultViewMode: value })} last />
    </SettingsGroup>
  </SettingsPage>;
}
