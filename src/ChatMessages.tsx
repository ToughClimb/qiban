import type { RefObject } from "react";
import type { Character, Message } from "../shared/characters";

type Props = {
  character: Character;
  messages: Message[];
  busy: boolean;
  error: string;
  retryDisabled: boolean;
  onRetry: () => void;
  scrollArea: RefObject<HTMLDivElement | null>;
};
export function ChatMessages({
  character,
  messages,
  busy,
  error,
  retryDisabled,
  onRetry,
  scrollArea,
}: Props) {
  return (
    <div
      className="message-area"
      ref={scrollArea}
      role="log"
      aria-label={`与${character.name}的聊天`}
      aria-live="polite"
      aria-relevant="additions text"
    >
      <div className="welcome">
        <span className={`avatar hero ${character.color}`} aria-hidden="true">
          {character.emoji}
        </span>
        <h3>和{character.name}，聊聊日常</h3>
        <p>{character.description}</p>
        <span className="welcome-label">{character.kind}</span>
      </div>
      <div className="message assistant">
        <span className={`avatar tiny ${character.color}`} aria-hidden="true">
          {character.emoji}
        </span>
        <div>
          <span className="message-name">{character.name}</span>
          <p className="bubble">{character.greeting}</p>
        </div>
      </div>
      {messages.map((message) => (
        <div key={message.id} className={`message ${message.role}`}>
          {message.role === "assistant" && (
            <span
              className={`avatar tiny ${character.color}`}
              aria-hidden="true"
            >
              {character.emoji}
            </span>
          )}
          <div>
            <span className="message-name">
              {message.role === "user" ? "你" : character.name}
            </span>
            <p className="bubble">{message.content}</p>
          </div>
        </div>
      ))}
      {busy && (
        <div className="waiting" role="status">
          <span className="waiting-dots" aria-hidden="true">
            •••
          </span>{" "}
          正在等待回复…
        </div>
      )}
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      {messages.at(-1)?.role === "user" && !busy && (
        <div className="retry-row">
          <span>
            {error
              ? "可以重试，或清空这段聊天。"
              : "上一条消息还没有收到回复。"}
          </span>
          <button disabled={retryDisabled} onClick={onRetry}>
            重试回复
          </button>
        </div>
      )}
    </div>
  );
}
