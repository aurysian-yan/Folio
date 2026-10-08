import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Motion, { Easing, ReduceMotion, withTiming } from 'react-native-reanimated';
import { CaretRightIcon, CaretUpIcon, CloudIcon, EyeIcon, EyeSlashIcon, FolderIcon, UserCircleIcon } from './icons';
import { cloudSync } from './native';
import { SettingsActionRow, SettingsGroup, SettingsIcon, SettingsNote, SettingsPage, SettingsSwitchRow, SettingsValueRow,
  settingsInsetScale, settingsLayout, settingsTransition, settingsTypography, type SettingsPageHandle } from './settings-ui';
import { pageTitleMotion } from './page-header-motion';
import { canReuseSyncPassword, maskedSyncAccount, matchingWebdavPreset, syncErrorKey, validateProfile, webdavPresets, webdavSourceName,
  type SyncProfile } from './sync';
import type { CloudSyncController } from './useCloudSync';
import type { Theme } from './ui';
import { WebDAVPresetMenu } from './WebDAVPresetMenu';

type SetupStep = 'provider' | 'server' | 'account' | 'sync';
type ConnectionAction = 'save' | 'test' | 'disconnect';
const setupSteps: SetupStep[] = ['provider', 'server', 'account', 'sync'];
const emptyProfile: SyncProfile = { serverUrl: '', remoteDirectory: 'Folio', username: '', automatic: false };

// 首次连接逐步配置；保存后以账号摘要折叠完整编辑表单。
export function SettingsSyncPage({ theme, onClose, controller }: { theme: Theme; onClose: () => void; controller: CloudSyncController }) {
  const { t } = useTranslation();
  const sourceId = useId();
  const page = useRef<SettingsPageHandle>(null);
  const passwordInput = useRef<TextInput>(null);
  const directoryInput = useRef<TextInput>(null);
  const actionInFlight = useRef(false);
  const [stepDirection, setStepDirection] = useState(1);
  const stepTransition = useMemo(() => {
    const distance = settingsLayout.content.gap;
    const config = { duration: pageTitleMotion.duration, easing: Easing.inOut(Easing.ease), reduceMotion: ReduceMotion.System };
    return {
      entering: () => {
        'worklet';
        return {
          initialValues: { opacity: 0, transform: [{ translateX: stepDirection * distance }] },
          animations: { opacity: withTiming(1, config), transform: [{ translateX: withTiming(0, config) }] },
        };
      },
      exiting: () => {
        'worklet';
        return {
          initialValues: { opacity: 1, transform: [{ translateX: 0 }] },
          animations: { opacity: withTiming(0, config), transform: [{ translateX: withTiming(-stepDirection * distance, config) }] },
        };
      },
    };
  }, [stepDirection]);
  const { state, readError, busy, run } = controller;
  const [draft, setProfile] = useState<SyncProfile | null>(null);
  const [step, setStep] = useState<SetupStep>('provider');
  const [nextStep, setNextStep] = useState<SetupStep | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<ConnectionAction | null>(null);
  // 先更新当前步骤的退场方向，再挂载下一步骤。
  useLayoutEffect(() => {
    if (!nextStep) return;
    setStep(nextStep);
    setNextStep(null);
  }, [nextStep]);
  const profile = draft ?? state?.profile ?? emptyProfile;
  const currentStep = state?.profile ? null : step;
  const disabled = controller.blocked || busy || !!pendingAction || !state || !!readError;
  const passwordStored = canReuseSyncPassword(profile, state?.profile ?? null, !!state?.credentialAvailable);
  const providerName = webdavSourceName(profile.serverUrl, t);
  const stepNumber = currentStep === 'sync' ? 3 : currentStep === 'account' ? 2 : 1;

  function clearFeedback() { setError(null); setMessage(null); }
  function goTo(next: SetupStep) {
    Keyboard.dismiss(); clearFeedback(); setPasswordVisible(false); page.current?.restoreTitle();
    setStepDirection(setupSteps.indexOf(next) >= setupSteps.indexOf(step) ? 1 : -1);
    setNextStep(next);
  }
  function updateProfile(change: Partial<SyncProfile>) {
    clearFeedback(); setProfile((previous) => ({ ...(previous ?? profile), ...change }));
  }
  function back() {
    if (actionInFlight.current) return;
    if (currentStep === 'sync') goTo('account');
    else if (currentStep === 'account') goTo(matchingWebdavPreset(profile.serverUrl) === 'none' ? 'server' : 'provider');
    else if (currentStep === 'server') goTo('provider');
    else { Keyboard.dismiss(); onClose(); }
  }
  async function next() {
    if (disabled) return;
    clearFeedback();
    if (currentStep === 'server') {
      try { validateProfile({ ...profile, remoteDirectory: '' }); }
      catch { setError('cloud.setup.invalidServer'); return; }
      goTo('account');
    } else if (currentStep === 'account') {
      if (!password && !passwordStored) { setError('cloud.passwordMissing'); passwordInput.current?.focus(); return; }
      if (await action('test')) goTo('sync');
    }
  }
  function startEditing() {
    if (disabled) return;
    Keyboard.dismiss(); clearFeedback(); setPasswordVisible(false);
    if (!draft) setProfile({ ...profile });
    setExpanded(true);
  }
  function cancelEditing() {
    page.current?.restoreTitle();
    Keyboard.dismiss(); clearFeedback(); setProfile(null); setPassword(''); setPasswordVisible(false); setExpanded(false);
  }
  async function action(kind: ConnectionAction, updatedProfile = currentStep || expanded ? profile : state?.profile ?? profile) {
    if (disabled || actionInFlight.current) return;
    clearFeedback(); Keyboard.dismiss();
    if (kind === 'save' || kind === 'test') {
      try { validateProfile(updatedProfile); }
      catch { setError('mobile.sync.invalidProfile'); return; }
      if (!(currentStep || expanded ? password : '') && !canReuseSyncPassword(updatedProfile, state?.profile ?? null, !!state?.credentialAvailable)) {
        if (currentStep) goTo('account');
        else setExpanded(true);
        setError('cloud.setup.passwordRequired'); return;
      }
    }
    actionInFlight.current = true; setPendingAction(kind);
    let failure: string | null = null;
    const success = await run(async () => {
      try {
        const secret = currentStep || expanded ? password : '';
        if (kind === 'test') await cloudSync.test(updatedProfile, secret);
        else if (kind === 'save') await cloudSync.save(updatedProfile, secret);
        else await cloudSync.disconnect();
      } catch (cause) { failure = syncErrorKey(cause); throw cause; }
    }, kind !== 'test');
    actionInFlight.current = false; setPendingAction(null);
    if (success) {
      if (kind === 'save' && expanded) page.current?.restoreTitle();
      if (kind !== 'test') { setPassword(''); setPasswordVisible(false); setProfile(null); setExpanded(false); setStep('provider'); }
      setMessage(kind === 'test' ? 'cloud.connectSuccess' : kind === 'save' ? 'cloud.connectionSaved' : 'cloud.disconnected');
    } else if (failure) {
      if (currentStep && (failure === 'mobile.sync.authenticationError' || failure === 'cloud.passwordUnavailable')) goTo('account');
      setError(failure);
    }
    return success;
  }
  const field = (key: 'serverUrl' | 'remoteDirectory' | 'username' | 'password', title: string) => <View key={key} style={styles.field}>
    <Text style={[styles.label, { color: theme.label }]}>{title}</Text>
    <View style={[styles.inputRow, { backgroundColor: theme.raised }]}>
      <TextInput ref={key === 'password' ? passwordInput : key === 'remoteDirectory' ? directoryInput : undefined} accessibilityLabel={title}
        value={key === 'password' ? password : profile[key]}
        onChangeText={(value) => { if (key === 'password') { clearFeedback(); setPassword(value); } else updateProfile({ [key]: value }); }}
        editable={!disabled} autoCapitalize="none" autoCorrect={false} secureTextEntry={key === 'password' && !passwordVisible}
        autoComplete={key === 'username' ? 'username' : key === 'password' ? 'current-password' : 'off'}
        textContentType={key === 'username' ? 'username' : key === 'password' ? 'password' : key === 'serverUrl' ? 'URL' : 'none'}
        keyboardType={key === 'serverUrl' ? 'url' : 'default'} returnKeyType={key === 'username' || currentStep === 'server' || currentStep === 'account' ? 'next' : 'done'}
        submitBehavior={key === 'username' || key === 'password' && currentStep === 'account' ? 'submit' : 'blurAndSubmit'}
        onSubmitEditing={() => {
          if (key === 'username') passwordInput.current?.focus();
          else if (key === 'password' && currentStep === 'account') directoryInput.current?.focus();
          else if (currentStep) { void next(); }
          else Keyboard.dismiss();
        }}
        placeholder={key === 'password' && passwordStored ? t('cloud.passwordStored') : key === 'remoteDirectory' ? '/' : undefined}
        placeholderTextColor={theme.muted} selectionColor={theme.selection} style={[styles.input, { color: theme.label }]} />
      {key === 'serverUrl' && <WebDAVPresetMenu sourceId={sourceId} theme={theme} serverUrl={profile.serverUrl} disabled={disabled}
        onChange={(serverUrl) => updateProfile({ serverUrl })} />}
      {key === 'password' && <Pressable accessibilityRole="button" accessibilityLabel={t(passwordVisible ? 'common.hidePassword' : 'common.showPassword')}
        accessibilityState={{ disabled }} disabled={disabled} onPress={() => setPasswordVisible((visible) => !visible)}
        style={({ pressed }) => [styles.passwordToggle, { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}>
        {passwordVisible ? <EyeSlashIcon size={20} color={theme.secondary} /> : <EyeIcon size={20} color={theme.secondary} />}
      </Pressable>}
    </View>
  </View>;
  const savedProfile = state?.profile;
  const savedProvider = savedProfile ? webdavSourceName(savedProfile.serverUrl, t) : '';
  const connectionStatus = pendingAction === 'test' && !expanded ? 'cloud.testingConnection'
    : state?.credentialError ? 'mobile.sync.credentialsError' : savedProfile && !state?.credentialAvailable ? 'cloud.passwordUnavailable' : 'cloud.connectionSaved';
  const primaryBusy = pendingAction === 'save' || currentStep === 'account' && pendingAction === 'test';
  const primaryTitle = t(primaryBusy ? 'cloud.testingConnection' : expanded ? 'common.save'
    : currentStep === 'sync' ? 'cloud.setup.connectAndSave' : 'common.nextStep');

  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.screen}>
    <SettingsPage ref={page} key={currentStep ? 'setup' : 'overview'} title={t('settings.cloud')} theme={theme} onClose={back}
      backLabel={currentStep && currentStep !== 'provider' ? t('common.previousStep') : undefined} backdropSourceId={sourceId}>
      {!state || readError ? <SettingsNote theme={theme}>{t(readError ?? 'mobile.sync.reading')}</SettingsNote> : currentStep ?
      <Motion.View key={currentStep} {...stepTransition} style={styles.setupStep}>
        <View style={styles.heading}>
          <Text style={[styles.step, { color: theme.secondary }]}>{t('common.stepOfTotal', { step: stepNumber, total: 3 })}</Text>
          <Text accessibilityRole="header" style={[styles.headingTitle, { color: theme.label }]}>{t(`cloud.setup.${currentStep}Title`)}</Text>
          <Text style={[styles.description, { color: theme.secondary }]}>{t(`cloud.setup.${currentStep}Hint`, { provider: providerName })}</Text>
        </View>
        {currentStep === 'provider' && <SettingsGroup theme={theme}>
          {webdavPresets.filter((preset) => preset.url).map((preset) => <Pressable key={preset.id} accessibilityRole="button"
            accessibilityLabel={t(preset.label)} accessibilityState={{ disabled }} disabled={disabled}
            style={({ pressed }) => [styles.provider, pressed && { backgroundColor: theme.raised }]}
            onPress={() => {
              const serverUrl = matchingWebdavPreset(profile.serverUrl) === preset.id ? profile.serverUrl : preset.url;
              if (serverUrl !== profile.serverUrl) setPassword('');
              updateProfile({ serverUrl }); goTo('account');
            }}>
            <SettingsIcon><CloudIcon size={22} color={theme.accent} /></SettingsIcon>
            <Text style={[styles.providerLabel, { color: theme.label }]}>{t(preset.label)}</Text>
            <CaretRightIcon size={16} color={theme.muted} />
          </Pressable>)}
          <Pressable accessibilityRole="button" accessibilityLabel={t('cloud.setup.otherProvider')} accessibilityState={{ disabled }}
            disabled={disabled} style={({ pressed }) => [styles.provider, pressed && { backgroundColor: theme.raised }]}
            onPress={() => {
              if (matchingWebdavPreset(profile.serverUrl) !== 'none') { updateProfile({ serverUrl: '' }); setPassword(''); }
              goTo('server');
            }}>
            <SettingsIcon><FolderIcon size={22} color={theme.secondary} /></SettingsIcon>
            <Text style={[styles.providerLabel, { color: theme.label }]}>{t('cloud.setup.otherProvider')}</Text>
            <CaretRightIcon size={16} color={theme.muted} />
          </Pressable>
        </SettingsGroup>}
        {currentStep === 'server' && <SettingsGroup theme={theme}>{field('serverUrl', t('cloud.serverURL'))}</SettingsGroup>}
        {currentStep === 'account' && <>
          <View>{field('username', t('cloud.username'))}{field('password', t('cloud.password'))}
            {field('remoteDirectory', t('cloud.remoteDirectory'))}
            <SettingsNote theme={theme}>{t('cloud.setup.directoryHint')}</SettingsNote>
          </View>
          <SettingsNote theme={theme}>{t('mobile.sync.secureStorage')}</SettingsNote>
        </>}
        {currentStep === 'sync' && <>
          <SettingsGroup theme={theme}>
            <SettingsValueRow title={t('cloud.provider')} value={providerName} theme={theme} />
            {!!profile.username && <SettingsValueRow title={t('cloud.username')} value={maskedSyncAccount(profile.username)} theme={theme} />}
            <SettingsValueRow title={t('cloud.remoteDirectory')} value={profile.remoteDirectory || '/'} theme={theme} last />
          </SettingsGroup>
          <SettingsGroup theme={theme}>
            <SettingsSwitchRow title={t('fontLocation.autoDownload')} detail={t('fontLocation.autoDownloadHint')} theme={theme}
              value={controller.state?.automaticDownload ?? false} disabled={disabled} onChange={(enabled) => { void controller.run(() => cloudSync.setAutomaticDownload(enabled),false); }} />
            <SettingsSwitchRow title={t('cloud.autoSync')} detail={t('mobile.sync.automaticHint')} theme={theme}
              value={profile.automatic} disabled={disabled} onChange={(automatic) => updateProfile({ automatic })} last />
          </SettingsGroup>
        </>}
        {!!(error || message) && <Text accessibilityLiveRegion="polite" style={[styles.feedback, { color: error ? theme.danger : theme.secondary }]}>{t(error ?? message!)}</Text>}
        {currentStep !== 'provider' && <Pressable accessibilityRole="button" accessibilityLabel={primaryTitle}
          accessibilityState={{ disabled, busy: primaryBusy }} disabled={disabled}
          onPress={() => { if (currentStep === 'sync') { void action('save'); } else { void next(); } }}
          style={({ pressed }) => [styles.primaryAction, { backgroundColor: theme.accent, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}>
          {primaryBusy && <ActivityIndicator size="small" color={theme.onAccent} />}
          <Text style={[styles.primaryLabel, { color: theme.onAccent }]}>{primaryTitle}</Text>
        </Pressable>}
      </Motion.View> : savedProfile && <>
        <SettingsGroup theme={theme} animateLayout footer={expanded ? t('mobile.sync.secureStorage') : undefined}>
          <View style={styles.sourceRow}>
            <SettingsIcon><CloudIcon size={22} color={theme.accent} /></SettingsIcon>
            <Text numberOfLines={1} style={[styles.sourceTitle, { color: theme.label }]}>{savedProvider}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={expanded ? primaryTitle : t('cloud.setup.editConnection')}
              accessibilityState={expanded ? { disabled, busy: pendingAction === 'save' } : { disabled, expanded: false }}
              disabled={disabled} onPress={() => { if (expanded) { void action('save'); } else startEditing(); }}
              style={({ pressed }) => [styles.connectionAction, expanded && styles.saveAction, { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}>
              {expanded && <Text style={[styles.saveLabel, { color: theme.accent }]}>{t('common.save')}</Text>}
              {pendingAction === 'save' ? <ActivityIndicator size="small" color={theme.accent} />
                : expanded ? <CaretUpIcon size={19} color={theme.accent} /> : <CaretRightIcon size={19} color={theme.muted} />}
            </Pressable>
          </View>
          {!expanded && <Motion.View key="account" entering={settingsTransition.entering} exiting={settingsTransition.exiting}
            accessible accessibilityLabel={t('cloud.setup.accountSummary', {
              provider: savedProvider, account: maskedSyncAccount(savedProfile.username) || t('cloud.username'), status: t(connectionStatus),
            })} style={styles.account}>
            {!!savedProfile.username && <UserCircleIcon size={32} color={theme.secondary} />}
            <View style={styles.accountBody}>
              {!!savedProfile.username && <Text numberOfLines={1} style={[styles.accountTitle, { color: theme.label }]}>{maskedSyncAccount(savedProfile.username)}</Text>}
              <Text style={[styles.accountDetail, { color: theme.secondary }]}>{t(connectionStatus)}</Text>
            </View>
          </Motion.View>}
          {expanded && <Motion.View key="form" entering={settingsTransition.entering} exiting={settingsTransition.exiting}>
            {!!(error || message) && <Text accessibilityLiveRegion="polite" style={[styles.feedback, { color: error ? theme.danger : theme.secondary }]}>{t(error ?? message!)}</Text>}
            {field('serverUrl', t('cloud.serverURL'))}{field('remoteDirectory', t('cloud.remoteDirectory'))}
            {field('username', t('cloud.username'))}{field('password', t('cloud.password'))}
            <SettingsSwitchRow title={t('fontLocation.autoDownload')} detail={t('fontLocation.autoDownloadHint')} theme={theme}
              value={controller.state?.automaticDownload ?? false} disabled={disabled} onChange={(enabled) => { void controller.run(() => cloudSync.setAutomaticDownload(enabled),false); }} />
            <SettingsSwitchRow title={t('cloud.autoSync')} detail={t('mobile.sync.automaticHint')} theme={theme}
              value={profile.automatic} disabled={disabled} onChange={(automatic) => updateProfile({ automatic })} />
            <SettingsActionRow title={t('cloud.testConnection')} theme={theme} disabled={disabled}
              busy={pendingAction === 'test'} onPress={() => { void action('test'); }} />
            <SettingsActionRow title={t('common.cancel')} theme={theme} disabled={disabled} onPress={cancelEditing} last />
          </Motion.View>}
        </SettingsGroup>
        {!expanded && <Motion.View key="connectionDetails" {...settingsTransition} style={styles.connectionDetails}>
          <SettingsGroup theme={theme}>
            <SettingsValueRow title={t('cloud.remoteDirectory')} value={savedProfile.remoteDirectory || '/'} theme={theme} last />
          </SettingsGroup>
          <SettingsGroup theme={theme}>
            <SettingsActionRow title={t('cloud.testConnection')} theme={theme} disabled={disabled || !state.credentialAvailable}
              busy={pendingAction === 'test'} onPress={() => { void action('test'); }} last />
          </SettingsGroup>
        </Motion.View>}
      </>}
      {!currentStep && !expanded && !!(error || message) && <Text accessibilityLiveRegion="polite" style={[styles.feedback, { color: error ? theme.danger : theme.secondary }]}>{t(error ?? message!)}</Text>}
      {!!state?.status.isRunning && <SettingsNote theme={theme}>{t('mobile.sync.busyHint')}</SettingsNote>}
      {!!savedProfile && !readError && <Motion.View layout={settingsTransition.layout}>
        <SettingsGroup theme={theme}>
          <SettingsActionRow title={t('cloud.disconnect')} theme={theme} destructive disabled={disabled}
            busy={pendingAction === 'disconnect'} onPress={() => { void action('disconnect'); }} last />
        </SettingsGroup>
      </Motion.View>}
      {!!readError && <SettingsGroup theme={theme}>
        <SettingsActionRow title={t('common.retry')} theme={theme} onPress={() => { void controller.refresh().catch(() => undefined); }} last />
      </SettingsGroup>}
    </SettingsPage>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  setupStep: { gap: settingsLayout.content.gap },
  connectionDetails: { gap: settingsLayout.content.gap },
  heading: { ...settingsLayout.section, gap: 8 },
  step: { ...settingsTypography.section },
  headingTitle: { fontSize: 22, lineHeight: 30, fontWeight: '500' },
  description: { ...settingsTypography.body, fontWeight: '400' },
  provider: { minHeight: 64, ...settingsLayout.row, flexDirection: 'row', alignItems: 'center', gap: 12 },
  providerLabel: { ...settingsTypography.body, flex: 1 },
  sourceRow: { minHeight: 64, paddingLeft: settingsLayout.section.paddingHorizontal, paddingRight: 8 * settingsInsetScale,
    paddingTop: 12 * settingsInsetScale, paddingBottom: 8 * settingsInsetScale,
    flexDirection: 'row', alignItems: 'center', gap: 12 },
  sourceTitle: { ...settingsTypography.body, flex: 1, minWidth: 0 },
  connectionAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  saveAction: { width: 'auto', paddingHorizontal: 12 * settingsInsetScale, flexDirection: 'row', gap: 8 },
  saveLabel: { ...settingsTypography.body },
  account: { ...settingsLayout.section, paddingBottom: 16 * settingsInsetScale, flexDirection: 'row', alignItems: 'center', gap: 12 },
  accountBody: { flex: 1, minWidth: 0, gap: 4 },
  accountTitle: { ...settingsTypography.body },
  accountDetail: { ...settingsTypography.detail },
  field: { ...settingsLayout.formControls, gap: 8 },
  label: { ...settingsTypography.detail, paddingHorizontal: 12 * settingsInsetScale },
  inputRow: { ...settingsLayout.formControl, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  passwordToggle: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minWidth: 0, minHeight: 48, padding: 12 * settingsInsetScale, fontSize: 16, lineHeight: 22 },
  primaryAction: { ...settingsLayout.formControl, minHeight: 48, ...settingsLayout.row,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryLabel: { ...settingsTypography.body, textAlign: 'center', flexShrink: 1 },
  feedback: { ...settingsTypography.detail, ...settingsLayout.section },
});
