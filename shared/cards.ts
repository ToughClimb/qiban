import type { Character } from "./characters.js";
import type {
  RoleplayPersonaV1,
  CharacterCardWarningV1,
} from "./character-card.js";
export type CardFields = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  exampleDialogue: string;
};
export type CardPreview = {
  token: string;
  persona: RoleplayPersonaV1;
  warnings: CharacterCardWarningV1[];
};
export type CardList = { characters: Character[]; issues: string[] };
export const cardFields = (persona: RoleplayPersonaV1): CardFields => ({
  name: persona.name,
  description: persona.description,
  personality: persona.personality,
  scenario: persona.scenario,
  firstMessage: persona.firstMessage,
  exampleDialogue: persona.exampleDialogue,
});
