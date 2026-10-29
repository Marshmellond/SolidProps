import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { join, resolve } from "node:path";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { WorkerClient } from "./worker-client";

let window: BrowserWindow | null = null;
let worker: WorkerClient;

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
    if (worker.isSaving) {
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
  ipcMain.handle("cad:request", (event, method: unknown, params: unknown) => {
    if (event.sender !== window?.webContents) throw new Error("未授权窗口");
    if (typeof method !== "string") throw new Error("无效方法");
    return worker.request(method, params ?? {});
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
    if (value.content.length > 20_000_000) throw new Error("导出内容过大");
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
  if (worker?.isSaving) {
    event.preventDefault();
    return;
  }
  worker?.close();
});
