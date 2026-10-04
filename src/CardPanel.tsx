import { useRef, useState } from "react";
import type { Character } from "../shared/characters";
import {
  cardFields,
  type CardFields,
  type CardList,
  type CardPreview,
} from "../shared/cards";
import { desktopBridge } from "./api";
import { Avatar } from "./Avatar";
const labels: Record<keyof CardFields, string> = {
  name: "角色名字",
  description: "角色背景与外貌",
  personality: "性格与说话方式",
  scenario: "聊天情境",
  firstMessage: "开场白",
  exampleDialogue: "对话风格示例",
};
const empty: CardFields = {
  name: "",
  description: "",
  personality: "",
  scenario: "",
  firstMessage: "",
  exampleDialogue: "",
};
export function CardPanel({
  character,
  onChanged,
  onDelete,
  onChangeAvatar,
  onResetAvatar,
}: {
  character: Character;
  onChanged: (list: CardList, id?: string) => void;
  onDelete: (id: string) => void;
  onChangeAvatar?: (id: string) => Promise<void>;
  onResetAvatar?: (id: string) => Promise<void>;
}) {
  const bridge = desktopBridge()!;
  const dialog = useRef<HTMLDialogElement>(null);
  const [fields, setFields] = useState<CardFields>();
  const [editing, setEditing] = useState("new");
  const [preview, setPreview] = useState<CardPreview>();
  const [ack, setAck] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "这次操作未能完成，请重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  function close() {
    if (busy) return;
    void bridge.cancelCard();
    setFields(undefined);
    setPreview(undefined);
    setError("");
    dialog.current?.close();
  }
  async function reload(id?: string) {
    const result = await bridge.cards();
    if (!result.ok) throw Error(result.error);
    onChanged(result.value, id);
  }
  function showPreview(value: CardPreview) {
    setPreview(value);
    setAck(false);
  }
  return (
    <>
      <button
        className="quiet-button"
        aria-label="管理角色"
        onClick={() => dialog.current?.showModal()}
      >
        角色
      </button>
      <dialog
        className="settings-dialog card-dialog"
        ref={dialog}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <button
          className="dialog-close"
          aria-label="关闭角色管理"
          disabled={busy}
          onClick={close}
        >
          ×
        </button>
        <h2>角色</h2>
        <p className="settings-intro">
          导入或创建虚拟角色。
        </p>
        {onChangeAvatar && !fields && !preview && (
          <div className="avatar-editor">
            <Avatar character={character} />
            <button
              className="quiet-button"
              type="button"
              aria-label={`更换${character.name}的头像`}
              disabled={busy}
              onClick={() => void perform(() => onChangeAvatar(character.id))}
            >
              更换头像
            </button>
            {character.avatarUrl &&
              onResetAvatar && (
                <button
                  className="quiet-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void perform(() => onResetAvatar(character.id))}
                >
                  恢复默认
                </button>
              )}
          </div>
        )}
        {!fields && !preview && (
          <div className="card-actions">
            <button
              className="send-button"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const result = await bridge.importCard();
                  if (!result.ok) throw Error(result.error);
                  if (result.value) showPreview(result.value);
                })
              }
            >
              导入 JSON 角色
            </button>
            <button
              className="quiet-button"
              disabled={busy}
              onClick={() => {
                setEditing("new");
                setFields({ ...empty });
              }}
            >
              写一个新角色
            </button>
            <button
              className="quiet-button"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const result = await bridge.editFields(character.id);
                  if (!result.ok) throw Error(result.error);
                  setEditing(character.id);
                  setFields(result.value);
                })
              }
            >
              {character.id.startsWith("card-") ? "编辑" : "复制并编辑"}{" "}
              {character.name}
            </button>
            {character.id.startsWith("card-") && (
              <>
                <button
                  className="quiet-button"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const result = await bridge.exportCard(character.id);
                      if (!result.ok) throw Error(result.error);
                    })
                  }
                >
                  导出原始 JSON
                </button>
                <button
                  className="quiet-button danger"
                  disabled={busy}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `删除${character.name}和这位角色的聊天记录？无法恢复。`,
                      )
                    )
                      return;
                    void perform(async () => {
                      const result = await bridge.deleteCard(character.id);
                      if (!result.ok) throw Error(result.error);
                      onDelete(character.id);
                      await reload("lin");
                    });
                  }}
                >
                  删除这个角色
                </button>
              </>
            )}
            <button
              className="quiet-button"
              disabled={busy}
              onClick={() => void perform(() => reload())}
            >
              重新加载角色文件
            </button>
            <button
              className="quiet-button"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const result = await bridge.openCards();
                  if (!result.ok) throw Error(result.error);
                })
              }
            >
              打开角色文件夹
            </button>
            <p className="field-note">
              内置角色不能覆盖，编辑会创建副本。外部修改 JSON
              后，在这里重新加载；请先备份。
            </p>
          </div>
        )}
        {fields && !preview && (
          <form
            className="connection-form"
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                const result = await bridge.previewCard(editing, fields);
                if (!result.ok) throw Error(result.error);
                showPreview(result.value);
              });
            }}
          >
            {(Object.keys(labels) as (keyof CardFields)[]).map((key) => (
              <div key={key}>
                <label htmlFor={`card-${key}`}>{labels[key]}</label>
                {key === "name" ? (
                  <input
                    id={`card-${key}`}
                    value={fields[key]}
                    required
                    maxLength={256}
                    onChange={(event) =>
                      setFields({ ...fields, [key]: event.target.value })
                    }
                  />
                ) : (
                  <textarea
                    id={`card-${key}`}
                    rows={key === "firstMessage" ? 3 : 4}
                    value={fields[key]}
                    maxLength={key === "firstMessage" ? 4000 : 8000}
                    onChange={(event) =>
                      setFields({ ...fields, [key]: event.target.value })
                    }
                  />
                )}
              </div>
            ))}
            <p className="field-note">
              设定过长会挤占聊天上下文。简短、具体的习惯和语气更容易保持一致。
            </p>
            <button className="send-button" disabled={busy}>
              检查并预览
            </button>
          </form>
        )}
        {preview && (
          <div className="card-preview">
            <h3>{preview.persona.name} · 虚拟角色</h3>
            {(
              Object.entries(cardFields(preview.persona)) as [
                keyof CardFields,
                string,
              ][]
            )
              .filter(([key, value]) => key !== "name" && value)
              .map(([key, value]) => (
                <div key={key}>
                  <strong>{labels[key]}</strong>
                  <p>{value}</p>
                </div>
              ))}
            <p className="field-note">
              设定和开场白按原文使用；宏、HTML、链接和示例文字不会执行。创作者备注不会发给
              AI。
            </p>
            {preview.persona.alternateGreetings.length > 0 && (
              <p role="status">
                此文件含备用开场白，本版只使用主开场白；原始 JSON
                会保留备用内容。
              </p>
            )}
            {preview.warnings.length > 0 && (
              <div className="card-warning" role="status">
                <strong>
                  这些内容不会生效，但会保留在导出的原始 JSON 中：
                </strong>
                <ul>
                  {preview.warnings.map((warning, index) => (
                    <li key={index}>
                      <code>{warning.path}</code> — {warning.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <label className="remember-key">
              <input
                type="checkbox"
                checked={ack}
                onChange={(event) => setAck(event.target.checked)}
              />
              我已检查设定和不支持的内容
            </label>
            <div className="settings-actions">
              <button
                className="send-button"
                disabled={busy || !ack}
                onClick={() =>
                  void perform(async () => {
                    const result = await bridge.saveCard(preview.token, ack);
                    if (!result.ok) throw Error(result.error);
                    await reload(result.value);
                    setFields(undefined);
                    setPreview(undefined);
                    dialog.current?.close();
                  })
                }
              >
                确认保存角色
              </button>
              <button
                className="quiet-button"
                disabled={busy}
                onClick={() => {
                  void bridge.cancelCard();
                  setPreview(undefined);
                }}
              >
                返回
              </button>
            </div>
          </div>
        )}
        <details className="local-data">
          <summary>用 AI 助手维护角色</summary>
          <p>
            先退出栖伴，备份数据位置中的 cards 文件夹和
            history.json。把要改的角色 JSON
            文件交给你信任的助手，说明想调整的习惯、背景或语气。
          </p>
          <p>
            请保留原文件名和格式，只改
            name、description、personality、scenario、first_mes、mes_example。不要把
            API 密钥或 connection.json 交给助手，也不要修改安装目录。
          </p>
          <p>
            保存后重新打开栖伴，在这里点“重新加载角色文件”。已有聊天会保留；想从新设定开始，可单独清空这个角色的聊天。
          </p>
          <p>
            恢复备份时也先退出栖伴，再把 cards 和 history.json
            放回原数据位置。升级会保留同一个数据目录。
          </p>
        </details>
        {busy && <p role="status">正在处理…</p>}
        {error && (
          <p className="chat-error" role="alert">
            {error}
          </p>
        )}
      </dialog>
    </>
  );
}
