import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { cloudSync } from './native';
import { SettingsActionRow, SettingsGroup, SettingsNote, SettingsPage, SettingsSwitchRow } from './settings-ui';
import type { SyncProfile } from './sync';
import type { CloudSyncController } from './useCloudSync';
import type { Theme } from './ui';
import { WebDAVPresetMenu } from './WebDAVPresetMenu';

// 云同步配置沿用现有二级设置导航与分组样式。
export function SettingsSyncPage({ theme, onClose, controller }: { theme: Theme; onClose: () => void; controller: CloudSyncController }) {
  const { t } = useTranslation();
  const { state, readError, actionError, busy, run } = controller;
  const [draft, setProfile] = useState<SyncProfile | null>(null);
  const profile = draft ?? state?.profile ?? { serverUrl: '', remoteDirectory: '', username: '', automatic: false };
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const disabled = controller.blocked || busy || !!state?.status.isRunning || !state || !!readError;
  const field = (key: 'serverUrl' | 'remoteDirectory' | 'username' | 'password', title: string) => <View key={key} style={styles.field}>
    <Text style={[styles.label, { color: theme.label }]}>{title}</Text>
    <View style={styles.inputRow}><TextInput accessibilityLabel={title} value={key === 'password' ? password : profile[key]}
      onChangeText={(value) => { setMessage(null); if (key === 'password') setPassword(value); else setProfile((previous) => ({ ...(previous ?? profile), [key]: value })); }}
      editable={!disabled} autoCapitalize="none" autoCorrect={false} secureTextEntry={key === 'password'}
      keyboardType={key === 'serverUrl' ? 'url' : 'default'}
      placeholder={key === 'password' && state?.credentialAvailable ? t('cloud.passwordStored') : undefined}
      placeholderTextColor={theme.muted} style={[styles.input, { color: theme.label, borderColor: theme.border }]} />
      {key === 'serverUrl' && <WebDAVPresetMenu theme={theme} serverUrl={profile.serverUrl} disabled={disabled}
        onChange={(serverUrl) => { setMessage(null); setProfile((previous) => ({ ...(previous ?? profile), serverUrl })); }} />}
    </View>
  </View>;
  async function action(kind: 'test' | 'save' | 'disconnect') {
    setMessage(null);
    const success = await run(() => kind === 'test' ? cloudSync.test(profile, password)
      : kind === 'save' ? cloudSync.save(profile, password) : cloudSync.disconnect(), kind !== 'test');
    if (success) {
      if (kind !== 'test') setPassword('');
      if (kind === 'disconnect') setProfile({ serverUrl: '', remoteDirectory: '', username: '', automatic: false });
      setMessage(kind === 'test' ? 'cloud.connectSuccess' : kind === 'save' ? 'cloud.connectionSaved' : 'cloud.disconnected');
    }
  }
  return <SettingsPage title={t('settings.cloud')} theme={theme} onClose={onClose}>
    <SettingsGroup theme={theme} title={t('cloud.connection')}>
      {field('serverUrl', t('cloud.serverURL'))}{field('remoteDirectory', t('cloud.remoteDirectory'))}
      {field('username', t('cloud.username'))}{field('password', t('cloud.password'))}
      <SettingsSwitchRow title={t('cloud.autoSync')} detail={t('mobile.sync.automaticHint')} theme={theme}
        value={profile.automatic} disabled={disabled} onChange={(automatic) => setProfile((previous) => ({ ...(previous ?? profile), automatic }))} last />
    </SettingsGroup>
    {!!state?.credentialError && <SettingsNote theme={theme}>{t('mobile.sync.credentialsError')}</SettingsNote>}
    <SettingsNote theme={theme}>{t('mobile.sync.secureStorage')}</SettingsNote>
    <SettingsGroup theme={theme}>
      <SettingsActionRow title={t('cloud.testConnection')} theme={theme} disabled={disabled} busy={busy} onPress={() => { void action('test'); }} />
      <SettingsActionRow title={t('common.save')} theme={theme} disabled={disabled} onPress={() => { void action('save'); }} />
      <SettingsActionRow title={t('cloud.disconnect')} theme={theme} destructive disabled={disabled || !state?.profile}
        onPress={() => { void action('disconnect'); }} last />
    </SettingsGroup>
    {!!(readError || actionError || message) && <SettingsNote theme={theme}>{t(readError ?? actionError ?? message!)}</SettingsNote>}
    {!!readError && <SettingsActionRow title={t('common.retry')} theme={theme} onPress={() => { void controller.refresh().catch(() => undefined); }} last />}
  </SettingsPage>;
}
const styles = StyleSheet.create({
  field: { paddingHorizontal: 14, paddingVertical: 10, gap: 4 },
  label: { fontSize: 16, lineHeight: 22 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: { flex: 1, minWidth: 0, minHeight: 44, fontSize: 16, borderBottomWidth: StyleSheet.hairlineWidth },
});
