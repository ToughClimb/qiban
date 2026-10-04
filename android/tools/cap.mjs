// Capacitor 8's config loader expects the pre-TypeScript-7 compiler API.
// Qiban already requires Node 24, whose native TS loader can load our config.
// Keep this compatibility hook in the CLI process; preserve the Windows compiler.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const loader = require("@capacitor/cli/dist/util/node.js");
loader.requireTS = (_compiler, file) => require(file);
await require("@capacitor/cli").run();
