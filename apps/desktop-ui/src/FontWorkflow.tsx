// 独立字体安装窗口；任务与结果由宿主持有。
import { useCallback, useEffect, useState } from "react";
import { Button, Input, Label, Modal, TextField, Toolbar } from "@heroui/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { OptionSelect } from "./components/SettingsControls";
import { useAppScrollbars } from "./scrollbars";
type Item = {
    id: string;
    name: string;
    source: string;
    action: string;
    stage: string;
    status: string;
    errorKey?: string;
    destination?: string;
    analysis?: {
        format: string;
        faces: {
            family?: string;
            style?: string;
            faceIndex: number;
            duplicate: boolean;
            conflict: boolean;
        }[];
    };
};
type Batch = {
    id: string;
    items: Item[];
    cancelRequested: boolean;
};
type Snapshot = {
    batches: Batch[];
    running: boolean;
    fontOperations: {
        id: string;
        sourcePath: string;
        installedPath: string;
        persistent: boolean;
    }[];
};
const actions = ["reference", "collect", "activate", "install", "collectActivate", "export"];
export default function FontWorkflow() {
    const { t } = useTranslation();
    const [snapshot, setSnapshot] = useState<Snapshot>({ batches: [], running: false, fontOperations: [] });
    const [selected, setSelected] = useState("");
    const [action, setAction] = useState("collect");
    const [error, setError] = useState<string | null>(null);
    const [rename, setRename] = useState("");
    const [closing, setClosing] = useState(false);
    useAppScrollbars();
    const read = useCallback(async () => { const value = await invoke<Snapshot>("workflow_snapshot"); setSnapshot(value); setSelected((old) => old || value.batches[0]?.id || ""); }, []);
    const report = useCallback((cause: unknown) => { const key = typeof cause === "string" && cause.startsWith("workflow.") ? cause : "workflow.error.operationFailed"; setError(t(key)); }, [t]);
    useEffect(() => {
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        const update = () => { document.documentElement.dataset.theme = media.matches ? "dark" : "light"; document.documentElement.classList.toggle("dark", media.matches); };
        update();
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, []);
    useEffect(() => {
        let alive = true;
        const unsubscribers = [listen("workflow-changed", () => { if (alive)
                void read().catch(report); }), listen("workflow-close-requested", () => { if (alive)
                setClosing(true); })];
        void invoke<Snapshot>("workflow_snapshot").then((value) => { if (alive) {
            setSnapshot(value);
            setSelected(value.batches[0]?.id ?? "");
        } }).catch(report);
        return () => { alive = false; for (const pending of unsubscribers)
            void pending.then((off) => off()); };
    }, [read, report]);
    const batch = snapshot.batches.find((value) => value.id === selected) ?? snapshot.batches[0];
    const conflict = batch?.items.find((item) => item.status === "awaitingDecision");
    async function add() { try {
        const paths = await open({ multiple: true, filters: [{ name: t("workflow.fontFiles"), extensions: ["ttf", "otf", "ttc", "otc"] }] });
        if (!paths)
            return;
        await invoke("analyze_font_inputs", { paths: typeof paths === "string" ? [paths] : paths });
        await read();
    }
    catch (cause) {
        report(cause);
    } }
    async function execute(retry = false) { if (!batch)
        return; try {
        setError(null);
        let destination: string | null = null;
        if (action === "export" && !retry) {
            const selected = await open({ directory: true });
            if (typeof selected !== "string")
                return;
            destination = selected;
        }
        const target = await invoke<string>("execute_font_batch", { id: batch.id, action, destination, retry });
        setSelected(target);
        await read();
    }
    catch (cause) {
        report(cause);
    } }
    async function resolve(name: string | null) { if (!batch || !conflict)
        return; try {
        await invoke("resolve_export_conflict", { id: batch.id, itemId: conflict.id, name });
        setRename("");
        await read();
    }
    catch (cause) {
        report(cause);
    } }
    async function cancel() { if (!batch)
        return; try {
        await invoke("cancel_font_batch", { id: batch.id });
        await read();
    }
    catch (cause) {
        report(cause);
    } }
    async function removeOperation(path: string, persistent: boolean) { try {
        await invoke("analyze_font_inputs", { paths: [path] });
        const value = await invoke<Snapshot>("workflow_snapshot");
        const target = value.batches.find((value) => value.items.some((item) => item.source === path));
        if (target)
            await invoke("execute_font_batch", { id: target.id, action: persistent ? "uninstall" : "deactivate", destination: null, retry: false });
        await read();
    }
    catch (cause) {
        report(cause);
    } }
    return <main className="workflow-window">
    <h1>{t("workflow.title")}</h1>
    <Toolbar aria-label={t("workflow.title")}><Button onPress={() => void add()}>{t("workflow.addFiles")}</Button>
      {snapshot.batches.length > 0 && <OptionSelect label={t("workflow.batch")} value={batch?.id ?? ""} onChange={setSelected} options={snapshot.batches.map((value) => ({ id: value.id, label: value.items.map((item) => item.name).join("、") }))}/>}</Toolbar>
    {error && <p role="alert">{error}</p>}
    <div className="workflow-list">
      {!batch && <p>{t("workflow.empty")}</p>}
      {batch?.items.map((item) => <section key={item.id} className="workflow-item"><h2>{item.name}</h2><p>{item.source}</p>
        {item.analysis && <><p>{item.analysis.format}</p>{item.analysis.faces.map((face) => <p key={face.faceIndex}>{face.family} · {face.style} · {t("workflow.faceIndex", { index: face.faceIndex })}{face.duplicate ? ` · ${t("workflow.duplicate")}` : ""}{face.conflict ? ` · ${t("workflow.revisionConflict")}` : ""}</p>)}</>}
        {item.action === "collectActivate" && item.stage === "activate" && <p>{t("workflow.actions.collect")} · {t("workflow.status.succeeded")}</p>}<p role="status">{item.action === "collectActivate" && item.stage === "activate" ? `${t("workflow.actions.activate")} · ` : ""}{t(`workflow.status.${item.status}`)}{item.errorKey ? ` · ${t(item.errorKey)}` : ""}</p></section>)}
      {snapshot.fontOperations.map((operation) => <section key={operation.id} className="workflow-item"><p>{operation.sourcePath}</p><Button isDisabled={snapshot.running} onPress={() => void removeOperation(operation.installedPath, operation.persistent)}>{t(operation.persistent ? "workflow.actions.uninstall" : "workflow.actions.deactivate")}</Button></section>)}
    </div>
    {batch && <Toolbar aria-label={t("workflow.actionsLabel")}><OptionSelect label={t("workflow.actionsLabel")} value={action} onChange={setAction} isDisabled={snapshot.running} options={actions.map((id) => ({ id, label: t(`workflow.actions.${id}`) }))}/>
      <Button isDisabled={snapshot.running} onPress={() => void execute()}>{t("workflow.execute")}</Button><Button isDisabled={snapshot.running || !batch.items.some((item) => item.status === "failed")} onPress={() => void execute(true)}>{t("common.retry")}</Button><Button onPress={() => void cancel()}>{t("common.cancel")}</Button></Toolbar>}
    <Modal isOpen={!!conflict}><Modal.Backdrop><Modal.Container><Modal.Dialog><Modal.Header><Modal.Heading>{t("workflow.nameConflictTitle")}</Modal.Heading></Modal.Header><Modal.Body><p>{conflict?.name}</p><TextField value={rename} onChange={setRename}><Label>{t("common.name")}</Label><Input /></TextField></Modal.Body><Modal.Footer><Button onPress={() => void resolve(null)}>{t("workflow.skip")}</Button><Button isDisabled={!rename.trim()} onPress={() => void resolve(rename)}>{t("workflow.rename")}</Button><Button onPress={() => void cancel()}>{t("workflow.cancelRemaining")}</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
    <Modal isOpen={closing} onOpenChange={setClosing}><Modal.Backdrop><Modal.Container><Modal.Dialog><Modal.Header><Modal.Heading>{t("workflow.closeTitle")}</Modal.Heading></Modal.Header><Modal.Body>{t("workflow.closeBody")}</Modal.Body><Modal.Footer><Button onPress={() => { setClosing(false); void invoke("hide_font_workflow"); }}>{t("workflow.continueTask")}</Button><Button onPress={() => { void cancel().then(() => invoke("hide_font_workflow")); setClosing(false); }}>{t("workflow.cancelRemaining")}</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
  </main>;
}
