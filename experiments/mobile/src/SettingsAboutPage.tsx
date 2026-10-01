import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { SettingsNote, SettingsPage } from './settings-ui';
import type { Theme } from './ui';

// 关于：品牌字标、版本与版权信息，与桌面端「关于」保持一致。
export function SettingsAboutPage({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const { t } = useTranslation();
  const version = Constants.expoConfig?.version;
  const appName = Constants.expoConfig?.name ?? t('common.appName');
  return <SettingsPage title={t('settings.about')} theme={theme} onClose={onClose}>
    <View style={styles.about}>
      <Image source={require('../assets/design/folio.svg')} style={[styles.logo, { tintColor: theme.label }]}
        contentFit="contain" accessible accessibilityLabel={appName} />
      <Text style={[styles.version, { color: theme.secondary }]}>
        {version ? t('macos.version', { version }) : t('common.unknownVersion')}
      </Text>
      <Text style={[styles.subtitle, { color: theme.secondary }]}>{t('macos.aboutSubtitle')}</Text>
    </View>
    <SettingsNote theme={theme}>
      <Text style={{ color: theme.muted }}>{`© 2026 Folio · AGPL-3.0-only`}</Text>
    </SettingsNote>
  </SettingsPage>;
}

const styles = StyleSheet.create({
  about: { alignItems: 'center', gap: 12, paddingVertical: 32 },
  logo: { width: 180, height: 64 },
  version: { fontSize: 15 },
  subtitle: { fontSize: 15, textAlign: 'center' },
});
