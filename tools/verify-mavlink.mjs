/**
 * Verifies the MAVLink codec against pymavlink, the reference implementation.
 *
 *   python3 -m venv .venv && .venv/bin/pip install pymavlink
 *   .venv/bin/python tools/gen-mavlink-vectors.py > /tmp/vectors.json
 *   npx tsc src/lib/mavlink/*.ts --outDir /tmp/mv --module commonjs \
 *       --target es2022 --skipLibCheck --esModuleInterop
 *   node tools/verify-mavlink.mjs /tmp/mv /tmp/vectors.json
 *
 * Any disagreement is our bug: a wrong CRC extra or field order silently
 * corrupts every packet of that type on a real link.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const [, , outDir, vectorFile] = process.argv;
if (!outDir || !vectorFile) {
  console.error("usage: node tools/verify-mavlink.mjs <compiled-dir> <vectors.json>");
  process.exit(2);
}
const require = createRequire(path.resolve(outDir) + "/");
const { MavlinkParser, encodeMessage } = require("./codec.js");
const { MESSAGE_IDS } = require("./messages.js");

const vectors = JSON.parse(fs.readFileSync(vectorFile, "utf8"));
let decodeFail = 0;
let encodeFail = 0;

console.log("=== DECODE: pymavlink frames -> our parser ===");
for (const v of vectors) {
  const parser = new MavlinkParser();
  const msgs = parser.push(Uint8Array.from(Buffer.from(v.hex, "hex")));
  if (msgs.length !== 1 || msgs[0].name !== v.name) {
    console.log(`  FAIL ${v.name}: parsed ${msgs.length} message(s)`);
    decodeFail++;
    continue;
  }
  const bad = [];
  for (const [k, expected] of Object.entries(v.fields)) {
    const got = msgs[0].payload[k];
    const ok =
      typeof expected === "number"
        ? Math.abs(Number(got) - expected) < Math.max(1e-3, Math.abs(expected) * 1e-6)
        : got === expected;
    if (!ok) bad.push(`${k}: got ${got}, expected ${expected}`);
  }
  if (bad.length) {
    console.log(`  FAIL ${v.name}: ${bad.join("; ")}`);
    decodeFail++;
  } else {
    console.log(`  ok   ${v.name} (${Object.keys(v.fields).length} fields checked)`);
  }
}

console.log("\n=== ENCODE: our frames must equal pymavlink's byte-for-byte ===");
for (const v of vectors) {
  const ref = Buffer.from(v.hex, "hex");
  const [decoded] = new MavlinkParser().push(Uint8Array.from(ref));
  const mine = Buffer.from(
    encodeMessage(MESSAGE_IDS[v.name], decoded.payload, {
      systemId: decoded.systemId,
      componentId: decoded.componentId,
      sequence: decoded.sequence,
    })
  );
  if (mine.equals(ref)) {
    console.log(`  ok   ${v.name} — ${ref.length} bytes identical`);
  } else {
    console.log(`  FAIL ${v.name}\n     ref:  ${ref.toString("hex")}\n     mine: ${mine.toString("hex")}`);
    encodeFail++;
  }
}

console.log("\n=== STREAMING: byte-split, prefixed with noise ===");
const all = Buffer.concat(vectors.map((v) => Buffer.from(v.hex, "hex")));
const noisy = Buffer.concat([Buffer.from([0x00, 0xff, 0x12]), all, Buffer.from([0xfd, 0x01])]);
const parser = new MavlinkParser();
let streamed = [];
for (let i = 0; i < noisy.length; i += 7) {
  streamed = streamed.concat(parser.push(Uint8Array.from(noisy.subarray(i, i + 7))));
}
console.log(`  parsed ${streamed.length}/${vectors.length}, badChecksums=${parser.badChecksums}, unknown=${parser.unknownMessages}`);

const ok = !decodeFail && !encodeFail && streamed.length === vectors.length;
console.log(`\nRESULT: ${ok ? "PASS" : "FAIL"} — decode ${vectors.length - decodeFail}/${vectors.length}, encode ${vectors.length - encodeFail}/${vectors.length}, stream ${streamed.length}/${vectors.length}`);
process.exit(ok ? 0 : 1);
