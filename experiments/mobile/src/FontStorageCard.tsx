import { MaterialButton } from './MaterialControls';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator } from './UiActivityIndicator';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { locationLabel, transferLabel, type FontFileLocation } from '../../../shared/font-location';
import type { FontFace, FontFamily } from './library';
import { HardDriveIcon } from './icons';
import { SettingsGroup, SettingsIcon, settingsLayout, settingsTypography } from './settings-ui';
import type { Theme } from './ui';
import { FileWorkflowPanel } from './FileWorkflowPanel';
import { PanelAction } from './panel-content';

export type FontFileAction = 'download' | 'cloudOnly' | 'excludeUpload' | 'includeUpload';

// 存放位置沿用云端连接卡的标题、状态和内缩操作区。
export function FontStorageCard({ family, face, theme, onAction }: {
  family: FontFamily; face: FontFace | undefined; theme: Theme;
  onAction: (fingerprint: string, action: FontFileAction) => Promise<void>;
}) {
  const { t } = useTranslation();
  return <SettingsGroup theme={theme}>
    <View style={styles.heading}>
      <SettingsIcon><HardDriveIcon size={22} color={theme.accent} /></SettingsIcon>
      <Text style={[settingsTypography.body, { color: theme.label }]}>{t('fontLocation.title')}</Text>
    </View>
    <View style={styles.overview}>
      <Text style={[styles.status, { color: theme.label }]}>{locationLabel(family.faces, face, t)}</Text>
      {!!face?.location?.cloudConfirmedAtMs && <Text style={[settingsTypography.detail, { color: theme.secondary }]}>
        {t('fontLocation.lastConfirmed', { date: new Date(face.location.cloudConfirmedAtMs).toLocaleString() })}
      </Text>}
    </View>
    {face?.location?.files.map((file) => <FileLocation key={file.fingerprint} file={file} theme={theme} onAction={onAction} />)}
  </SettingsGroup>;
}

function FileLocation({ file, theme, onAction }: {
  file: FontFileLocation; theme: Theme; onAction: (fingerprint: string, action: FontFileAction) => Promise<void>;
}) {
  const { t } = useTranslation();
  const inFlight = useRef(false);
  const [pending, setPending] = useState<FontFileAction | null>(null);
  const [error, setError] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const local = file.localSources.length > 0;
  const transfer = transferLabel(file, t);
  const actions: { action: FontFileAction; label: string; primary?: boolean }[] = [];
  if (file.cloudAvailable && !local) actions.push({ action: 'download', label: t('fontLocation.download'), primary: true });
  if (file.cloudAvailable && local) actions.push({ action: 'cloudOnly', label: t('fontLocation.removeDownload') });
  if (!file.cloudAvailable && !file.uploadExcluded && local) actions.push({ action: 'includeUpload', label: t('cloud.upload'), primary: true });
  if (local) actions.push({ action: file.uploadExcluded ? 'includeUpload' : 'excludeUpload',
    label: t(file.uploadExcluded ? 'fontLocation.resumeUpload' : 'fontLocation.keepLocal'), primary: file.uploadExcluded });
  async function run(action: FontFileAction) {
    if (inFlight.current) return;
    inFlight.current = true; setPending(action); setError(false);
    try { await onAction(file.fingerprint, action); }
    catch { setError(true); }
    finally { inFlight.current = false; setPending(null); }
  }
  return <View style={styles.file}>
    <View style={styles.fileInfo}>
      <Text selectable style={[settingsTypography.body, { color: theme.label }]}>{file.filename}</Text>
      {local && <Text style={[settingsTypography.detail, { color: theme.secondary }]}>{t('fontLocation.localLibrary')}</Text>}
      {!!transfer && <Text accessibilityLiveRegion="polite" style={[settingsTypography.detail, { color: theme.secondary }]}>{transfer}</Text>}
    </View>
    <View style={styles.actions}><PanelAction label={t("workflow.filesTitle")} theme={theme} onPress={() => setFilesOpen(true)} /></View>
    <FileWorkflowPanel visible={filesOpen} theme={theme} onClose={() => setFilesOpen(false)} ids={[`${local ? "local" : "cloud"}/${file.fingerprint}`]} onChanged={() => {}} />
    {actions.length > 0 && <View style={styles.actions}>
      {actions.map(({ action, label, primary }) => theme.ui?.material
        ? <MaterialButton key={action} theme={theme} label={label} primary={primary} disabled={pending !== null} onPress={() => { void run(action); }} fullWidth />
        : <Pressable key={action} accessibilityRole="button"
        accessibilityState={{ disabled: pending !== null, busy: pending === action }} disabled={pending !== null}
        onPress={() => { void run(action); }} style={({ pressed }) => [styles.button,
          { backgroundColor: primary ? theme.accent : theme.raised, opacity: pending && pending !== action ? 0.4 : pressed ? 0.7 : 1 }]}>
        {pending === action && <ActivityIndicator size="small" color={primary ? theme.onAccent : theme.accent} />}
        <Text style={[styles.buttonLabel, { color: primary ? theme.onAccent : theme.accent }]}>{label}</Text>
      </Pressable>)}
      {error && <Text accessibilityRole="alert" style={[settingsTypography.detail, { color: theme.danger }]}>{t('common.operationFailed')}</Text>}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
  overview: { paddingHorizontal: 20, paddingBottom: 16, gap: 8 },
  status: { fontSize: 22, lineHeight: 30, fontWeight: '500' },
  file: { gap: 12, paddingBottom: 16 },
  fileInfo: { paddingHorizontal: 20, gap: 4 },
  actions: { marginHorizontal: 16, gap: 8 },
  button: { borderRadius: settingsLayout.card.borderRadius - 16, minHeight: 44, paddingHorizontal: 16, paddingVertical: 12,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  buttonLabel: { ...settingsTypography.detail, fontSize: 14, lineHeight: 20, fontWeight: '600', textAlign: 'center' },
});
