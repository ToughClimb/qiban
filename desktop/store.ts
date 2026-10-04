import {
  mkdirSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DEFAULT_API_URL } from "../shared/desktop.js";
import { ConnectionError, normalizeEndpoint } from "./network.js";
export type Encryption = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};
export type SavedConnection = {
  baseUrl: string;
  model: string;
  models: string[];
  enabled: boolean;
  remembered: boolean;
  key?: string;
  warning?: string;
};
export class ConnectionStore {
  private file: string;
  constructor(
    private directory: string,
    private encryption: Encryption,
  ) {
    this.file = join(directory, "connection.json");
  }
  load(): SavedConnection {
    const empty = {
      baseUrl: DEFAULT_API_URL,
      model: "",
      models: [],
      enabled: false,
      remembered: false,
    };
    if (!existsSync(this.file)) return empty;
    try {
      const buffer = readFileSync(this.file);
      if (buffer.length > 32 * 1024) return empty;
      const record = JSON.parse(buffer.toString("utf8"));
      if (record.schema_version !== 1)
        return { ...empty, warning: "连接设置版本无法读取，请重新设置。" };
      const baseUrl = normalizeEndpoint(record.baseUrl).href.replace(/\/$/, "");
      const model =
        typeof record.model === "string" &&
        record.model.length <= 128 &&
        !/[\u0000-\u001f\u007f]/.test(record.model)
          ? record.model
          : "";
      const models = Array.isArray(record.models)
        ? record.models
            .filter(
              (item: unknown) =>
                typeof item === "string" &&
                item.length <= 128 &&
                !/[\u0000-\u001f\u007f]/.test(item),
            )
            .slice(0, 64)
        : [];
      let key: string | undefined;
      if (typeof record.key === "string") {
        try {
          if (!this.encryption.isEncryptionAvailable()) throw new Error();
          key = this.encryption.decryptString(
            Buffer.from(record.key, "base64"),
          );
          if (!key || key.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(key))
            throw new Error();
        } catch {
          return {
            ...empty,
            baseUrl,
            model,
            models,
            warning: "保存的密钥无法读取，请重新填写。",
          };
        }
      }
      return {
        baseUrl,
        model,
        models,
        enabled: record.enabled === true,
        remembered: Boolean(key),
        key,
      };
    } catch {
      return { ...empty, warning: "连接设置无法读取，请重新设置。" };
    }
  }
  save(
    connection: SavedConnection,
    key: string | undefined,
    remember: boolean,
  ) {
    let encrypted: string | undefined;
    if (remember && key) {
      if (!this.encryption.isEncryptionAvailable())
        throw new ConnectionError(
          "storage",
          "这台电脑暂时无法安全保存密钥，请取消“记住密钥”后再试。",
        );
      try {
        encrypted = this.encryption.encryptString(key).toString("base64");
      } catch {
        throw new ConnectionError(
          "storage",
          "密钥无法安全保存，请取消“记住密钥”后再试。",
        );
      }
    }
    try {
      mkdirSync(this.directory, { recursive: true });
      writeFileSync(
        `${this.file}.tmp`,
        JSON.stringify({
          schema_version: 1,
          baseUrl: connection.baseUrl,
          model: connection.model,
          models: connection.models,
          enabled: connection.enabled,
          ...(encrypted ? { key: encrypted } : {}),
        }),
        { mode: 0o600 },
      );
      renameSync(`${this.file}.tmp`, this.file);
    } catch {
      throw new ConnectionError(
        "storage",
        "设置未能保存，请检查磁盘空间后重试。",
      );
    }
  }
  clear() {
    try {
      rmSync(this.file, { force: true });
      rmSync(`${this.file}.tmp`, { force: true });
    } catch {
      throw new ConnectionError(
        "storage",
        "本地设置未能删除，请关闭其他程序后重试。",
      );
    }
  }
}
