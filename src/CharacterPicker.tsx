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
        <h1>今天，想和谁聊聊？</h1>
        <p>选一位伙伴，慢慢说。</p>
      </div>
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
          ❋
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
