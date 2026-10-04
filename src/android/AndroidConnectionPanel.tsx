import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { AppearancePanel } from "../AppearancePanel";
import { applyAccent, storedAccent } from "../appearance";
import { DEFAULT_API_URL, type ConnectionStatus } from "../../shared/desktop";
import type { Mode } from "../../shared/characters";

export function AndroidConnectionPanel({
  onChanged,
  onDeleteData,
}: {
  onChanged: (mode: Mode) => void;
  onDeleteData: () => Promise<void>;
}) {
  const native = window.qibanAndroid!;
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<ConnectionStatus>();
  const [baseUrl, setBaseUrl] = useState(DEFAULT_API_URL);
  const [model, setModel] = useState("");
  const [remember, setRemember] = useState(false);
  const [replaceKey, setReplaceKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useLayoutEffect(() => applyAccent(storedAccent()), []);
  function apply(value: ConnectionStatus) {
    setStatus(value);
    setBaseUrl(value.baseUrl);
    setModel(value.model);
    setRemember(value.remembered);
  }
  async function refresh() {
    try {
      const result = await native.status();
      if (result.ok) apply(result.value);
      else setError(result.error);
    } catch {
      setError("连接设置暂时无法读取，请重试。");
    }
  }
  useEffect(() => {
    void refresh();
    let onboarded = false;
    try {
      onboarded = localStorage.getItem("qiban.onboarded.v1") === "yes";
    } catch {
      /* Show onboarding when storage is unavailable. */
    }
    if (!onboarded) dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  function close() {
    dialog.current?.close();
    setReplaceKey(false);
    try {
      localStorage.setItem("qiban.onboarded.v1", "yes");
    } catch {
      /* Does not block offline chat. */
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      let result =
        status?.hasKey &&
        status.baseUrl === baseUrl &&
        !replaceKey &&
        remember === status.remembered
          ? await native.selectModel({ model })
          : await native.connect({
              baseUrl,
              remember,
              promptForKey:
                replaceKey || !status?.hasKey || baseUrl !== status.baseUrl,
            });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const connected = result.value;
      apply(connected);
      setReplaceKey(false);
      // Key reentry/discovery can preserve an old model; keep a valid user edit.
      if (
        status?.baseUrl === connected.baseUrl &&
        model &&
        model !== connected.model &&
        (!connected.models.length || connected.models.includes(model))
      ) {
        result = await native.selectModel({ model });
        if (!result.ok) {
          setModel(model);
          setError(result.error);
          onChanged(connected.mode);
          return;
        }
        apply(result.value);
      }
      onChanged(result.value.mode);
      if (!result.value.needsSelection) close();
    } catch {
      setError("这次连接没有完成，请再试一次。");
    } finally {
      setBusy(false);
    }
  }
  async function demo() {
    setBusy(true);
    setError("");
    try {
      const result = await native.demo();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      apply(result.value);
      onChanged(result.value.mode);
      close();
    } catch {
      setError("演示暂时未能打开，请重试。");
    } finally {
      setBusy(false);
    }
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
        <p className="eyebrow">把伙伴带在身边</p>
        <h2>先聊聊，再慢慢设置。</h2>
        <p className="settings-intro">
          演示聊天不需要密钥，也不会联网。连接 AI
          时，密钥只在手机本机使用，聊天会发送给你选择的服务。
        </p>
        <form onSubmit={submit}>
          <label htmlFor="android-api-url">服务地址</label>
          <input
            id="android-api-url"
            type="url"
            autoComplete="off"
            maxLength={2048}
            required
            disabled={busy}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
          <p className="field-note">
            连接时会打开手机上的密钥输入对话框。栖伴不会提供或代购密钥，服务方可能收取费用。
          </p>
          {status?.hasKey && (
            <label className="remember-key">
              <input
                type="checkbox"
                disabled={busy}
                checked={replaceKey}
                onChange={(event) => setReplaceKey(event.target.checked)}
              />
              更换当前密钥
            </label>
          )}
          <label className="remember-key">
            <input
              type="checkbox"
              disabled={busy}
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            仅在这台手机记住密钥
          </label>
          <p className="field-note">
            不勾选时只在本次打开期间使用。记住时会加密保存；设备安全存储不可用时不会保存明文。
          </p>
          {status?.hasKey && status.baseUrl === baseUrl && (
            <div className="model-selection">
              <label htmlFor="android-model-choice">
                {status.models.length
                  ? "选择聊天模型"
                  : "填写服务方提供的模型名称"}
              </label>
              {status.models.length ? (
                <select
                  id="android-model-choice"
                  required
                  disabled={busy}
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
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
                  id="android-model-choice"
                  required
                  disabled={busy}
                  maxLength={128}
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                />
              )}
            </div>
          )}
          {error && (
            <p className="chat-error" role="alert">
              {error}
            </p>
          )}
          {status?.warning && <p className="field-note">{status.warning}</p>}
          <div className="settings-actions">
            <button className="send-button" disabled={busy} type="submit">
              {busy ? "正在检查连接…" : "确认连接与模型"}
            </button>
            <button
              className="quiet-button"
              disabled={busy}
              type="button"
              onClick={() => void demo()}
            >
              先用演示聊天
            </button>
          </div>
        </form>
        <AppearancePanel disabled={busy} />
        <details className="local-data">
          <summary>本机数据与备份</summary>
          <p>
            角色和聊天保存在应用内部。卸载会删除本机数据，请先在角色管理中导出需要保留的
            JSON。导出文件不包含密钥。
          </p>
          <div className="data-actions">
            <button
              className="quiet-button"
              disabled={busy || !status?.hasKey}
              onClick={async () => {
                if (
                  !window.confirm(
                    "删除手机记住和当前使用的密钥？聊天记录会保留。",
                  )
                )
                  return;
                setBusy(true);
                try {
                  const result = await native.deleteKey();
                  if (result.ok) {
                    apply(result.value);
                    onChanged(result.value.mode);
                  } else setError(result.error);
                } catch {
                  setError("密钥未能删除，请重试。");
                } finally {
                  setBusy(false);
                }
              }}
            >
              删除密钥
            </button>
            <button
              className="quiet-button danger"
              disabled={busy}
              onClick={async () => {
                if (
                  !window.confirm(
                    "删除所有本机角色、聊天和连接设置？无法恢复，请先导出需要保留的角色。",
                  )
                )
                  return;
                setBusy(true);
                try {
                  await onDeleteData();
                } catch {
                  setError("数据未能删除，请重试。");
                } finally {
                  setBusy(false);
                }
              }}
            >
              删除所有本机数据
            </button>
          </div>
        </details>
      </dialog>
    </>
  );
}
