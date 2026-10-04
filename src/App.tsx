import { Avatar } from "./Avatar";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import {
  characters,
  MAX_MESSAGE_LENGTH,
  type CharacterId,
  type Message,
} from "../shared/characters";
import { CardPanel } from "./CardPanel";
import type { Character } from "../shared/characters";
import { ConnectionPanel } from "./ConnectionPanel";
import { AndroidConnectionPanel } from "./android/AndroidConnectionPanel";
import { CharacterPicker } from "./CharacterPicker";
import { ChatMessages } from "./ChatMessages";
import { ChatComposer } from "./ChatComposer";
import { useChatImageDraft } from "./useChatImageDraft";
import type { ChatReply as NativeChatReply } from "../shared/desktop";
import { applyAccent, clearAppearance, storedAccent } from "./appearance";
import {
  ChatError,
  sendMessage,
  readMode,
  desktopBridge,
  type Mode,
} from "./api";
import {
  readConversations,
  replaceConversation,
  resetConversation,
  writeConversations,
  type Conversations,
} from "./conversations";

function loadSaved(): Conversations {
  try {
    return readConversations(localStorage);
  } catch {
    return {};
  }
}
export function App() {
  const ConnectionSettings = window.qibanPlatform === "android" ? AndroidConnectionPanel : ConnectionPanel;
  useLayoutEffect(() => { applyAccent(storedAccent()); }, []);
  const desktop = desktopBridge();
  const [companions, setCompanions] =
    useState<readonly Character[]>(characters);
  const [cardIssues, setCardIssues] = useState<string[]>([]);
  const [storageReady, setStorageReady] = useState(!desktop);
  const [deletingData, setDeletingData] = useState(false);
  const [selected, setSelected] = useState<CharacterId>("lin");
  const imageDraft = useChatImageDraft(selected);
  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const [omittedImages, setOmittedImages] =
    useState<Partial<Record<CharacterId, string[]>>>({});
  const [conversations, setConversations] = useState(() =>
    desktop ? {} : loadSaved(),
  );
  const [drafts, setDrafts] = useState<Partial<Record<CharacterId, string>>>(
    {},
  );
  const [mode, setMode] = useState<Mode | null>(null);
  const [configError, setConfigError] = useState(false);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [accessToken, setAccessToken] = useState("");
  const [tokenDraft, setTokenDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const restoreComposerFocus = useRef(false);
  const character =
    companions.find((item) => item.id === selected) ?? characters[0];
  const messages = conversations[selected] ?? [];
  const draft = drafts[selected] ?? "";
  const unanswered =
    messages.at(-1)?.role === "user" && messages.at(-1)?.id !== editingImageId;
  const locked = !desktop && mode === "live" && !accessToken;

  useEffect(() => {
    const controller = new AbortController();
    setConfigError(false);
    readMode(AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]))
      .then((value) => {
        if (!controller.signal.aborted) setMode(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setConfigError(true);
      });
    return () => controller.abort();
  }, [configAttempt]);
  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    desktop
      .cards()
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setCompanions(result.value.characters);
          setCardIssues(result.value.issues);
        } else setCardIssues([result.error]);
      })
      .catch(() => {
        if (!cancelled)
          setCardIssues(["角色文件无法读取，请在角色管理中重新加载。"]);
      });
    desktop
      .loadHistory()
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setConversations(result.value);
          setStorageReady(true);
        } else {
          setStorageError(true);
          setError(result.error);
        }
      })
      .catch(() => {
        if (!cancelled) setStorageError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!storageReady || deletingData) return;
    if (desktop) {
      desktop
        .saveHistory(conversations)
        .then((result) => setStorageError(!result.ok))
        .catch(() => setStorageError(true));
      return;
    }
    try {
      setStorageError(!writeConversations(localStorage, conversations));
    } catch {
      setStorageError(true);
    }
  }, [conversations, storageReady, deletingData]);
  useEffect(() => {
    scrollArea.current?.scrollTo({
      top: scrollArea.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy, error]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    // Disabling the textarea blurs it naturally; explicit navigation cancels return.
    function leaveComposer(event: Event) {
      if (!input.current?.closest(".composer")?.contains(event.target as Node))
        restoreComposerFocus.current = false;
    }
    function leavePage() {
      if (document.hidden) restoreComposerFocus.current = false;
    }
    document.addEventListener("focusin", leaveComposer);
    document.addEventListener("pointerdown", leaveComposer);
    document.addEventListener("visibilitychange", leavePage);
    return () => {
      document.removeEventListener("focusin", leaveComposer);
      document.removeEventListener("pointerdown", leaveComposer);
      document.removeEventListener("visibilitychange", leavePage);
    };
  }, []);
  useEffect(() => {
    if (busy || imageDraft.picking || request.current || !restoreComposerFocus.current) return;
    restoreComposerFocus.current = false;
    const composerInput = input.current;
    if (
      composerInput &&
      !composerInput.disabled &&
      document.hasFocus() &&
      (document.activeElement === document.body ||
        composerInput.closest(".composer")?.contains(document.activeElement))
    )
      composerInput.focus();
  }, [busy, imageDraft.picking, imageDraft.draft, messages, locked, mode, storageReady]);

  function cancelRequest() {
    restoreComposerFocus.current = false;
    imageDraft.clear();
    setEditingImageId(null);
    request.current?.abort();
    request.current = null;
    setBusy(false);
  }
  function choose(id: CharacterId) {
    if (id === selected) return;
    cancelRequest();
    setSelected(id);
    setError("");
  }
  async function reply(history: Message[]) {
    if (request.current || !mode || locked || !storageReady) return;
    const controller = new AbortController();
    restoreComposerFocus.current =
      input.current?.closest(".composer")?.contains(document.activeElement) ??
      false;
    request.current = controller;
    setBusy(true);
    setError("");
    const id = selected;
    try {
      const reply = await sendMessage(
        id,
        history,
        accessToken,
        AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      );
      if (request.current !== controller) return;
      setMode(reply.mode);
      const omitted = (reply as NativeChatReply).omittedImageIds ?? [];
      setOmittedImages((current) => ({
        ...current,
        [id]: omitted.filter((imageId) =>
          history.some((message) => message.image?.id === imageId),
        ),
      }));
      if (reply.mode === "demo") setAccessToken("");
      setConversations((current) =>
        replaceConversation(current, id, [
          ...history,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: reply.content,
            mode: reply.mode,
          },
        ]),
      );
    } catch (failure) {
      if (request.current !== controller) return;
      if (failure instanceof ChatError && failure.status === 401) {
        setAccessToken("");
        setMode("live");
        setConfigAttempt((value) => value + 1);
      }
      setError(
        failure instanceof ChatError
          ? failure.message
          : "暂时连接不上。你的消息还在，可以再试一次。",
      );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (
      (!draft.trim() && !imageDraft.draft) ||
      draft.trim().length > MAX_MESSAGE_LENGTH ||
      busy ||
      imageDraft.picking ||
      unanswered ||
      !mode ||
      !storageReady ||
      locked
    )
      return;
    const image = imageDraft.take();
    const history: Message[] = [
      ...(editingImageId ? messages.slice(0, -1) : messages),
      {
        id: editingImageId ?? crypto.randomUUID(),
        role: "user",
        content: draft.trim(),
        ...(image ? { image } : {}),
      },
    ];
    setConversations((current) =>
      replaceConversation(current, selected, history),
    );
    setDrafts((current) => ({ ...current, [selected]: "" }));
    setEditingImageId(null);
    void reply(history);
  }
  async function editPending() {
    const last = messages.at(-1);
    if (busy || imageDraft.picking || last?.role !== "user") return;
    cancelRequest();
    if (last.image) {
      if (await imageDraft.restore(last.image) === "cancelled") return;
      setEditingImageId(last.id);
    } else {
      setConversations((current) =>
        replaceConversation(current, selected, messages.slice(0, -1)),
      );
    }
    setDrafts((current) => ({ ...current, [selected]: last.content }));
    setError("");
    setTimeout(() => input.current?.focus(), 0);
  }
  function reset() {
    if (
      !window.confirm(
        `清空与${character.name}的聊天记录？这只会清空这位伙伴的记录，无法恢复。`,
      )
    )
      return;
    cancelRequest();
    setConversations((current) => resetConversation(current, selected));
    setOmittedImages((current) => ({ ...current, [selected]: [] }));
    setDrafts((current) => ({ ...current, [selected]: "" }));
    setError("");
    input.current?.focus();
  }
  async function changeAvatar(id: string, reset = false) {
    const result = reset
      ? await desktop?.deleteAvatar?.(id)
      : await desktop?.importAvatar?.(id);
    if (!result) return;
    if (!result.ok) throw Error(result.error);
    if (result.value === null) return;
    const list = await desktop!.cards();
    if (!list.ok) throw Error(list.error);
    setCompanions(list.value.characters);
    setCardIssues(list.value.issues);
  }
  return (
    <div className="app-shell">
      <CharacterPicker
        companions={companions}
        selected={selected}
        onChoose={choose}
      />
      <main className="chat-panel">
        <header className="chat-header">
          <div className="chat-identity">
            <Avatar character={character} size="small" />
            <div>
              <h2>{character.name}</h2>
            </div>
          </div>
          <div className="header-actions">
            {desktop && (
              <CardPanel
                character={character}
                onChangeAvatar={desktop?.importAvatar
                  ? (id) => changeAvatar(id)
                  : undefined}
                onResetAvatar={desktop?.deleteAvatar
                  ? (id) => changeAvatar(id, true)
                  : undefined}
                onChanged={(list, id) => {
                  cancelRequest();
                  setCompanions(list.characters);
                  setCardIssues(list.issues);
                  if (id) setSelected(id);
                  else if (
                    !list.characters.some((item) => item.id === selected)
                  )
                    setSelected("lin");
                }}
                onDelete={(id) => {
                  cancelRequest();
                  setConversations((current) => resetConversation(current, id));
                  setDrafts((current) => ({ ...current, [id]: "" }));
                }}
              />
            )}
            {desktop && (
              <ConnectionSettings
                onChanged={(value) => {
                  cancelRequest();
                  setMode(value);
                  setConfigAttempt((attempt) => attempt + 1);
                }}
                onDeleteData={async () => {
                  cancelRequest();
                  setDeletingData(true);
                  const result = await desktop.deleteData();
                  if (!result.ok) {
                    setDeletingData(false);
                    throw new Error(result.error);
                  }
                  clearAppearance();
                  window.location.reload();
                }}
              />
            )}
            <button
              className="quiet-button"
              aria-label="清空聊天"
              type="button"
              onClick={reset}
              disabled={!messages.length && !imageDraft.draft && !imageDraft.picking}
            >
              清空
            </button>
          </div>
        </header>
        <div
          className={`mode-notice ${mode === "live" ? "live-notice" : ""}`}
          role="status"
        >
          {configError ? (
            <>
              <span>暂时连接不上栖伴。</span>
              <button onClick={() => setConfigAttempt((value) => value + 1)}>
                重新连接
              </button>
            </>
          ) : mode === "demo" ? (
            <span>
              <strong>演示模式</strong> · 虚拟伙伴，回复为预设示例。
            </span>
          ) : mode === "live" ? (
            <span>虚拟伙伴 · AI 生成回复</span>
          ) : (
            <span>正在连接栖伴…</span>
          )}
        </div>
        {cardIssues.length > 0 && (
          <details className="card-issues">
            <summary>有角色文件需要检查</summary>
            {cardIssues.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </details>
        )}
        {locked && (
          <form
            className="access-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (tokenDraft.trim()) {
                setAccessToken(tokenDraft.trim());
                setTokenDraft("");
                setError("");
              }
            }}
          >
            <label htmlFor="invite">输入体验口令，开始聊天</label>
            <div>
              <input
                id="invite"
                type="password"
                value={tokenDraft}
                onChange={(event) => setTokenDraft(event.target.value)}
                maxLength={512}
                autoComplete="off"
                required
              />
              <button type="submit">进入</button>
            </div>
            <small>口令由体验组织者提供，仅在当前页面使用。</small>
          </form>
        )}
        <ChatMessages
          character={character}
          messages={editingImageId ? messages.slice(0, -1) : messages}
          mode={mode}
          busy={busy}
          error={error}
          retryDisabled={!mode || locked || imageDraft.picking}
          editDisabled={imageDraft.picking}
          omittedImageIds={omittedImages[selected]}
          onRetry={() => void reply(messages)}
          onEdit={() => void editPending()}
          scrollArea={scrollArea}
        />
        <div className="composer-area">
          <ChatComposer
            name={character.name}
            draft={draft}
            image={imageDraft.draft}
            mode={mode}
            disabled={busy || imageDraft.picking || unanswered || locked || !mode || !storageReady}
            unanswered={unanswered}
            input={input}
            onChange={(value) => setDrafts((current) => ({ ...current, [selected]: value }))}
            onSubmit={submit}
            onPick={() => {
              restoreComposerFocus.current =
                input.current?.closest(".composer")?.contains(document.activeElement) ?? false;
              void imageDraft.pick();
            }}
            onRemove={() => {
              restoreComposerFocus.current = true;
              imageDraft.clear();
            }}
            onImageError={imageDraft.failPreview}
          />
          {imageDraft.error && (
            <p className="image-error" role="alert">{imageDraft.error}</p>
          )}
          {storageError && (
            <p className="privacy-note storage-warning" role="status">
              {desktop
                ? "本地记录无法保存，请检查磁盘空间并备份数据。"
                : "浏览器无法保存记录；关闭页面后，本次聊天可能丢失。"}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
