import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator } from './UiActivityIndicator';
import { BackHandler, Platform, Pressable, Text, View, useColorScheme } from 'react-native';
import { getAboutInfo } from './native';
import { SettingsUpdatePage } from './SettingsUpdatePage';
import { createTheme } from './ui';
import { androidCompatibilityStatus } from '../../../shared/about/android-release';

// 兼容检查先于业务提供器挂载，更新失败时保持受限状态。
export function AndroidCompatibilityGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const dark = useColorScheme() === 'dark';
  const theme = createTheme(dark, 'folio');
  const [status, setStatus] = useState<'checking' | 'ready' | 'required' | 'failed'>(Platform.OS === 'android' ? 'checking' : 'ready');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let active = true;
    void Promise.resolve().then(getAboutInfo).then((info) => {
      if (active) setStatus(androidCompatibilityStatus(info));
    }).catch(() => { if (active) setStatus('failed'); });
    return () => { active = false; };
  }, [attempt]);
  useEffect(() => {
    if (status === 'required' || status === 'failed') void SplashScreen.hideAsync();
  }, [status]);
  if (status === 'ready') return children;
  if (status === 'required') return <SettingsUpdatePage required theme={theme} onClose={BackHandler.exitApp} backLabel={t('common.exit')} />;
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
    {status === 'checking' ? <ActivityIndicator color={theme.accent} /> : <>
      <Text style={{ color: theme.label }}>{t('softwareUpdate.errors.info')}</Text>
      <Pressable accessibilityRole="button" onPress={() => { setStatus('checking'); setAttempt((value) => value + 1); }}><Text style={{ color: theme.accent }}>{t('common.retry')}</Text></Pressable>
    </>}
  </View>;
}
