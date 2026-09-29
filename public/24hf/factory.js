import { castBrief, SECTIONS } from "./cast.js";
import { PEOPLE } from "../voices.js";

const STORAGE = "24hf-factory-v1";
const HOST = "詹姆斯";
const $ = (id) => document.getElementById(id);
const state = load();
let busy = false;
let audioUrl = "";
const clips = new Map();

function load() {
  const person = PEOPLE[HOST];
  const blank = {
    episodes: [],
    activeId: "",
    voice: { rate: person.rate, pitch: person.pitch },
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) || "null");
    if (!saved || !Array.isArray(saved.episodes)) return blank;
    saved.voice = { ...blank.voice, ...saved.voice };
    return saved;
  } catch {
    return blank;
  }
}

function save() {
  localStorage.setItem(STORAGE, JSON.stringify({
    episodes: state.episodes,
    activeId: state.activeId,
    voice: state.voice,
  }));
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function active() {
  return state.episodes.find((episode) => episode.id === state.activeId) || null;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

function showError(message) {
  const node = $("error");
  node.hidden = !message;
  node.textContent = message || "";
}

function setStatus(message) {
  $("status").textContent = message || "";
}

function field(id) {
  return $(id).value.trim();
}

function readSheet() {
  return {
    number: field("number"),
    title: field("title"),
    subtitle: field("subtitle"),
  };
}

function writeSheet(episode) {
  $("number").value = episode?.number || "";
  $("title").value = episode?.title || "";
  $("subtitle").value = episode?.subtitle || "";
  $("material").value = episode?.material || $("material").value;
}

function touch(patch) {
  const episode = active();
  if (!episode) return;
  Object.assign(episode, patch, { updatedAt: new Date().toISOString() });
  save();
}

function cut() {
  showError("");
  const material = $("material").value.trim();
  const sheet = readSheet();
  const episode = castBrief({ material, program: "24H Finance" });
  if (episode.error) {
    showError(episode.error);
    return null;
  }
  const next = {
    id: uid("ep"),
    material,
    program: "24H Finance",
    number: sheet.number,
    title: sheet.title || episode.title,
    subtitle: sheet.subtitle,
    minutes: episode.minutes,
    segments: episode.segments.map((segment) => ({ ...segment, id: uid("line") })),
    updatedAt: new Date().toISOString(),
  };
  state.episodes.unshift(next);
  state.activeId = next.id;
  audioUrl = "";
  clips.clear();
  save();
  $("title").value = next.title;
  setStatus(`口播大约 ${next.minutes} 分钟。`);
  render();
  $("work").scrollIntoView({ behavior: "smooth", block: "start" });
  return next;
}

async function synthesize(segment) {
  const response = await fetch("/api/synthesize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: segment.text,
      speaker: HOST,
      rate: state.voice.rate,
      pitch: state.voice.pitch,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "这句没录上");
  return body.audio;
}

async function playSource(source) {
  const player = $("player");
  player.src = source;
  try { await player.play(); } catch { /* autoplay can wait for the next tap */ }
}

async function hear(segment) {
  if (busy) return;
  busy = true;
  showError("");
  try {
    const key = `${state.activeId}:${segment.id}:${segment.text}`;
    const source = clips.get(key) || await synthesize(segment);
    clips.set(key, source);
    await playSource(source);
  } catch (error) {
    showError(error instanceof Error ? error.message : "这句没录上");
  } finally {
    busy = false;
    render();
  }
}

function wavBlob(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * 2, clamped < 0 ? clamped * 32768 : clamped * 32767, true);
  });
  return new Blob([buffer], { type: "audio/wav" });
}

async function stitch(parts) {
  const context = new AudioContext();
  try {
    const buffers = await Promise.all(parts.map(async (part) => {
      const response = await fetch(part.source);
      return context.decodeAudioData(await response.arrayBuffer());
    }));
    const gaps = parts.map((part, index) => {
      const next = parts[index + 1];
      if (!next) return 0.45;
      if (part.section !== next.section) return 0.52;
      return 0.22;
    });
    const total = buffers.reduce((sum, buffer, index) => sum + buffer.length + Math.round(gaps[index] * context.sampleRate), 0);
    const mixed = new Float32Array(total);
    let offset = 0;
    buffers.forEach((buffer, index) => {
      mixed.set(buffer.getChannelData(0), offset);
      offset += buffer.length + Math.round(gaps[index] * context.sampleRate);
    });
    return wavBlob(mixed, context.sampleRate);
  } finally {
    await context.close();
  }
}

async function record() {
  if (busy) return;
  showError("");
  let episode = active();
  if (!episode || !episode.segments.length) episode = cut();
  if (!episode) return;
  const lines = episode.segments.filter((segment) => segment.text.trim());
  if (!lines.length) {
    showError("没有能念的句子。");
    return;
  }
  busy = true;
  $("record").disabled = true;
  $("cut").disabled = true;
  try {
    const parts = [];
    for (let index = 0; index < lines.length; index += 1) {
      const segment = lines[index];
      setStatus(`在出声 ${index + 1}/${lines.length}`);
      const key = `${episode.id}:${segment.id}:${segment.text}`;
      const source = clips.get(key) || await synthesize(segment);
      clips.set(key, source);
      parts.push({ source, section: segment.section });
    }
    setStatus("在接起来");
    const blob = await stitch(parts);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(blob);
    const player = $("player");
    player.src = audioUrl;
    const download = $("download-audio");
    download.disabled = false;
    download.onclick = () => {
      const link = document.createElement("a");
      link.href = audioUrl;
      link.download = `24H-Finance-${episode.number || "000"}-${episode.title || "brief"}.wav`;
      link.click();
    };
    setStatus("这条接好了。");
    try { await player.play(); } catch { /* player stays if autoplay is blocked */ }
  } catch (error) {
    showError(error instanceof Error ? error.message : "没接成");
    setStatus("");
  } finally {
    busy = false;
    $("record").disabled = false;
    $("cut").disabled = false;
    render();
  }
}

function renderCover(episode) {
  const node = $("cover");
  const title = episode?.title || "未命名";
  const number = episode?.number ? `EP.${episode.number}` : "";
  node.innerHTML = `<em>24H FINANCE ${esc(number)}</em><strong>${esc(title)}</strong><span>${esc(episode?.subtitle || "")}</span>`;
}

function wrap(pen, text, x, y, width, lineHeight, maxLines) {
  const chars = [...text];
  const lines = [];
  let line = "";
  for (const char of chars) {
    if (pen.measureText(line + char).width > width && line) {
      lines.push(line);
      line = char;
      if (lines.length === maxLines) break;
    } else {
      line += char;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  lines.forEach((item, index) => pen.fillText(item, x, y + index * lineHeight));
}

async function downloadCover() {
  const episode = active();
  if (!episode) return;
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 900;
  const pen = canvas.getContext("2d");
  pen.fillStyle = "#07080a";
  pen.fillRect(0, 0, 1600, 900);
  pen.fillStyle = "#c9a84c";
  pen.fillRect(0, 0, 1600, 8);
  pen.font = "500 22px 'DM Mono', monospace";
  pen.fillText("24H FINANCE", 96, 120);
  if (episode.number) {
    pen.textAlign = "right";
    pen.fillText(`EP.${episode.number}`, 1504, 120);
    pen.textAlign = "left";
  }
  pen.fillStyle = "#ede8dc";
  pen.font = "700 88px 'Noto Serif SC', serif";
  wrap(pen, episode.title || "未命名", 96, 280, 1300, 104, 3);
  pen.fillStyle = "#c9a84c";
  pen.font = "400 32px 'Noto Serif SC', serif";
  wrap(pen, episode.subtitle || "世界不会停止变化。市场不会停止波动。", 96, 760, 1300, 44, 1);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `24H-Finance-${episode.number || "000"}-cover.png`;
    link.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

function renderScript(episode) {
  $("work").hidden = !episode;
  if (!episode) return;
  $("work-title").textContent = episode.title || "未命名";
  $("download-audio").disabled = !audioUrl;
  renderCover(episode);
  $("script").innerHTML = episode.segments.map((segment, index) => `<article class="line">
    <div class="line-meta">
      <select data-section="${segment.id}" aria-label="段落">${SECTIONS.map((section) => `<option ${section === segment.section ? "selected" : ""}>${section}</option>`).join("")}</select>
      <small>${String(index + 1).padStart(2, "0")}</small>
    </div>
    <textarea data-text="${segment.id}" aria-label="句子">${esc(segment.text)}</textarea>
    <div class="line-actions">
      <button type="button" data-hear="${segment.id}">听这句</button>
      <button type="button" data-drop="${segment.id}">删</button>
    </div>
  </article>`).join("");
}

function renderLibrary() {
  const node = $("library");
  if (!state.episodes.length) {
    node.innerHTML = `<p class="help">还没有留下的稿。</p>`;
    return;
  }
  node.innerHTML = state.episodes.map((episode) => `<button type="button" class="tab ${episode.id === state.activeId ? "active" : ""}" data-open="${episode.id}">
    <span>${episode.number ? esc(episode.number) : "24H"}</span>
    <b>${esc(episode.title || "未命名")}</b>
  </button>`).join("");
}

function renderVoice() {
  $("voice-note").textContent = PEOPLE[HOST].note;
  $("rate").value = state.voice.rate;
  $("pitch").value = state.voice.pitch;
  $("rate-label").textContent = `${state.voice.rate > 0 ? "+" : ""}${state.voice.rate}%`;
  $("pitch-label").textContent = `${state.voice.pitch > 0 ? "+" : ""}${state.voice.pitch}`;
}

function render() {
  renderScript(active());
  renderLibrary();
  renderVoice();
}

$("cut").addEventListener("click", cut);
$("record").addEventListener("click", () => { record(); });
$("download-cover").addEventListener("click", () => { downloadCover(); });
$("add-line").addEventListener("click", () => {
  const episode = active();
  if (!episode) return;
  episode.segments.push({
    id: uid("line"),
    section: "事实",
    speaker: HOST,
    text: "",
    origin: "script",
  });
  touch({});
  render();
});
$("sheet").addEventListener("input", (event) => {
  const episode = active();
  if (!episode) return;
  const id = event.target.id;
  if (!["number", "title", "subtitle", "material"].includes(id)) return;
  touch({
    number: field("number"),
    title: field("title"),
    subtitle: field("subtitle"),
    material: $("material").value,
    program: "24H Finance",
  });
  if (id === "title" || id === "subtitle" || id === "number") renderCover(active());
  if (id === "title") $("work-title").textContent = field("title") || "未命名";
});
$("script").addEventListener("input", (event) => {
  const episode = active();
  if (!episode) return;
  const id = event.target.dataset.text;
  if (!id) return;
  const segment = episode.segments.find((item) => item.id === id);
  if (!segment) return;
  segment.text = event.target.value;
  segment.speaker = HOST;
  touch({});
});
$("script").addEventListener("change", (event) => {
  const episode = active();
  if (!episode) return;
  const sectionId = event.target.dataset.section;
  if (!sectionId) return;
  const segment = episode.segments.find((item) => item.id === sectionId);
  if (!segment) return;
  segment.section = event.target.value;
  touch({});
});
$("script").addEventListener("click", (event) => {
  const episode = active();
  if (!episode) return;
  const hearId = event.target.dataset.hear;
  const dropId = event.target.dataset.drop;
  if (hearId) {
    const segment = episode.segments.find((item) => item.id === hearId);
    if (segment?.text.trim()) hear(segment);
  }
  if (dropId && episode.segments.length > 1) {
    episode.segments = episode.segments.filter((item) => item.id !== dropId);
    touch({});
    render();
  }
});
$("rate").addEventListener("input", () => {
  state.voice.rate = Number($("rate").value);
  save();
  renderVoice();
});
$("pitch").addEventListener("input", () => {
  state.voice.pitch = Number($("pitch").value);
  save();
  renderVoice();
});
$("sample").addEventListener("click", () => {
  if (busy) return;
  hear({ id: "sample", text: PEOPLE[HOST].sample, section: "开场" });
});
$("library").addEventListener("click", (event) => {
  const id = event.target.closest("[data-open]")?.dataset.open;
  if (!id) return;
  state.activeId = id;
  audioUrl = "";
  $("player").removeAttribute("src");
  $("download-audio").disabled = true;
  writeSheet(active());
  save();
  render();
});
$("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ version: 1, episodes: state.episodes, voice: state.voice }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `24hf-factory-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});
$("import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.episodes) || !data.episodes.length) throw new Error("文件里没有稿");
    state.episodes = data.episodes;
    state.activeId = data.episodes[0].id;
    if (data.voice) state.voice = { ...state.voice, ...data.voice };
    save();
    writeSheet(active());
    render();
  } catch (error) {
    showError(error instanceof Error ? error.message : "没导入");
  }
});

render();
if (active()) writeSheet(active());
