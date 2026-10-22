import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import FontWorkflow from "./FontWorkflow";

const native = vi.hoisted(() => ({ invoke: vi.fn(), handlers: new Map<string, (event: { payload: string }) => void>() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("./scrollbars", () => ({ useAppScrollbars: () => {} }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (name, handler) => { native.handlers.set(name, handler); return () => native.handlers.delete(name); }) }));

const batch = { id: "batch", cancelRequested: false, items: [{ id: "file", name: "字体.ttc", source: "C:/字体/字体.ttc", action: "collectActivate", stage: "activate", status: "failed", errorKey: "workflow.error.operationFailed" }] };
beforeEach(() => {
    native.handlers.clear();
    native.invoke.mockReset().mockImplementation(async (command: string) => command === "workflow_snapshot" ? { batches: [batch], running: false, fontOperations: [] } : "batch");
});

it("重开安装窗口恢复批次，启用失败的重试不重新分析或收集", async () => {
    const first = render(<FontWorkflow />);
    await first.findByRole("heading",{name:"字体.ttc",level:2});
    first.unmount();
    const reopened = render(<FontWorkflow />);
    const retry = await reopened.findByRole("button", { name: "重试" });
    fireEvent.click(retry);
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith("execute_font_batch", { id: "batch", action: "collect", destination: null, retry: true }));
    expect(native.invoke.mock.calls.some(([command]) => command === "analyze_font_inputs")).toBe(false);
});

it("运行中关闭窗口选择继续，只隐藏窗口并保留宿主任务", async () => {
    native.invoke.mockImplementation(async (command: string) => command === "workflow_snapshot" ? { batches: [batch], running: true, fontOperations: [] } : undefined);
    const view = render(<FontWorkflow />);
    await view.findByRole("heading",{name:"字体.ttc",level:2});
    await act(async () => native.handlers.get("workflow-close-requested")?.({ payload: "" }));
    fireEvent.click(await view.findByRole("button", { name: "继续处理" }));
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith("hide_font_workflow"));
    expect(native.invoke.mock.calls.some(([command]) => command === "cancel_font_batch")).toBe(false);
});
