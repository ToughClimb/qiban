import type { ChatImageDraft } from "./image-chat.js";
import type { CardFields, CardList, CardPreview } from "./cards.js";
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
export type ChatReply = { content: string; mode: Mode; omittedImageIds?: string[] };
export type DesktopBridge = {
  pickChatImage?(characterId: string): Promise<Result<ChatImageDraft | null>>;
  chatImagePreview?(characterId: string, imageId: string): Promise<Result<string | null>>;
  discardChatImage?(characterId: string, imageId: string): Promise<Result<void>>;
  importAvatar?(id: string): Promise<Result<string | null>>;
  deleteAvatar?(id: string): Promise<Result<void>>;
  cards(): Promise<Result<CardList>>;
  importCard(): Promise<Result<CardPreview | null>>;
  editFields(id: string): Promise<Result<CardFields>>;
  previewCard(id: string, fields: CardFields): Promise<Result<CardPreview>>;
  saveCard(token: string, acknowledged: boolean): Promise<Result<string>>;
  cancelCard(): Promise<Result<void>>;
  exportCard(id: string): Promise<Result<void>>;
  deleteCard(id: string): Promise<Result<void>>;
  openCards(): Promise<Result<void>>;
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
  ): Promise<Result<ChatReply>>;
  cancel(id: string): void;
};
