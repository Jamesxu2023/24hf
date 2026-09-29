import test from "node:test";
import assert from "node:assert/strict";
import { synthesizeSpeech, voiceFor } from "../netlify/functions/_shared/tts.mjs";

test("a spoken line comes back as audio", async () => {
  const audio = await synthesizeSpeech({
    text: "今天就这一句。谁付钱，写在账单上。",
    voice: voiceFor("詹姆斯"),
    rate: -6,
    pitch: 0,
  });
  assert.ok(audio.length > 1000);
  assert.equal(audio[0], 0xff);
  assert.equal((audio[1] & 0xe0), 0xe0);
});
