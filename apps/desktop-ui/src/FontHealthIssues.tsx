// 文件级健康明细包含未解析出字款的损坏来源。
import { useEffect, useState } from "react";
import { Button } from "@heroui/react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { revealFontSource } from "./api";
type Health = {
    scanned: boolean;
    issues: {
        path: string | null;
        kind: string;
    }[];
};
export function FontHealthIssues({ onRecheck }: {
    onRecheck: () => Promise<void>;
}) {
    const { t } = useTranslation();
    const [health, setHealth] = useState<Health | null>(null);
    const [error, setError] = useState(false);
    const [busy, setBusy] = useState(false);
    useEffect(() => { let alive = true; void invoke<Health>("font_health_issues").then((value) => { if (alive)
        setHealth(value); }).catch(() => { if (alive)
        setError(true); }); return () => { alive = false; }; }, []);
    async function recheck() { setBusy(true); setError(false); try {
        await onRecheck();
        setHealth(await invoke<Health>("font_health_issues"));
    }
    catch {
        setError(true);
    }
    finally {
        setBusy(false);
    } }
    return <section aria-label={t("workflow.health")}>
    {health && !health.scanned && <p>{t("workflow.notScanned")}</p>}
    {health?.issues.map((issue, index) => <div key={`${issue.path}-${index}`}><span>{issue.path} · {t(`import.issueKinds.${issue.kind}`, { defaultValue: t("workflow.error.invalidFont") })}</span>{issue.path && <Button size="sm" onPress={() => { void revealFontSource(issue.path!).catch(() => setError(true)); }}>{t("workflow.reveal")}</Button>}</div>)}
    {error && <p role="alert">{t("workflow.error.operationFailed")}</p>}
    <Button isDisabled={busy} onPress={() => void recheck()}>{t("workflow.refresh")}</Button>
  </section>;
}
