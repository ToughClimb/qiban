import type { Character } from "../shared/characters";
export function Avatar({
  character,
  size = "",
}: {
  character: Character;
  size?: string;
}) {
  const portrait = ["lin", "tao", "dou", "moon"].includes(character.id)
    ? character.id
    : "custom";
  return (
    <span className={`avatar ${size} ${character.color}`} aria-hidden="true">
      <img
        src={`${import.meta.env.BASE_URL}characters/${portrait}.svg`}
        alt=""
        draggable={false}
      />
    </span>
  );
}
