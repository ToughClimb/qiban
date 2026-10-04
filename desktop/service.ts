import type { CardStore } from "./cards.js";
import { createProvider } from "../server/provider.js";
import { modelRequest, finalText, LIVE_MODEL } from "../server/model.js";
import { parseChat } from "../server/validation.js";
import type { ChatRequest } from "../shared/characters.js";
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
  private configuring = false;
  private setupAbort?: AbortController;
  constructor(
    private store: ConnectionStore,
    private transport: JsonTransport = requestJson,
    private cards?: CardStore,
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
  async chat(value: ChatRequest, id: string) {
    const request = parseChat(
      value,
      this.cards ? (id) => this.cards!.has(id) : undefined,
    );
    if (!request || typeof id !== "string" || !/^[a-z0-9-]{1,64}$/i.test(id))
      throw new ConnectionError(
        "input",
        "消息太长或格式不正确，请编辑后重试。",
      );
    if (this.active.size || this.configuring)
      throw new ConnectionError("busy", "正在等待回复，请稍等。");
    const mode = this.status().mode;
    if (mode === "demo")
      return {
        content: await createProvider({ mode: "demo" }).reply(request),
        mode,
      };
    const controller = new AbortController();
    this.active.set(id, controller);
    const { key, baseUrl, model } = this.connection;
    try {
      const endpoint = normalizeEndpoint(baseUrl);
      let body;
      try {
        body = modelRequest(
          request,
          model,
          endpoint.hostname === "api.deepseek.com" ||
            /^deepseek[-/]/i.test(model),
          this.cards?.persona(request.characterId),
        );
      } catch {
        throw new ConnectionError(
          "context",
          "角色设定与消息过长，请缩短角色设定或编辑这条消息后重试。",
        );
      }
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
      return { content, mode };
    } finally {
      this.active.delete(id);
    }
  }
}
