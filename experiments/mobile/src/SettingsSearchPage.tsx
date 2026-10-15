import { useTranslation } from 'react-i18next';
import { usePreferences } from './settings';
import { SettingsGroup, SettingsPage, SettingsSwitchRow } from './settings-ui';
import type { Theme } from './ui';

export function SettingsSearchPage({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const { t } = useTranslation();
  const { preferences, ready, update } = usePreferences();
  return <SettingsPage title={t('common.search')} theme={theme} onClose={onClose}>
    <SettingsGroup theme={theme}>
      <SettingsSwitchRow theme={theme} title={t('mobile.settings.searchAutoFocus')}
        detail={t('mobile.settings.searchAutoFocusDetail')} value={preferences.searchAutoFocus} disabled={!ready}
        onChange={(value) => update({ searchAutoFocus: value })} last />
    </SettingsGroup>
  </SettingsPage>;
}
