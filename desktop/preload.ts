import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "../shared/desktop.js";
const bridge: DesktopBridge = {
  cards: () => ipcRenderer.invoke("cards:list"),
  importCard: () => ipcRenderer.invoke("cards:import"),
  editFields: (id) => ipcRenderer.invoke("cards:fields", id),
  previewCard: (id, fields) => ipcRenderer.invoke("cards:preview", id, fields),
  saveCard: (token, acknowledged) =>
    ipcRenderer.invoke("cards:save", token, acknowledged),
  cancelCard: () => ipcRenderer.invoke("cards:cancel"),
  exportCard: (id) => ipcRenderer.invoke("cards:export", id),
  deleteCard: (id) => ipcRenderer.invoke("cards:delete", id),
  openCards: () => ipcRenderer.invoke("cards:open"),
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
