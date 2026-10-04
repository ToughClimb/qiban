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
  const fallback = `${import.meta.env.BASE_URL}characters/${portrait}.svg`;
  const avatarUrl = character.avatarUrl;
  const nativePrefix = `qiban://app/avatars/${encodeURIComponent(character.id)}/`;
  const source =
    typeof avatarUrl === "string" &&
    ((avatarUrl.startsWith(nativePrefix) &&
      /^[0-9a-f]{64}\.png$/.test(avatarUrl.slice(nativePrefix.length))) ||
      /^data:image\/(?:png|jpeg|webp);base64,/i.test(avatarUrl))
      ? avatarUrl
      : fallback;
  return (
    <span className={`avatar ${size} ${character.color}`} aria-hidden="true">
      <img
        src={source}
        onError={(event) => {
          if (event.currentTarget.getAttribute("src") !== fallback)
            event.currentTarget.src = fallback;
        }}
        alt=""
        draggable={false}
      />
    </span>
  );
}
