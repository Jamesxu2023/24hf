import { PEOPLE } from "../../public/voices.js";
import { synthesizeSpeech } from "./_shared/tts.mjs";

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "只收 POST" }, 405);
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "没有读懂" }, 400);
  }
  const person = PEOPLE[body.speaker];
  if (!person) return json({ error: "说话人要是詹姆斯、老麦或林晚" }, 400);
  try {
    const audio = await synthesizeSpeech({
      text: body.text,
      voice: person.voice,
      lang: person.lang,
      rate: body.rate ?? person.rate,
      pitch: body.pitch ?? person.pitch,
    });
    return json({ audio: `data:audio/mpeg;base64,${audio.toString("base64")}` });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "这一句没录上" }, 502);
  }
};

export const config = {
  path: "/api/synthesize",
  method: "POST",
};
