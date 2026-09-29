import crypto from "node:crypto";
import WebSocket from "ws";
import { PEOPLE } from "../../../public/voices.js";

const TRUSTED = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM = "143.0.3650.75";

function secMsGec() {
  let ticks = Date.now() / 1000 + 11644473600;
  ticks -= ticks % 300;
  ticks = Math.round(ticks * 1e7);
  return crypto.createHash("sha256").update(`${ticks}${TRUSTED}`).digest("hex").toUpperCase();
}

function escapeSsml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function prosody(rate, pitch) {
  const safeRate = Math.max(-30, Math.min(20, Number(rate) || 0));
  const safePitch = Math.max(-8, Math.min(8, Number(pitch) || 0));
  const rateText = `${safeRate >= 0 ? "+" : ""}${safeRate}%`;
  const pitchText = `${safePitch >= 0 ? "+" : ""}${safePitch}Hz`;
  return { rateText, pitchText };
}

function takeAudio(buffer) {
  if (buffer.length < 2) return Buffer.alloc(0);
  const headerLength = buffer.readUInt16BE(0);
  const start = headerLength + 2;
  if (start >= buffer.length) return Buffer.alloc(0);
  return buffer.subarray(start);
}

export function voiceFor(speaker) {
  return PEOPLE[speaker]?.voice || "";
}

export function synthesizeSpeech({ text, voice, lang = "zh-CN", rate = 0, pitch = 0 }) {
  const spoken = String(text || "").trim();
  if (!spoken) return Promise.reject(new Error("这一句是空的"));
  if ([...spoken].length > 320) return Promise.reject(new Error("这一句太长，先切开"));
  const { rateText, pitchText } = prosody(rate, pitch);
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice}"><prosody rate="${rateText}" pitch="${pitchText}">${escapeSsml(spoken)}</prosody></voice></speak>`;
  const connectionId = crypto.randomUUID().replace(/-/g, "");
  const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=1-${CHROMIUM}&ConnectionId=${connectionId}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: {
        "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM.split(".")[0]}.0.0.0 Safari/537.36 Edg/${CHROMIUM.split(".")[0]}.0.0.0`,
        "Accept-Language": "en-US,en;q=0.9",
        Pragma: "no-cache",
        "Cache-Control": "no-cache",
        Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        Cookie: `muid=${crypto.randomBytes(16).toString("hex").toUpperCase()};`,
      },
    });
    const chunks = [];
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("这一句等太久了"));
    }, 20000);

    ws.on("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      reject(new Error(response.statusCode === 403 ? "声线暂时接不上" : "声线没有接上"));
    });
    ws.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(error.message || "声线中断"));
    });
    ws.on("open", () => {
      ws.send(
        `X-Timestamp:${new Date().toISOString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`,
      );
      ws.send(
        `X-RequestId:${crypto.randomUUID()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toISOString()}Z\r\nPath:ssml\r\n\r\n${ssml}`,
      );
    });
    ws.on("message", (data, isBinary) => {
      if (!isBinary) {
        if (data.toString().includes("Path:turn.end")) {
          clearTimeout(timer);
          const audio = Buffer.concat(chunks);
          ws.close();
          if (audio.length < 400) reject(new Error("这一句没有录上"));
          else resolve(audio);
        }
        return;
      }
      const piece = takeAudio(Buffer.from(data));
      if (piece.length) chunks.push(piece);
    });
  });
}
