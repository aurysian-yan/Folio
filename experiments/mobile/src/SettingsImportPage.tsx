import { useTranslation } from 'react-i18next';
import { usePreferences } from './settings';
import { SettingsGroup, SettingsNote, SettingsPage, SettingsSwitchRow, SettingsValueRow } from './settings-ui';
import type { Theme } from './ui';

// 导入：移动端固定复制到托管目录，可控制导入汇总的展示方式。
export function SettingsImportPage({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const { t } = useTranslation();
  const { preferences, update } = usePreferences();
  return <SettingsPage title={t('settings.importing')} theme={theme} onClose={onClose}>
    <SettingsGroup theme={theme} footer={t('settings.importDescription')}>
      <SettingsValueRow theme={theme} title={t('import.mode')} value={t('import.copyToLibrary')} />
      <SettingsSwitchRow theme={theme} title={t('mobile.settings.importShowResults')} value={preferences.importShowResults}
        onChange={(value) => update({ importShowResults: value })} last />
    </SettingsGroup>
    <SettingsNote theme={theme}>{t('mobile.importHint')}</SettingsNote>
  </SettingsPage>;
}
