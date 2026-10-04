import type { FormEvent, RefObject } from "react";
import { MAX_MESSAGE_LENGTH, type Mode } from "../shared/characters";
import type { ChatImageDraft } from "../shared/image-chat";

type Props = {
  name: string;
  draft: string;
  image: ChatImageDraft | null;
  mode: Mode | null;
  disabled: boolean;
  unanswered: boolean;
  input: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onPick: () => void;
  onRemove: () => void;
  onImageError: () => void;
};
export function ChatComposer({ name, draft, image, mode, disabled, unanswered, input, onChange, onSubmit, onPick, onRemove, onImageError }: Props) {
  return (
    <form className={`composer ${image ? "has-image" : ""}`} onSubmit={onSubmit}>
      {image && (
        <div className="image-draft">
          <img src={image.previewUrl} alt="待发送的图片" onError={onImageError} />
          <div>
            <span>待发送图片</span>
            {mode === "live" && <small>点击发送后才会交给 AI 服务。</small>}
          </div>
          <button className="quiet-button remove-image" type="button" aria-label="移除待发送图片" onClick={onRemove} disabled={disabled}>×</button>
        </div>
      )}
      <button className="attach-button" type="button" aria-label="添加图片" title="添加图片" disabled={disabled || !!image} onClick={onPick}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9a7 7 0 0 1 10 10l-9 9" />
        </svg>
      </button>
      <label className="sr-only" htmlFor="message">给{name}发消息</label>
      <textarea
        ref={input} id="message" rows={2}
        placeholder={unanswered ? "先等待回复，或重试、编辑上一条消息" : "说点什么…"}
        aria-description="Enter 发送，Shift + Enter 换行"
        maxLength={MAX_MESSAGE_LENGTH} value={draft}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault(); onSubmit(event);
          }
        }}
      />
      <div className="composer-bottom">
        {draft.length > 1800 && <span>{draft.length}/{MAX_MESSAGE_LENGTH}</span>}
        <button className="send-button" type="submit" disabled={disabled || (!draft.trim() && !image)}>
          发送 <span aria-hidden="true">↑</span>
        </button>
      </div>
    </form>
  );
}
