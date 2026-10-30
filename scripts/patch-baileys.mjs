// Patches @whiskeysockets/baileys so view-once media is delivered.
//
// relayMessage reads the media type from the raw message, but view-once media is
// wrapped in viewOnceMessageV2, so the <enc> node goes out without `mediatype`
// and recipient devices drop the message (it stays at one tick forever).
// See WhiskeySockets/Baileys#2678 and the fix in WhiskeySockets/Baileys#2847.
//
// Runs on `postinstall`. Safe to run twice: it skips when already patched and
// fails loudly if the Baileys code no longer matches (time to revisit the patch).
import fs from "node:fs";
import path from "node:path";

const file = path.resolve("node_modules/@whiskeysockets/baileys/lib/Socket/messages-send.js");
const before = "const mediaType = getMediaType(message);";
const after = "const mediaType = getMediaType(normalizeMessageContent(message) || message);";

if (!fs.existsSync(file)) {
    console.log("[patch-baileys] Baileys not installed, nothing to patch.");
    process.exit(0);
}

const source = fs.readFileSync(file, "utf8");
if (source.includes(after)) {
    console.log("[patch-baileys] Already patched.");
    process.exit(0);
}
if (!source.includes(before)) {
    console.error(`[patch-baileys] Expected code not found in ${file}. Baileys changed; review scripts/patch-baileys.mjs.`);
    process.exit(1);
}

fs.writeFileSync(file, source.replace(before, after));
console.log("[patch-baileys] Patched view-once mediatype in relayMessage.");
