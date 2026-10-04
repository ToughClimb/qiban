import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  characters,
  MAX_MESSAGE_LENGTH,
  type CharacterId,
  type Message,
} from "../shared/characters";
import { CharacterPicker } from "./CharacterPicker";
import { ChatMessages } from "./ChatMessages";
import { ChatError, sendMessage, type Mode } from "./api";
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
  const [selected, setSelected] = useState<CharacterId>("lin");
  const [conversations, setConversations] = useState(loadSaved);
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
  const character = characters.find((item) => item.id === selected)!;
  const messages = conversations[selected] ?? [];
  const draft = drafts[selected] ?? "";
  const unanswered = messages.at(-1)?.role === "user";
  const locked = mode === "live" && !accessToken;

  useEffect(() => {
    const controller = new AbortController();
    setConfigError(false);
    fetch("/api/config", {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (data.mode !== "demo" && data.mode !== "live") throw new Error();
        if (!controller.signal.aborted) setMode(data.mode);
      })
      .catch(() => {
        if (!controller.signal.aborted) setConfigError(true);
      });
    return () => controller.abort();
  }, [configAttempt]);
  useEffect(() => {
    try {
      setStorageError(!writeConversations(localStorage, conversations));
    } catch {
      setStorageError(true);
    }
  }, [conversations]);
  useEffect(() => {
    scrollArea.current?.scrollTo({
      top: scrollArea.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy, error]);
  useEffect(() => () => request.current?.abort(), []);

  function cancelRequest() {
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
    if (request.current || !mode || locked) return;
    const controller = new AbortController();
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
      if (failure instanceof ChatError && failure.status === 401)
        setAccessToken("");
      setError(
        failure instanceof ChatError
          ? failure.message
          : "暂时连接不上。你的消息还在，可以再试一次。",
      );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
        input.current?.focus();
      }
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !draft.trim() ||
      draft.trim().length > MAX_MESSAGE_LENGTH ||
      busy ||
      unanswered ||
      !mode ||
      locked
    )
      return;
    const history: Message[] = [
      ...messages,
      { id: crypto.randomUUID(), role: "user", content: draft.trim() },
    ];
    setConversations((current) =>
      replaceConversation(current, selected, history),
    );
    setDrafts((current) => ({ ...current, [selected]: "" }));
    void reply(history);
  }
  function editPending() {
    const last = messages.at(-1);
    if (busy || last?.role !== "user") return;
    cancelRequest();
    setConversations((current) =>
      replaceConversation(current, selected, messages.slice(0, -1)),
    );
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
    setDrafts((current) => ({ ...current, [selected]: "" }));
    setError("");
    input.current?.focus();
  }
  return (
    <div className="app-shell">
      <CharacterPicker selected={selected} onChoose={choose} />
      <main className="chat-panel">
        <header className="chat-header">
          <div className="chat-identity">
            <span
              className={`avatar small ${character.color}`}
              aria-hidden="true"
            >
              {character.emoji}
            </span>
            <div>
              <h2>{character.name}</h2>
              <p>
                {character.kind} · {character.role}
              </p>
            </div>
          </div>
          <button
            className="quiet-button"
            type="button"
            onClick={reset}
            disabled={!messages.length}
          >
            清空聊天
          </button>
        </header>
        <div
          className={`mode-notice ${mode === "live" ? "live-notice" : ""}`}
          role="status"
        >
          <span aria-hidden="true">{mode === "live" ? "◇" : "◌"}</span>
          {configError ? (
            <>
              <span>暂时连接不上栖伴。</span>
              <button onClick={() => setConfigAttempt((value) => value + 1)}>
                重新连接
              </button>
            </>
          ) : mode === "demo" ? (
            <span>
              <strong>演示模式</strong> · 新回复为预设示例，不是实时 AI 生成。
            </span>
          ) : mode === "live" ? (
            <span>AI 角色对话 · 新回复由 AI 生成，伙伴是虚拟角色。</span>
          ) : (
            <span>正在连接栖伴…</span>
          )}
        </div>
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
          messages={messages}
          busy={busy}
          error={error}
          retryDisabled={!mode || locked}
          onRetry={() => void reply(messages)}
          onEdit={editPending}
          scrollArea={scrollArea}
        />
        <div className="composer-area">
          {!messages.length && (
            <div className="starters" aria-label="话题建议">
              {character.starters.map((starter) => (
                <button
                  key={starter}
                  onClick={() => {
                    setDrafts((current) => ({
                      ...current,
                      [selected]: starter,
                    }));
                    input.current?.focus();
                  }}
                >
                  {starter}
                  <span aria-hidden="true"> ↗</span>
                </button>
              ))}
            </div>
          )}
          <form className="composer" onSubmit={submit}>
            <label className="sr-only" htmlFor="message">
              给{character.name}发消息
            </label>
            <textarea
              ref={input}
              id="message"
              placeholder={
                unanswered
                  ? "先等待回复，或重试、编辑上一条消息"
                  : `想和${character.name}说点什么？`
              }
              rows={2}
              maxLength={MAX_MESSAGE_LENGTH}
              value={draft}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  [selected]: event.target.value,
                }))
              }
              disabled={busy || unanswered || locked || !mode}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  submit(event);
                }
              }}
            />
            <div className="composer-bottom">
              <span>
                {draft.length > 1800
                  ? `${draft.length}/${MAX_MESSAGE_LENGTH}`
                  : "Enter 发送 · Shift + Enter 换行"}
              </span>
              <button
                className="send-button"
                type="submit"
                disabled={
                  !draft.trim() || busy || unanswered || locked || !mode
                }
              >
                发送 <span aria-hidden="true">↑</span>
              </button>
            </div>
          </form>
          <p
            className={`privacy-note ${storageError ? "storage-warning" : ""}`}
            role={storageError ? "status" : undefined}
          >
            {storageError
              ? "浏览器无法保存记录；关闭页面后，本次聊天可能丢失。"
              : mode === "live"
                ? "记录保存在此浏览器；发送时，近期对话会交给 AI 服务处理。"
                : "记录只保存在此浏览器，可随时清空。演示聊天不会发给 AI 服务。"}
          </p>
        </div>
      </main>
    </div>
  );
}
