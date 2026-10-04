import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const forbiddenArchiveEntry = name => /(^|\/)\.env(?:\.|$)|(^|\/)(?:history\.json|connection\.json|debug\.keystore|[^/]+\.(?:pem|p12|pfx|jks))$|(^|\/)(?:\.git|tests|test-data|userData|avatars|chat-images)\//i.test(name);

export async function verifyArchiveContents(file, expected) {
  const yauzl = require("yauzl");
  const found = new Set();
  let count = 0;
  await new Promise((done, fail) => yauzl.open(file, { lazyEntries: true }, (error, archive) => {
    if (error) return fail(error);
    const abort = error => { archive.close(); fail(error); };
    archive.on("error", abort);
    archive.on("end", done);
    archive.on("entry", entry => {
      if (++count > 10000 || forbiddenArchiveEntry(entry.fileName) || /(^|\/)\.\.(\/|$)|\\/.test(entry.fileName))
        return abort(new Error("Unexpected private/path entry in release archive."));
      const key = [...expected.keys()].find(name => entry.fileName === name || entry.fileName.endsWith(`/${name}`));
      if (!key) return archive.readEntry();
      if (found.has(key) || entry.uncompressedSize > 32 * 1024 * 1024)
        return abort(new Error("Duplicate or excessive package verification entry."));
      found.add(key);
      archive.openReadStream(entry, (error, stream) => {
        if (error) return abort(error);
        const chunks = []; let size = 0;
        stream.on("error", abort);
        stream.on("data", chunk => {
          size += chunk.length;
          if (size > 32 * 1024 * 1024) { stream.destroy(); abort(new Error("Package entry exceeds limit.")); }
          else chunks.push(chunk);
        });
        stream.on("end", () => {
          if (sha256(Buffer.concat(chunks)) !== sha256(expected.get(key)))
            return abort(new Error(`Packaged bytes differ from verified source: ${key}`));
          archive.readEntry();
        });
      });
    });
    archive.readEntry();
  }));
  const missing = [...expected.keys()].filter(name => !found.has(name));
  if (missing.length) throw new Error(`Required package entries missing: ${missing.join(", ")}`);
}
