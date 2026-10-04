import { readFileSync, lstatSync } from "node:fs";
import { sourceText } from "../desktop/cards.js";
import { parseCharacterCard } from "../shared/character-card.js";
import { modelRequest } from "../server/model.js";
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const json = args.includes("--json");
const files = args.filter((arg) => arg !== "--json");
if (files.length !== 1) {
  console.error("Usage: npm run check:card -- path/to/card.json --json");
  process.exitCode = 2;
} else {
  let result;
  try {
    const stat = lstatSync(files[0]);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024)
      throw Error();
    result = parseCharacterCard(sourceText(readFileSync(files[0])));
  } catch {
    result = {
      ok: false,
      errors: [
        {
          code: "file",
          path: "$",
          message: "Cannot read a bounded regular UTF-8 JSON file.",
        },
      ],
      warnings: [],
    };
  }
  let contextCompatible = false;
  if (result.ok) {
    try {
      modelRequest(
        {
          characterId: "card-check",
          messages: [{ role: "user", content: "中".repeat(2000) }],
        },
        "validation",
        false,
        result.persona,
      );
      contextCompatible = true;
    } catch {}
  }
  const diagnostics = {
    schema_version: 1,
    valid: result.ok,
    context_compatible: contextCompatible,
    warnings: result.warnings,
    ...(!result.ok
      ? { errors: result.errors }
      : { source_format: result.persona.sourceFormat }),
  };
  console.log(
    json
      ? JSON.stringify(diagnostics, null, 2)
      : `${result.ok ? "Valid" : "Invalid"} card; maximum-message context ${contextCompatible ? "fits" : "does not fit"}.\n${JSON.stringify(diagnostics, null, 2)}`,
  );
  process.exitCode = result.ok && contextCompatible ? 0 : 1;
}
