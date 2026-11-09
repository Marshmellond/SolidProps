import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("cadweave", {
  request: (method: string, params: unknown = {}) =>
    ipcRenderer.invoke("cad:request", method, params),
  local: (method: string, params: unknown = {}) =>
    ipcRenderer.invoke("local:request", method, params),
  windowControl: (action: "minimize" | "maximize" | "close") =>
    ipcRenderer.send("window:control", action),
  appInfo: () => ipcRenderer.invoke("app:info"),
  openExternal: (url: string) => ipcRenderer.send("external:open", url),
});
