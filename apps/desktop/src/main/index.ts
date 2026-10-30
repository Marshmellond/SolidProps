import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { join, resolve } from "node:path";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { WorkerClient } from "./worker-client";
import { StorageClient, LOCAL_METHODS } from "./storage-client";

let window: BrowserWindow | null = null;
let worker: WorkerClient;
let auditBusy = false;
let cadBusy = false;
let lastSnapshot: any = null;
let lastSession: any = null;

function createWindow(): void {
  window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1060,
    minHeight: 680,
    title: "CadWeave · 模型属性工作台",
    backgroundColor: "#F4F5F7",
    frame: false,
    icon: join(__dirname, '../../resources/icons/cadweave.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(window!, {
      type: "warning",
      buttons: ["继续编辑", "放弃本地修改并关闭"],
      defaultId: 0,
      cancelId: 0,
      title: "尚有未提交修改",
      message: "本地编辑尚未写回 CAD，确定关闭吗？",
    });
    if (choice === 1) event.preventDefault();
  });
  window.on("close", (event) => {
    if (worker.isSaving || auditBusy) {
      event.preventDefault();
      void dialog.showMessageBox(window!, {
        type: "warning",
        title: "正在写回 CAD",
        message: "请等待写回结果后再关闭工具，避免无法确认保存状态。",
      });
    }
  });
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.cadweave.desktop");
  const logDirectory = join(app.getPath("userData"), "logs");
  mkdirSync(logDirectory, { recursive: true });
  const log = (text: string): void => {
    appendFileSync(
      join(logDirectory, "worker.log"),
      `${new Date().toISOString()} ${text}\n`,
      "utf8",
    );
  };
  const projectRoot = resolve(__dirname, "../../../..");
  const workerRoot = join(projectRoot, "workers/cad-python");
  worker = app.isPackaged
    ? new WorkerClient(
        join(process.resourcesPath, "cad-worker/cad-worker.exe"),
        [],
        process.resourcesPath,
        log,
      )
    : new WorkerClient(
        join(workerRoot, ".venv/Scripts/python.exe"),
        ["-m", "cad_worker"],
        workerRoot,
        log,
      );
  const storage = new StorageClient(
    app.isPackaged ? join(process.resourcesPath, "cad-worker/cad-worker.exe") : join(workerRoot, ".venv/Scripts/python.exe"),
    app.isPackaged ? [] : ["-m", "cad_worker"],
    app.isPackaged ? process.resourcesPath : workerRoot,
    join(app.getPath("userData"), "cadweave.sqlite3"),
  );
  ipcMain.handle("local:request", (event, method: unknown, params: unknown) => {
    if (event.sender !== window?.webContents) throw new Error("未授权窗口");
    if (typeof method !== "string" || !LOCAL_METHODS.has(method)) throw new Error("不允许的本地操作");
    return storage.request(method, params ?? {});
  });
  ipcMain.handle("cad:request", async (event, method: unknown, params: unknown) => {
    if (event.sender !== window?.webContents) throw new Error("未授权窗口");
    if (typeof method !== "string") throw new Error("无效方法");
    if (cadBusy) throw new Error("CAD 操作进行中，请等待结果");
    cadBusy = true;
    try {
      if (method === "apply") {
        auditBusy = true;
        const value = params as any;
        const snapshot = lastSnapshot;
        if (!snapshot || !lastSession || snapshot.sessionId !== lastSession.id || value?.snapshotId !== snapshot.id)
          throw new Error("快照已失效，请重新读取后提交");
        if (!Array.isArray(value.changes) || !value.changes.length || value.changes.length > 1000)
          throw new Error("无效的变更列表");
        const models = new Map<string, any>(snapshot.models.map((model: any) => [model.id, model]));
        const requested = value.changes.map((change: any) => {
          const model = models.get(change.modelId);
          if (!model) throw new Error("未知模型，拒绝跨快照写入");
          return {
            modelPath: model.path, modelName: model.name, propertyName: change.propertyName,
            operation: change.operation ?? "update", oldValue: change.oldValue, newValue: change.newValue,
            success: null, saved: null, message: "待执行；尚未确认 CAD 写入结果",
          };
        });
        const rootModel = models.get(snapshot.root?.modelId);
        // This durable commit is mandatory BEFORE any request can mutate CAD.
        const pending = await storage.request("audit.begin", {
          title: `写回 CAD · ${snapshot.title}`, detail: `请求 ${requested.length} 项属性变更`,
          cadId: snapshot.cadId, sessionId: lastSession.id, rootPath: rootModel?.path ?? "",
          scope: snapshot.scope, changes: requested,
        }, true);
        let result: any;
        try {
          lastSnapshot = null;
          result = await worker.request(method, params ?? {});
        } catch (error) {
          const detail = `CAD 请求失败；可能发生部分写入，不能认定未保存：${String(error)}`;
          try {
            await storage.request("audit.finish", {
              id: pending.id, status: "unknown", detail,
              changes: requested.map((change: any) => ({ ...change, message: detail })),
            }, true);
          } catch (auditError) {
            throw new Error(`${detail}；审计结果更新失败，持久记录仍为待确认：${String(auditError)}`);
          }
          throw error;
        }
        const outcomes = Array.isArray(result?.results) ? result.results : [];
        const changes = requested.map((change: any, index: number) => {
          const input = value.changes[index];
          const outcome = outcomes.find((entry: any) => entry.modelId === input.modelId && entry.propertyName === input.propertyName);
          return { ...change, success: typeof outcome?.success === "boolean" ? outcome.success : null,
            saved: typeof outcome?.saved === "boolean" ? outcome.saved : null,
            message: typeof outcome?.message === "string" ? outcome.message : "未收到此项结果；写入状态未知" };
        });
        const status = changes.every((change: any) => change.success === true && change.saved === true) ? "success"
          : changes.some((change: any) => change.success === null || change.saved === null) ? "unknown"
          : changes.some((change: any) => change.success) ? "partial" : "failure";
        try {
          await storage.request("audit.finish", { id: pending.id, status, detail: `CAD 返回 ${outcomes.length} 项结果`, changes }, true);
          return { ...result, auditId: pending.id };
        } catch (auditError) {
          // CAD already ran: preserve its exact outcomes rather than misreporting a failed save.
          return { ...result, auditId: pending.id, auditWarning: `CAD 写入结果如下，但审计更新失败（原记录仍为待确认）：${String(auditError)}` };
        }
      }
      if (["connect", "disconnect", "snapshot"].includes(method)) lastSnapshot = null;
      if (["connect", "disconnect"].includes(method)) lastSession = null;
      const result: any = await worker.request(method, params ?? {});
      if (method === "connect") lastSession = result.session;
      if (method === "snapshot") lastSnapshot = result;
      return result;
    } finally {
      auditBusy = false;
      cadBusy = false;
    }
  });
  ipcMain.handle("file:export", async (event, options: unknown) => {
    if (event.sender !== window?.webContents || !window)
      throw new Error("未授权窗口");
    const value = options as { suggestedName?: unknown; content?: unknown };
    if (
      typeof value?.suggestedName !== "string" ||
      typeof value.content !== "string"
    )
      throw new Error("导出参数无效");
    if (Buffer.byteLength(value.content, "utf8") > 20_000_000) throw new Error("导出内容过大（最多20MB UTF-8）");
    const safeName = value.suggestedName
      .replace(/[\\/:*?"<>|]/g, "_")
      .slice(0, 120);
    const result = await dialog.showSaveDialog(window, {
      defaultPath: safeName,
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    writeFileSync(result.filePath, value.content, "utf8");
    return { cancelled: false, path: result.filePath };
  });
  ipcMain.on("window:control", (event, action: unknown) => {
    if (event.sender !== window?.webContents || !window) return;
    if (action === "minimize") window.minimize();
    else if (action === "maximize")
      window.isMaximized() ? window.unmaximize() : window.maximize();
    else if (action === "close") window.close();
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (worker?.isSaving || auditBusy) {
    event.preventDefault();
    return;
  }
  worker?.close();
});
