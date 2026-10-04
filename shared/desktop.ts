import type { Conversations } from "./history.js";
import type { ChatRequest, Mode } from "./characters.js";
export const DEFAULT_API_URL = "https://api.deepseek.com";
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export type ConnectionStatus = {
  mode: Mode;
  baseUrl: string;
  model: string;
  models: string[];
  hasKey: boolean;
  remembered: boolean;
  needsSelection: boolean;
  warning?: string;
};
export type ConnectionInput = {
  baseUrl: string;
  apiKey: string;
  remember: boolean;
};
export type DesktopBridge = {
  loadHistory(): Promise<Result<Conversations>>;
  saveHistory(value: Conversations): Promise<Result<void>>;
  dataPath(): Promise<Result<string>>;
  diagnostics(): Promise<Result<Record<string, string | number | boolean>>>;
  status(): Promise<Result<ConnectionStatus>>;
  connect(input: ConnectionInput): Promise<Result<ConnectionStatus>>;
  selectModel(model: string): Promise<Result<ConnectionStatus>>;
  demo(): Promise<Result<ConnectionStatus>>;
  deleteKey(): Promise<Result<ConnectionStatus>>;
  deleteData(): Promise<Result<void>>;
  chat(
    request: ChatRequest,
    id: string,
  ): Promise<Result<{ content: string; mode: Mode }>>;
  cancel(id: string): void;
};
