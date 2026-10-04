/** A deliberately limited, JSON-only Tavern-card import. No I/O or prompt assembly. */
export const CHARACTER_CARD_LIMITS = Object.freeze({
  jsonBytes: 128 * 1024,
  depth: 16,
  nodes: 4096,
  arrayItems: 128,
  keyBytes: 128,
  unknownStringBytes: 16 * 1024,
  nameBytes: 256,
  personaFieldBytes: 8 * 1024,
  greetingBytes: 4 * 1024,
  alternateGreetings: 8,
  notesBytes: 4 * 1024,
  creatorBytes: 256,
  versionBytes: 64,
  tags: 32,
  tagBytes: 64,
});

export type CharacterCardSourceV1 = "tavern-v1" | "tavern-v2";

/** All strings are untrusted data. metadata must stay out of model prompts. */
export interface RoleplayPersonaV1 {
  schemaVersion: 1;
  sourceFormat: CharacterCardSourceV1;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  exampleDialogue: string;
  alternateGreetings: string[];
  metadata: {
    creator: string;
    creatorNotes: string;
    characterVersion: string;
    tags: string[];
  };
}

export interface CharacterCardWarningV1 {
  code: "unsupported_field";
  /** JSON path for UI diagnostics; never contains a field value. */
  path: string;
  message: string;
}

export interface CharacterCardErrorV1 {
  code: "invalid_json" | "invalid_format" | "invalid_field" | "limit_exceeded" | "forbidden_field";
  path: string;
  message: string;
}

export type CharacterCardParseResultV1 =
  | { ok: true; persona: RoleplayPersonaV1; warnings: CharacterCardWarningV1[] }
  | { ok: false; errors: CharacterCardErrorV1[]; warnings: CharacterCardWarningV1[] };

const encoder = new TextEncoder();
const bytes = (value: string): number => encoder.encode(value).byteLength;
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const own = (object: Record<string, unknown>, key: string): boolean =>
  Object.hasOwn(object, key);
const childPath = (path: string, key: string): string => `${path}[${JSON.stringify(key)}]`;

// Only data fields are imported, but forbidden configuration also fails inside
// ignored extensions. This is a key check, not a semantic scan of persona prose.
const forbiddenKeys = new Set([
  "__proto__", "constructor", "prototype",
  "code", "script", "scripts", "javascript", "execute", "exec", "eval",
  "command", "commands", "shell", "hooks", "webhook", "webhooks",
  "tool", "tools", "toolcalls", "toolchoice", "function", "functions", "mcp",
  "provider", "providers", "providerconfig", "model", "endpoint", "baseurl",
  "api", "apikey", "apikeys", "token", "accesstoken", "refreshtoken",
  "password", "secret", "secrets", "credential", "credentials",
  "authorization", "headers", "env", "environment",
]);

function forbidden(key: string): boolean {
  const lower = key.toLowerCase();
  return forbiddenKeys.has(lower) ||
    forbiddenKeys.has(lower.replace(/[^a-z0-9]/g, "")) ||
    lower.split(/[\/.:]/).some((part) => forbiddenKeys.has(part.replace(/[^a-z0-9]/g, "")));
}

/** Parse JSON text only. The caller owns decoding, file dialogs, IDs and storage. */
export function parseCharacterCard(json: string): CharacterCardParseResultV1 {
  const warnings: CharacterCardWarningV1[] = [];
  const fail = (code: CharacterCardErrorV1["code"], path: string, message: string): CharacterCardParseResultV1 =>
    ({ ok: false, errors: [{ code, path, message }], warnings });
  if (typeof json !== "string") return fail("invalid_json", "$", "Expected JSON text.");
  // Short-circuit before allocating a UTF-8 buffer for oversized input.
  if (json.length > CHARACTER_CARD_LIMITS.jsonBytes || bytes(json) > CHARACTER_CARD_LIMITS.jsonBytes) {
    return fail("limit_exceeded", "$", "JSON exceeds the 128 KiB import limit.");
  }
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    return fail("invalid_json", "$", "Invalid JSON; comments and trailing commas are not supported.");
  }
  if (!isObject(root)) return fail("invalid_format", "$", "A character card must be a JSON object.");

  let nodes = 0;
  function inspect(value: unknown, path: string, depth: number): CharacterCardErrorV1 | undefined {
    if (++nodes > CHARACTER_CARD_LIMITS.nodes || depth > CHARACTER_CARD_LIMITS.depth) {
      return { code: "limit_exceeded", path, message: "JSON exceeds the nesting or node limit." };
    }
    if (typeof value === "string" && bytes(value) > CHARACTER_CARD_LIMITS.unknownStringBytes) {
      return { code: "limit_exceeded", path, message: "A JSON string exceeds 16 KiB." };
    }
    if (Array.isArray(value)) {
      if (value.length > CHARACTER_CARD_LIMITS.arrayItems) {
        return { code: "limit_exceeded", path, message: "A JSON array exceeds 128 items." };
      }
      for (let index = 0; index < value.length; index++) {
        const error = inspect(value[index], `${path}[${index}]`, depth + 1);
        if (error) return error;
      }
    } else if (isObject(value)) {
      for (const [key, item] of Object.entries(value)) {
        if (bytes(key) > CHARACTER_CARD_LIMITS.keyBytes) {
          return { code: "limit_exceeded", path, message: "A JSON key exceeds 128 bytes." };
        }
        const itemPath = childPath(path, key);
        if (forbidden(key)) {
          return { code: "forbidden_field", path: itemPath, message: "Executable, tool, provider, credential or prototype configuration is forbidden." };
        }
        const error = inspect(item, itemPath, depth + 1);
        if (error) return error;
      }
    }
    return undefined;
  }
  const structuralError = inspect(root, "$", 0);
  if (structuralError) return { ok: false, errors: [structuralError], warnings };

  let sourceFormat: CharacterCardSourceV1 = "tavern-v1";
  let data = root;
  let dataPath = "$";
  if (own(root, "spec") || own(root, "spec_version") || own(root, "data")) {
    if (root.spec !== "chara_card_v2" || root.spec_version !== "2.0" || !isObject(root.data)) {
      return fail("invalid_format", "$", "Only flat Tavern V1 or chara_card_v2 / 2.0 with a data object is supported.");
    }
    sourceFormat = "tavern-v2";
    data = root.data;
    dataPath = '$["data"]';
  }

  const errors: CharacterCardErrorV1[] = [];
  function text(key: string, maxBytes: number, required = false): string {
    const path = childPath(dataPath, key);
    if (!own(data, key)) {
      if (required) errors.push({ code: "invalid_field", path, message: "A non-empty name is required." });
      return "";
    }
    const value = data[key];
    if (typeof value !== "string") {
      errors.push({ code: "invalid_field", path, message: "Expected a string." });
      return "";
    }
    if (bytes(value) > maxBytes) errors.push({ code: "limit_exceeded", path, message: `Field exceeds ${maxBytes} UTF-8 bytes.` });
    if (required && !value.trim()) errors.push({ code: "invalid_field", path, message: "A non-empty name is required." });
    return required ? value.trim() : value;
  }
  function list(key: string, maxItems: number, maxBytes: number): string[] {
    if (!own(data, key)) return [];
    const value = data[key];
    const path = childPath(dataPath, key);
    if (!Array.isArray(value)) {
      errors.push({ code: "invalid_field", path, message: "Expected an array of strings." });
      return [];
    }
    if (value.length > maxItems) errors.push({ code: "limit_exceeded", path, message: `Field exceeds ${maxItems} items.` });
    const output: string[] = [];
    value.forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      if (typeof item !== "string") errors.push({ code: "invalid_field", path: itemPath, message: "Expected a string." });
      else {
        if (bytes(item) > maxBytes) errors.push({ code: "limit_exceeded", path: itemPath, message: `Item exceeds ${maxBytes} UTF-8 bytes.` });
        output.push(item);
      }
    });
    return output;
  }
  const limits = CHARACTER_CARD_LIMITS;
  const persona: RoleplayPersonaV1 = {
    schemaVersion: 1,
    sourceFormat,
    name: text("name", limits.nameBytes, true),
    description: text("description", limits.personaFieldBytes),
    personality: text("personality", limits.personaFieldBytes),
    scenario: text("scenario", limits.personaFieldBytes),
    firstMessage: text("first_mes", limits.greetingBytes),
    exampleDialogue: text("mes_example", limits.personaFieldBytes),
    alternateGreetings: list("alternate_greetings", limits.alternateGreetings, limits.greetingBytes),
    metadata: {
      creator: text("creator", limits.creatorBytes),
      creatorNotes: text("creator_notes", limits.notesBytes),
      characterVersion: text("character_version", limits.versionBytes),
      tags: list("tags", limits.tags, limits.tagBytes),
    },
  };

  const supported = new Set([
    "name", "description", "personality", "scenario", "first_mes", "mes_example",
    "alternate_greetings", "creator", "creator_notes", "character_version", "tags",
  ]);
  function warnUnknown(object: Record<string, unknown>, path: string, allowed: Set<string>): void {
    for (const [key, value] of Object.entries(object)) {
      if (allowed.has(key)) continue;
      // Empty standard V2 placeholders have no behavior to discard.
      if ((key === "system_prompt" || key === "post_history_instructions") && value === "") continue;
      if (key === "extensions" && isObject(value) && Object.keys(value).length === 0) continue;
      warnings.push({
        code: "unsupported_field",
        path: childPath(path, key),
        message: "Unsupported field was ignored; retain the original card to preserve it.",
      });
    }
  }
  warnUnknown(data, dataPath, supported);
  if (sourceFormat === "tavern-v2") warnUnknown(root, "$", new Set(["spec", "spec_version", "data"]));
  return errors.length ? { ok: false, errors, warnings } : { ok: true, persona, warnings };
}
