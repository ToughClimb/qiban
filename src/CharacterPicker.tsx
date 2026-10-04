import { Avatar } from "./Avatar";
import {
  characters,
  type Character,
  type CharacterId,
} from "../shared/characters";

export function CharacterPicker({
  selected,
  onChoose,
  companions = characters,
}: {
  companions?: readonly Character[];
  selected: CharacterId;
  onChoose: (id: CharacterId) => void;
}) {
  return (
    <aside className="companions">
      <a className="brand" href="./index.html" aria-label="栖伴首页">
        <span className="brand-mark">栖</span>
        <span>
          栖伴<small>QIBAN</small>
        </span>
      </a>
      <div className="sidebar-intro">
        <p className="eyebrow">给日常留一点空白</p>
        <h1>
          找个伙伴，<br />慢慢聊。
        </h1>
        <p>今天的故事，从这里开始。</p>
      </div>
      <p className="companions-label">
        你的伙伴 <span>COMPANIONS</span>
      </p>
      <nav className="character-list" aria-label="选择伙伴">
        {companions.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`character-card ${selected === item.id ? "selected" : ""}`}
            aria-pressed={selected === item.id}
            onClick={() => onChoose(item.id)}
          >
            <Avatar character={item} />
            <span className="character-info">
              <strong>
                {item.name}
                <span>{item.role}</span>
              </strong>
              <small>{item.description}</small>
            </span>
            <span className="selection-dot" aria-hidden="true" />
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <span className="leaf" aria-hidden="true">
          <svg viewBox="0 0 32 40" fill="none">
            <path
              d="M16 36V13m0 11C5 24 3 15 4 10c9 0 12 7 12 14Zm0-8C16 7 23 3 29 4c0 8-5 12-13 12Z"
              stroke="currentColor"
              strokeWidth="1.3"
            />
          </svg>
        </span>
        <p>
          聊一会儿，或去过自己的生活。
          <br />
          伙伴们都是虚拟角色。
        </p>
      </div>
    </aside>
  );
}
