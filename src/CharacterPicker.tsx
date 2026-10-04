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
          栖伴
        </span>
      </a>
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
              <strong>{item.name}</strong>
            </span>
            <span className="selection-dot" aria-hidden="true" />
          </button>
        ))}
      </nav>
    </aside>
  );
}
