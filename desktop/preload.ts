import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "../shared/desktop.js";
const bridge: DesktopBridge = {
  status: () => ipcRenderer.invoke("connection:status"),
  connect: (input) => ipcRenderer.invoke("connection:connect", input),
  selectModel: (model) => ipcRenderer.invoke("connection:model", model),
  demo: () => ipcRenderer.invoke("connection:demo"),
  deleteKey: () => ipcRenderer.invoke("connection:delete-key"),
  deleteData: () => ipcRenderer.invoke("data:delete"),
  loadHistory: () => ipcRenderer.invoke("history:load"),
  saveHistory: (value) => ipcRenderer.invoke("history:save", value),
  dataPath: () => ipcRenderer.invoke("data:path"),
  diagnostics: () => ipcRenderer.invoke("diagnostics"),
  chat: (request, id) => ipcRenderer.invoke("chat", request, id),
  cancel: (id) => ipcRenderer.send("chat:cancel", id),
};
contextBridge.exposeInMainWorld("qiban", Object.freeze(bridge));
