import { useTranslation } from 'react-i18next';
import { usePreferences } from './settings';
import { SettingsGroup, SettingsNote, SettingsPage, SettingsSwitchRow, SettingsValueRow } from './settings-ui';
import type { Theme } from './ui';

// 搜索、字符表与导入行为集中在同一设置页。
export function SettingsBrowsingPage({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const { t } = useTranslation();
  const { preferences, ready, update } = usePreferences();
  return <SettingsPage title={t('mobile.settings.browsingAndImport')} theme={theme} onClose={onClose}>
    <SettingsGroup theme={theme} title={t('mobile.settings.browsing')}>
      <SettingsSwitchRow theme={theme} title={t('mobile.settings.searchAutoFocus')}
        detail={t('mobile.settings.searchAutoFocusDetail')} value={preferences.searchAutoFocus} disabled={!ready}
        onChange={(value) => update({ searchAutoFocus: value })} />
      <SettingsSwitchRow theme={theme} title={t('characterMap.autoSelectFirstNonEmpty')}
        detail={t('characterMap.autoSelectFirstNonEmptyDescription')} value={preferences.characterMapAutoSelectFirstNonEmpty} disabled={!ready}
        onChange={(value) => update({ characterMapAutoSelectFirstNonEmpty: value })} />
      <SettingsSwitchRow theme={theme} title={t('characterMap.inheritAxes')}
        detail={t('characterMap.inheritAxesDescription')} value={preferences.characterMapInheritAxes} disabled={!ready}
        onChange={(value) => update({ characterMapInheritAxes: value })} last />
    </SettingsGroup>
    <SettingsGroup theme={theme} title={t('settings.importing')} footer={t('settings.importDescription')}>
      <SettingsValueRow theme={theme} title={t('import.mode')} value={t('import.copyToLibrary')} />
      <SettingsSwitchRow theme={theme} title={t('mobile.settings.importShowResults')} value={preferences.importShowResults} disabled={!ready}
        onChange={(value) => update({ importShowResults: value })} last />
    </SettingsGroup>
    <SettingsNote theme={theme}>{t('mobile.importHint')}</SettingsNote>
  </SettingsPage>;
}
