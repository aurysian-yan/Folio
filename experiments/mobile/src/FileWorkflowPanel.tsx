import { DialogContent, usePanelDialog } from './Dialogs';
import { FilterScrollView } from './FilterDrawer';
// 文件操作、外部授权和可恢复结果复用现有面板。
import { useEffect, useState, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { cancelFileWorkflow, fileWorkflow, fileState, removeExternalSource, syncSession } from './native';
import { LibraryPanel } from './LibraryPanel';
import { PanelAction, PanelSection } from './panel-content';
import type { Theme } from './ui';
interface InboxAnalysis {
    name: string;
    status: string;
    messageKey?: string;
    analysis?: string;
}
interface FileState {
    sources: {
        id: string;
        displayName: string;
        available: boolean;
        unavailableReason?: string;
    }[];
    batches: {
        id: string;
        items: {
            id: string;
            name: string;
            source: string;
            status: string;
            errorKey?: string;
        }[];
    }[];
    health: {
        scanned: boolean;
        issues: {
            path: string | null;
            kind: string;
        }[];
        sources: {
            id: string;
            name: string;
            kind: string;
        }[];
    };
    inbox: {
        id: string;
        names: string[];
    }[];
}
export function FileWorkflowPanel({ visible, theme, onClose, onCollect, onChanged, parent = 'local', ids }: {
    visible: boolean;
    theme: Theme;
    onClose: () => void;
    onCollect?: () => void;
    onChanged: () => void;
    parent?: string;
    ids?: string[];
}) {
    const { dialog, alert, dismiss } = usePanelDialog();
  const { t } = useTranslation();
    const activeRequest = useRef('');
    const [state, setState] = useState<FileState | null>(null);
    const [busy, setBusy] = useState(false);
    const [inboxAnalysis, setInboxAnalysis] = useState<Record<string, InboxAnalysis[]>>({});
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        let alive = true;
        if (visible)
            void (async () => {
                try {
                    const value = JSON.parse(await fileState()) as FileState;
                    if (!alive)
                        return;
                    setState(value);
                    setBusy(true);
                    for (const item of value.inbox) {
                        if (!alive)
                            break;
                        const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
                        activeRequest.current = requestId;
                        const result = JSON.parse(await fileWorkflow(JSON.stringify({ action: 'analyzeInbox', inboxId: item.id, requestId }))) as {
                            items: InboxAnalysis[];
                        };
                        if (alive)
                            setInboxAnalysis((previous) => ({ ...previous, [item.id]: result.items }));
                    }
                }
                catch {
                    if (alive)
                        setError(t('workflow.error.operationFailed'));
                }
                finally {
                    if (alive)
                        setBusy(false);
                }
            })();
        return () => { alive = false; };
    }, [visible, t]);
    async function run(action: string, extra: Record<string, unknown> = {}) {
        if (busy)
            return;
        const mutating = ['importFiles', 'importFolder', 'referenceFiles', 'referenceFolder', 'collectInbox'].includes(action);
        const release = mutating ? syncSession.reserveImport() : undefined;
        if (mutating && !release) {
            setError(t('workflow.error.busy'));
            return;
        }
        setBusy(true);
        setError(null);
        const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        activeRequest.current = requestId;
        try {
            await fileWorkflow(JSON.stringify({ action, parent, ids, ...extra, requestId }));
            setState(JSON.parse(await fileState()) as FileState);
            if (mutating || action === 'refresh')
                onChanged();
        }
        catch (cause) {
            const key = String(cause).match(/workflow\.error\.\w+/)?.[0] ?? 'workflow.error.operationFailed';
            setError(t(key));
        }
        finally {
            release?.();
            setBusy(false);
        }
    }
    function remove(id: string) { alert(t('common.remove'), t('workflow.sources'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.remove'), style: 'destructive', onPress: () => { setBusy(true); void removeExternalSource(id).then(() => fileState()).then((value) => { setState(JSON.parse(value) as FileState); onChanged(); }).catch(() => setError(t('workflow.error.operationFailed'))).finally(() => setBusy(false)); } }]); }
  if (dialog) return <LibraryPanel visible={visible} title={dialog.title} theme={theme} backButton onBack={dismiss} onClose={() => { dismiss(); onClose(); }}>
    <DialogContent dialog={dialog} theme={theme} onSelect={(button) => { dismiss(); button.onPress?.(); }} />
  </LibraryPanel>;
    return <LibraryPanel visible={visible} theme={theme} title={t('workflow.filesTitle')} onClose={onClose} busy={busy}>
    <FilterScrollView contentContainerStyle={styles.content}>
      {busy && <><ActivityIndicator color={theme.accent}/><PanelAction label={t('common.cancel')} theme={theme} onPress={() => { void cancelFileWorkflow(activeRequest.current); }}/></>}
      {error && <Text accessibilityRole="alert" style={{ color: theme.danger }}>{error}</Text>}
      <PanelSection title={t('import.importFonts')} theme={theme}>
        <PanelAction label={t('workflow.actions.collect')} theme={theme} disabled={busy} onPress={onCollect ?? (() => { void run('importFiles'); })}/>
        <PanelAction label={t('workflow.collectFolder')} theme={theme} disabled={busy} onPress={() => { void run('importFolder'); }}/>
        <PanelAction label={t('workflow.referenceFiles')} theme={theme} disabled={busy} onPress={() => { void run('referenceFiles'); }}/>
        <PanelAction label={t('workflow.referenceFolder')} theme={theme} disabled={busy} onPress={() => { void run('referenceFolder'); }}/>
      </PanelSection>
      <PanelSection title={t('workflow.exportFiles')} theme={theme}>
        <PanelAction label={t('workflow.exportFiles')} theme={theme} disabled={busy} onPress={() => { void run('exportFiles'); }}/>
        <PanelAction label={t('workflow.shareFiles')} theme={theme} disabled={busy} onPress={() => { void run('shareFiles'); }}/>
      </PanelSection>
      {!!state?.inbox.length && <PanelSection title={t('workflow.pendingShare')} theme={theme}>{state.inbox.map((item) => <View key={item.id}><Text style={{ color: theme.label }}>{item.names.map((name) => name.slice(37)).join('、')}</Text>{inboxAnalysis[item.id]?.map((font, index) => <View key={index}><Text style={{ color: theme.label }}>{font.name}</Text>{font.analysis && (JSON.parse(font.analysis) as {
                        faces: {
                            family: string;
                            style: string;
                            faceIndex: number;
                            duplicate: boolean;
                            conflict: boolean;
                        }[];
                    }).faces.map((face) => <Text key={face.faceIndex} style={{ color: theme.secondary }}>{face.family} · {face.style} · {t('workflow.faceIndex', { index: face.faceIndex })}{face.duplicate ? ` · ${t('workflow.duplicate')}` : ''}{face.conflict ? ` · ${t('workflow.revisionConflict')}` : ''}</Text>)}{font.messageKey && <Text style={{ color: theme.secondary }}>{t(font.messageKey)}</Text>}</View>)}<PanelAction label={t('workflow.confirmCollect')} theme={theme} disabled={busy || !inboxAnalysis[item.id]} onPress={() => { void run('collectInbox', { inboxId: item.id }); }}/></View>)}</PanelSection>}
      {!!state?.sources.length && <PanelSection title={t('workflow.sources')} theme={theme}>{state.sources.map((source) => <View key={source.id} style={styles.item}><Text style={{ color: theme.label }}>{source.displayName}</Text>{!source.available && <Text style={{ color: theme.secondary }}>{t(`workflow.sourceState.${source.unavailableReason ?? 'unavailable'}`)}</Text>}<PanelAction label={t('workflow.reconnect')} theme={theme} disabled={busy} onPress={() => alert(t('workflow.reconnect'), source.displayName, [{ text: t('workflow.referenceFiles'), onPress: () => { void run('referenceFiles', { sourceId: source.id }); } }, { text: t('workflow.referenceFolder'), onPress: () => { void run('referenceFolder', { sourceId: source.id }); } }, { text: t('common.cancel'), style: 'cancel' }])}/><PanelAction label={t('common.remove')} theme={theme} disabled={busy} destructive onPress={() => remove(source.id)}/></View>)}</PanelSection>}
      <PanelSection title={t('workflow.health')} theme={theme} initiallyExpanded={false}>
        {state && !state.health.scanned && <Text style={{ color: theme.secondary }}>{t('workflow.notScanned')}</Text>}
        {state?.health.issues.map((issue, index) => <Text key={`${issue.path}-${index}`} style={{ color: theme.label }}>{issue.path} · {t(`import.issueKinds.${issue.kind}`, { defaultValue: t('workflow.error.invalidFont') })}</Text>)}
        {state?.health.sources.map((source) => <Text key={source.id} style={{ color: theme.label }}>{source.name} · {t(`workflow.sourceState.${source.kind}`, { defaultValue: t('workflow.unavailable') })}</Text>)}
        <PanelAction label={t('workflow.refresh')} theme={theme} disabled={busy} onPress={() => { void run('refresh'); }}/>
      </PanelSection>
      {!!state?.batches.length && <PanelSection title={t('import.importResults')} theme={theme} initiallyExpanded={false}>{state.batches.map((batch) => <View key={batch.id} style={styles.item}>{batch.items.map((item) => <Text key={item.id} style={{ color: theme.label }}>{item.name} · {t(`workflow.status.${item.status}`)}{item.errorKey ? ` · ${t(item.errorKey)}` : ''}</Text>)}{batch.items.some((item) => ['failed', 'awaitingDecision', 'running'].includes(item.status)) && <PanelAction label={t('common.retry')} theme={theme} disabled={busy} onPress={() => { void run('exportFiles', { ids: batch.items.filter((item) => ['failed', 'awaitingDecision', 'running'].includes(item.status)).map((item) => item.source) }); }}/>}</View>)}</PanelSection>}
    </FilterScrollView>
  </LibraryPanel>;
}
const styles = StyleSheet.create({ content: { paddingHorizontal: 16, paddingBottom: 16, gap: 16 }, item: { gap: 8, paddingVertical: 12 } });
