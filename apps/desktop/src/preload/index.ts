import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("cadweave", {
  request: (method: string, params: unknown = {}) =>
    ipcRenderer.invoke("cad:request", method, params),
  local: (method: string, params: unknown = {}) =>
    ipcRenderer.invoke("local:request", method, params),
  exportFile: (options: { suggestedName: string; content: string }) =>
    ipcRenderer.invoke("file:export", options),
  windowControl: (action: "minimize" | "maximize" | "close") =>
    ipcRenderer.send("window:control", action),
});
