import { useEffect, useRef, useState, type FormEvent } from "react";
import { desktopBridge } from "./api";
import { DEFAULT_API_URL, type ConnectionStatus } from "../shared/desktop";
import type { Mode } from "../shared/characters";

type Props = {
  onChanged: (mode: Mode) => void;
  onDeleteData: () => Promise<void>;
};
export function ConnectionPanel({ onChanged, onDeleteData }: Props) {
  const bridge = desktopBridge()!;
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<ConnectionStatus>();
  const [baseUrl, setBaseUrl] = useState(DEFAULT_API_URL);
  const [key, setKey] = useState("");
  const [remember, setRemember] = useState(false);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [path, setPath] = useState("");
  const [diagnostics, setDiagnostics] = useState("");
  async function refresh() {
    const result = await bridge.status();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setStatus(result.value);
    setBaseUrl(result.value.baseUrl);
    setRemember(result.value.remembered);
    setModel(result.value.model);
    if (result.value.warning) setError(result.value.warning);
    const location = await bridge.dataPath();
    if (location.ok) setPath(location.value);
  }
  useEffect(() => {
    void refresh();
    try {
      if (localStorage.getItem("qiban.onboarded.v1") !== "yes")
        dialog.current?.showModal();
    } catch {
      dialog.current?.showModal();
    }
    return () => dialog.current?.close();
  }, []);
  function close() {
    setKey("");
    dialog.current?.close();
    try {
      localStorage.setItem("qiban.onboarded.v1", "yes");
    } catch {}
  }
  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    let updatedStatus: ConnectionStatus | undefined;
    try {
      const result =
        status?.hasKey &&
        status.baseUrl === baseUrl &&
        !key &&
        remember === status.remembered
          ? await bridge.selectModel(model)
          : await bridge.connect({ baseUrl, apiKey: key, remember });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setKey("");
      updatedStatus = result.value;
      setBaseUrl(updatedStatus.baseUrl);
      setStatus(updatedStatus);
      // Rediscovery can retain the old model. Apply a valid edit for the same
      // canonical service; never carry a previous service's choice to a new one.
      if (
        status?.baseUrl === updatedStatus.baseUrl &&
        model &&
        model !== updatedStatus.model &&
        (!updatedStatus.models.length || updatedStatus.models.includes(model))
      ) {
        const selection = await bridge.selectModel(model);
        if (!selection.ok) {
          setError(selection.error);
          return;
        }
        updatedStatus = selection.value;
      }
      setStatus(updatedStatus);
      setModel(updatedStatus.model);
      if (!updatedStatus.needsSelection) close();
    } catch {
      setError("这次未能完成连接，请再试一次。");
    } finally {
      if (updatedStatus) onChanged(updatedStatus.mode);
      setBusy(false);
    }
  }
  async function demo() {
    setBusy(true);
    setError("");
    const result = await bridge.demo();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setStatus(result.value);
    onChanged(result.value.mode);
    close();
  }
  async function forget() {
    if (!window.confirm("删除本机保存和当前使用的密钥？聊天记录会保留。"))
      return;
    const result = await bridge.deleteKey();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setKey("");
    setRemember(false);
    setStatus(result.value);
    onChanged(result.value.mode);
  }
  return (
    <>
      <button
        className="quiet-button"
        onClick={() => {
          setError("");
          void refresh();
          dialog.current?.showModal();
        }}
      >
        连接与数据
      </button>
      <dialog
        className="settings-dialog"
        ref={dialog}
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setKey("");
        }}
      >
        <button
          className="dialog-close"
          aria-label="关闭连接设置"
          disabled={busy}
          onClick={close}
        >
          ×
        </button>
        <p className="eyebrow">你的栖伴，你来选择</p>
        <h2>在这里，慢慢聊。</h2>
        <p className="settings-intro">
          先试试演示聊天，或连接自己的 AI 服务。
          <br />
          密钥和聊天只会发送至你填写的服务。
        </p>
        <form onSubmit={connect}>
          <label htmlFor="api-url">服务地址</label>
          <input
            id="api-url"
            type="url"
            autoComplete="off"
            value={baseUrl}
            maxLength={2048}
            onChange={(event) => setBaseUrl(event.target.value)}
            disabled={busy}
            required
          />
          <label htmlFor="api-key">API 密钥</label>
          <input
            id="api-key"
            type="password"
            autoComplete="off"
            value={key}
            maxLength={4096}
            placeholder={
              status?.hasKey
                ? "留空可使用当前密钥；更换地址需重新填写"
                : "粘贴服务方提供的密钥"
            }
            onChange={(event) => setKey(event.target.value)}
            disabled={busy}
          />
          <label className="remember-key">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              disabled={busy}
            />
            仅在这台电脑记住密钥
          </label>
          <p className="field-note">
            默认只在本次打开期间使用。记住时会用系统加密保存；服务费用由服务方收取。
          </p>
          {status?.hasKey && status.baseUrl === baseUrl && (
            <div className="model-selection">
              <label htmlFor="model-choice">
                {status.models.length
                  ? "请选择一个聊天模型"
                  : "填写服务方提供的模型名称"}
              </label>
              {status.models.length ? (
                <select
                  id="model-choice"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  disabled={busy}
                  required
                >
                  <option value="">请选择</option>
                  {status.models.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="model-choice"
                  value={model}
                  maxLength={128}
                  onChange={(event) => setModel(event.target.value)}
                  disabled={busy}
                  required
                />
              )}
              <p className="field-note">
                {status.needsSelection
                  ? "这个服务没有唯一的默认模型，栖伴不会替你随意选择。"
                  : "可以更换聊天模型，或修改手动填写的模型名称。"}
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="chat-error">
              {error}
            </p>
          )}
          <div className="settings-actions">
            <button className="send-button" type="submit" disabled={busy}>
              {busy
                ? "正在检查连接…"
                : status?.hasKey &&
                    status.baseUrl === baseUrl &&
                    !key &&
                    remember === status.remembered
                  ? "使用这个模型"
                  : "连接并开始聊天"}
            </button>
            <button
              className="quiet-button"
              type="button"
              onClick={() => void demo()}
              disabled={busy}
            >
              先用演示聊天
            </button>
          </div>
        </form>
        <details className="local-data">
          <summary>本地数据与隐私</summary>
          <p>
            不会上传到栖伴的服务器。聊天记录以可读文件保存在本机，角色和记录会随升级保留。
          </p>
          <label>数据位置</label>
          <code>{path || "正在读取…"}</code>
          <div className="data-actions">
            <button
              className="quiet-button"
              onClick={() => void forget()}
              disabled={busy || !status?.hasKey}
            >
              删除密钥
            </button>
            <button
              className="quiet-button danger"
              disabled={busy}
              onClick={async () => {
                if (
                  !window.confirm(
                    "删除所有本地聊天和连接设置？无法恢复，请先备份。",
                  )
                )
                  return;
                try {
                  await onDeleteData();
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : "未能删除本地数据，请再试一次。",
                  );
                }
              }}
            >
              删除所有本地数据
            </button>
            <button
              className="quiet-button"
              onClick={async () => {
                const result = await bridge.diagnostics();
                if (result.ok)
                  setDiagnostics(JSON.stringify(result.value, null, 2));
              }}
            >
              查看诊断
            </button>
          </div>
          {diagnostics && (
            <textarea
              className="diagnostics"
              aria-label="已脱敏的诊断信息"
              value={diagnostics}
              readOnly
              rows={7}
            />
          )}
        </details>
      </dialog>
    </>
  );
}
