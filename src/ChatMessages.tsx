import { Avatar } from "./Avatar";
import { ChatImagePreview } from "./ChatImagePreview";
import type { RefObject } from "react";
import type { Character, Message, Mode } from "../shared/characters";

type Props = {
  character: Character;
  messages: Message[];
  mode: Mode | null;
  busy: boolean;
  error: string;
  retryDisabled: boolean;
  editDisabled?: boolean;
  omittedImageIds?: string[];
  onRetry: () => void;
  onEdit: () => void;
  scrollArea: RefObject<HTMLDivElement | null>;
};
export function ChatMessages({
  character,
  messages,
  mode,
  busy,
  error,
  retryDisabled,
  editDisabled = false,
  omittedImageIds = [],
  onRetry,
  onEdit,
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
      {!messages.length ? (
        <div className="welcome">
          <div className="welcome-portrait">
            <Avatar character={character} size="hero" />
          </div>
        </div>
      ) : null}
      <div className="message assistant">
        <Avatar character={character} size="tiny" />
        <div>
          <p className="bubble">{character.greeting}</p>
        </div>
      </div>
      {messages.map((message) => (
        <div
          key={message.id}
          className={`message ${message.role}`}
          data-mode={message.mode}
        >
          {message.role === "assistant" && (
            <Avatar character={character} size="tiny" />
          )}
          <div>
            {message.role === "assistant" && message.mode !== mode && (
              <span className="message-name">
                {message.mode === "demo"
                  ? "演示示例"
                  : message.mode === "live"
                    ? "AI 回复"
                    : "历史回复"}
              </span>
            )}
            {message.image && (
              <ChatImagePreview
                characterId={character.id}
                image={message.image}
                omitted={omittedImageIds.includes(message.image.id)}
              />
            )}
            {message.content && <p className="bubble">{message.content}</p>}
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
              ? "可以重试，或编辑这条消息。"
              : "上一条消息还没有收到回复。"}
          </span>
          <button disabled={retryDisabled} onClick={onRetry}>
            重试回复
          </button>
          <button disabled={editDisabled} onClick={onEdit}>编辑消息</button>
        </div>
      )}
    </div>
  );
}
