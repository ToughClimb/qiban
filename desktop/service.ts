import type { CardStore } from "./cards.js";
import { createProvider } from "../server/provider.js";
import { modelRequest, prepareImageModelRequest, finalText, LIVE_MODEL } from "../server/model.js";
import type { ChatImageResolver } from "../server/image-chat.js";
import { prepareChatContext } from "../shared/chat.js";
import type { Conversations } from "../shared/history.js";
import { conversationInterrupted, requestHistoryBasis, requestBasisInterrupted } from "./history.js";
import { parseChat } from "../server/validation.js";
import type { ChatRequest, Message } from "../shared/characters.js";
import {
  DEFAULT_API_URL,
  type ConnectionInput,
  type ConnectionStatus,
} from "../shared/desktop.js";
import { ConnectionStore, type SavedConnection } from "./store.js";
import {
  ConnectionError,
  normalizeEndpoint,
  requestJson,
  type JsonTransport,
} from "./network.js";
const validModel = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 128 &&
  !/[\u0000-\u001f\u007f]/.test(value);
export class DesktopService {
  private connection: SavedConnection;
  private active = new Map<string, AbortController>();
  private activeCharacter?: string;
  private activeInput?: ChatRequest;
  private activeHistoryBasis?: Message[];
  private configuring = false;
  private setupAbort?: AbortController;
  constructor(
    private store: ConnectionStore,
    private transport: JsonTransport = requestJson,
    private cards?: CardStore,
    private resolveImage?: ChatImageResolver,
  ) {
    this.connection = store.load();
  }
  status(): ConnectionStatus {
    const { baseUrl, model, models, key, remembered, enabled, warning } =
      this.connection;
    return {
      mode: enabled && key && model ? "live" : "demo",
      baseUrl,
      model,
      models,
      hasKey: Boolean(key),
      remembered,
      needsSelection: Boolean(key && !model),
      ...(warning ? { warning } : {}),
    };
  }
  async connect(input: ConnectionInput): Promise<ConnectionStatus> {
    if (
      !input ||
      typeof input !== "object" ||
      Object.keys(input).some(
        (key) => !["baseUrl", "apiKey", "remember"].includes(key),
      ) ||
      typeof input.apiKey !== "string" ||
      typeof input.remember !== "boolean"
    )
      throw new ConnectionError("input", "连接设置格式不正确。");
    if (this.configuring)
      throw new ConnectionError("busy", "正在检查连接，请稍等。");
    const endpoint = normalizeEndpoint(input.baseUrl);
    const baseUrl = endpoint.href.replace(/\/$/, "");
    const key =
      input.apiKey.trim() ||
      (baseUrl === this.connection.baseUrl ? this.connection.key : undefined);
    if (!key || key.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(key))
      throw new ConnectionError(
        "key",
        "请填写有效的 API 密钥。更换地址时需重新填写密钥。",
      );
    this.configuring = true;
    this.cancelAll();
    this.setupAbort = new AbortController();
    const setupSignal = this.setupAbort.signal;
    try {
      let models: string[] = [];
      try {
        const data = (await this.transport(
          new URL("models", endpoint),
          key,
          undefined,
          setupSignal,
        )) as { data?: { id?: unknown }[] };
        if (!Array.isArray(data?.data))
          throw new ConnectionError(
            "unsupported",
            "这个地址没有返回兼容的模型列表。",
          );
        models = [
          ...new Set(data.data.map((item) => item?.id).filter(validModel)),
        ].slice(0, 64);
      } catch (error) {
        if (!(error instanceof ConnectionError) || error.code !== "discovery")
          throw error;
      }
      if (setupSignal.aborted)
        throw new ConnectionError("cancelled", "已取消这次连接。");
      const knownDeepseek = endpoint.hostname === "api.deepseek.com";
      const previous =
        baseUrl === this.connection.baseUrl &&
        validModel(this.connection.model) &&
        (!models.length || models.includes(this.connection.model))
          ? this.connection.model
          : "";
      const model =
        previous ||
        (knownDeepseek ? LIVE_MODEL : models.length === 1 ? models[0] : "");
      const candidate: SavedConnection = {
        baseUrl,
        model,
        models,
        key,
        enabled: true,
        remembered: input.remember,
      };
      this.store.save(candidate, key, input.remember);
      this.connection = candidate;
      return this.status();
    } finally {
      this.configuring = false;
      this.setupAbort = undefined;
    }
  }
  selectModel(model: unknown): ConnectionStatus {
    if (
      !this.connection.key ||
      !validModel(model) ||
      (this.connection.models.length > 0 &&
        !this.connection.models.includes(model))
    )
      throw new ConnectionError(
        "model",
        "请选择服务提供的模型，或填写服务方给出的模型名称。",
      );
    this.cancelAll();
    const candidate = { ...this.connection, model, enabled: true };
    this.store.save(candidate, candidate.key, candidate.remembered);
    this.connection = candidate;
    return this.status();
  }
  demo(): ConnectionStatus {
    this.cancelAll();
    const candidate = { ...this.connection, enabled: false };
    this.store.save(candidate, candidate.key, candidate.remembered);
    this.connection = candidate;
    return this.status();
  }
  deleteKey(): ConnectionStatus {
    this.cancelAll();
    const candidate = {
      ...this.connection,
      key: undefined,
      enabled: false,
      remembered: false,
    };
    this.store.save(candidate, undefined, false);
    this.connection = candidate;
    return this.status();
  }
  deleteData() {
    this.cancelAll();
    this.store.clear();
    this.connection = {
      baseUrl: DEFAULT_API_URL,
      model: "",
      models: [],
      key: undefined,
      enabled: false,
      remembered: false,
    };
  }
  cancel(id: string) {
    this.active.get(id)?.abort();
  }
  cancelAll() {
    this.setupAbort?.abort();
    for (const controller of this.active.values()) controller.abort();
  }
  cancelCharacter(characterId: string) {
    if (this.activeCharacter === characterId) this.cancelAll();
  }
  historySaved(previous: Conversations, saved: Conversations) {
    const owner = this.activeCharacter;
    const input = this.activeInput;
    if (!owner || !input) return;
    // A retry may already have a saved pending user turn. A new Send after a
    // completed reply is not bound to an older coincidentally identical turn.
    if (!this.activeHistoryBasis && previous[owner]?.at(-1)?.role === "user")
      this.activeHistoryBasis = requestHistoryBasis(input, previous[owner]);
    if (this.activeHistoryBasis) {
      if (requestBasisInterrupted(this.activeHistoryBasis, saved[owner])) this.cancelCharacter(owner);
      return;
    }
    if (saved[owner]?.at(-1)?.role === "user")
      this.activeHistoryBasis = requestHistoryBasis(input, saved[owner]);
    if (!this.activeHistoryBasis && conversationInterrupted(previous[owner], saved[owner])) this.cancelCharacter(owner);
  }
  async chat(value: ChatRequest, id: string) {
    let prepared;
    try { prepared = prepareChatContext(value); } catch { /* validated below */ }
    const request = parseChat(
      prepared?.request,
      this.cards ? (id) => this.cards!.has(id) : undefined,
      { allowImages: true },
    );
    if (!request || typeof id !== "string" || !/^[a-z0-9-]{1,64}$/i.test(id))
      throw new ConnectionError(
        "input",
        "消息太长或格式不正确，请编辑后重试。",
      );
    if (this.active.size || this.configuring)
      throw new ConnectionError("busy", "正在等待回复，请稍等。");
    const mode = this.status().mode;
    const hasImages = request.messages.some(message => message.image || message.imageOmitted);
    const deepseek = normalizeEndpoint(this.connection.baseUrl).hostname === "api.deepseek.com" || /^deepseek[-/]/i.test(this.connection.model);
    if (hasImages && (mode !== "live" || !deepseek || this.connection.model !== LIVE_MODEL || !this.resolveImage))
      throw new ConnectionError("image", "图片聊天需要连接支持图片的 deepseek-flash 模型，请先检查连接设置。");
    if (mode === "demo")
      return {
        content: await createProvider({ mode: "demo" }).reply(request),
        mode,
      };
    const controller = new AbortController();
    this.active.set(id, controller);
    this.activeCharacter = request.characterId;
    this.activeInput = structuredClone(request);
    this.activeHistoryBasis = undefined;
    const { key, baseUrl, model } = this.connection;
    try {
      const endpoint = normalizeEndpoint(baseUrl);
      let body;
      let omittedImageIds = prepared!.omittedImageIds;
      try {
        if (hasImages) {
          const imageRequest = await prepareImageModelRequest(value, model, deepseek, this.cards?.persona(request.characterId), this.resolveImage, controller.signal);
          body = imageRequest.body;
          omittedImageIds = imageRequest.omittedImageIds;
        } else body = modelRequest(
          request,
          model,
          endpoint.hostname === "api.deepseek.com" ||
            /^deepseek[-/]/i.test(model),
          this.cards?.persona(request.characterId),
        );
      } catch {
        if (controller.signal.aborted) throw new ConnectionError("cancelled", "已取消这次连接。");
        if (hasImages) throw new ConnectionError("image", "图片或角色设定无法用于这次请求，请重新选择图片或缩短消息后重试。");
        throw new ConnectionError(
          "context",
          "角色设定与消息过长，请缩短角色设定或编辑这条消息后重试。",
        );
      }
      controller.signal.throwIfAborted();
      const data = await this.transport(
        new URL("chat/completions", endpoint),
        key!,
        body,
        controller.signal,
      );
      if (controller.signal.aborted)
        throw new ConnectionError("cancelled", "已取消这次连接。");
      let content: string;
      try {
        content = finalText(data);
      } catch {
        throw new ConnectionError(
          "unsupported",
          "服务没有返回可读的聊天回复，请检查服务设置后重试。",
        );
      }
      return { content, mode, ...(omittedImageIds.length ? { omittedImageIds } : {}) };
    } finally {
      this.active.delete(id);
      this.activeCharacter = undefined;
      this.activeInput = undefined;
      this.activeHistoryBasis = undefined;
    }
  }
}
