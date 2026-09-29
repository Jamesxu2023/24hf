import { castEpisode, SECTIONS, SPEAKERS } from "./cast.js";
import { PEOPLE } from "./voices.js";

const STORAGE = "dongxi-desk-v2";
const THEMES = {
  strait: { bg: "#9bb7bd", ink: "#11120f", accent: "#ff5a23", paper: "#eee8da" },
  breaking: { bg: "#d63b2f", ink: "#160e0b", accent: "#f2d84b", paper: "#f4ead9" },
  midnight: { bg: "#172238", ink: "#080b12", accent: "#e8b44c", paper: "#edf0ec" },
  paper: { bg: "#e6dfcf", ink: "#181713", accent: "#cc3c24", paper: "#f7f2e8" },
};

const $ = (id) => document.getElementById(id);
const state = load();
let busy = false;
let audioUrl = "";
const clips = new Map();

function load() {
  const blank = {
    episodes: [],
    activeId: "",
    voices: Object.fromEntries(Object.entries(PEOPLE).map(([name, person]) => [name, { rate: person.rate, pitch: person.pitch }])),
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) || "null");
    if (!saved || !Array.isArray(saved.episodes)) return blank;
    saved.voices = { ...blank.voices, ...saved.voices };
    return saved;
  } catch {
    return blank;
  }
}

function save() {
  localStorage.setItem(STORAGE, JSON.stringify({
    episodes: state.episodes,
    activeId: state.activeId,
    voices: state.voices,
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
    program: field("program") || "东西两说",
    number: field("number"),
    title: field("title"),
    subtitle: field("subtitle"),
    theme: $("theme").value,
  };
}

function writeSheet(episode) {
  $("program").value = episode?.program || "东西两说";
  $("number").value = episode?.number || "";
  $("title").value = episode?.title || "";
  $("subtitle").value = episode?.subtitle || "";
  $("theme").value = episode?.theme || "strait";
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
  const episode = castEpisode({ material, program: sheet.program });
  if (episode.error) {
    showError(episode.error);
    return null;
  }
  const next = {
    id: uid("ep"),
    material,
    program: sheet.program,
    number: sheet.number,
    title: sheet.title || episode.title,
    subtitle: sheet.subtitle || episode.subtitle,
    theme: sheet.theme || "strait",
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
  $("subtitle").value = next.subtitle;
  setStatus(`口播大约 ${next.minutes} 分钟。先看稿，再录。`);
  render();
  $("work").scrollIntoView({ behavior: "smooth", block: "start" });
  return next;
}

async function synthesize(segment) {
  const person = state.voices[segment.speaker] || PEOPLE[segment.speaker];
  const response = await fetch("/api/synthesize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: segment.text,
      speaker: segment.speaker,
      rate: person.rate,
      pitch: person.pitch,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "这句没录上");
  return body.audio;
}

async function playSource(source) {
  const player = $("player");
  player.src = source;
  try { await player.play(); } catch { /* autoplay can be blocked until the next tap */ }
}

async function hear(segment) {
  if (busy) return;
  busy = true;
  showError("");
  const button = document.querySelector(`[data-hear="${segment.id}"]`);
  if (button) button.textContent = "在录";
  try {
    const key = `${state.activeId}:${segment.id}:${segment.text}:${segment.speaker}`;
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
      if (part.speaker !== next.speaker) return 0.3;
      return 0.16;
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
      setStatus(`在出声 ${index + 1}/${lines.length} · ${segment.speaker}`);
      const key = `${episode.id}:${segment.id}:${segment.text}:${segment.speaker}`;
      const source = clips.get(key) || await synthesize(segment);
      clips.set(key, source);
      parts.push({ source, section: segment.section, speaker: segment.speaker });
    }
    setStatus("在把几段接起来");
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
      link.download = `${episode.program || "podcast"}-${episode.number || "000"}-${episode.title || "episode"}.wav`;
      link.click();
    };
    setStatus("这期接好了。");
    try { await player.play(); } catch { /* the player is there if the browser blocks autoplay */ }
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
  const theme = THEMES[episode?.theme] || THEMES.strait;
  const node = $("cover");
  node.style.background = theme.bg;
  node.style.color = theme.paper;
  const title = episode?.title || "未命名";
  const program = episode?.program || "东西两说";
  const number = episode?.number ? `EP.${episode.number}` : "";
  node.innerHTML = `<em>${esc(program)}</em><strong>${esc(title)}</strong><span>${esc(episode?.subtitle || "")}</span>${number ? `<b class="num">${esc(number)}</b>` : ""}`;
  node.style.setProperty("--accent", theme.accent);
  const num = node.querySelector(".num");
  if (num) num.style.color = theme.accent;
}

async function downloadCover() {
  const episode = active();
  if (!episode) return;
  await document.fonts.ready;
  const theme = THEMES[episode.theme] || THEMES.strait;
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 900;
  const pen = canvas.getContext("2d");
  pen.fillStyle = theme.bg;
  pen.fillRect(0, 0, 1600, 900);
  pen.fillStyle = theme.ink;
  pen.save();
  pen.translate(-80, -120);
  pen.rotate(-0.2);
  pen.fillRect(0, 0, 280, 1200);
  pen.restore();
  pen.fillStyle = theme.paper;
  pen.fillRect(120, 78, 280, 58);
  pen.fillStyle = theme.ink;
  pen.font = "700 24px 'Noto Sans SC', sans-serif";
  pen.fillText((episode.program || "东西两说").slice(0, 12), 142, 116);
  if (episode.number) {
    pen.fillStyle = theme.accent;
    pen.font = "900 72px ui-monospace, monospace";
    pen.textAlign = "right";
    pen.fillText(`EP.${episode.number}`, 1460, 140);
    pen.textAlign = "left";
  }
  pen.fillStyle = theme.paper;
  pen.font = "900 92px 'Noto Serif SC', serif";
  wrap(pen, episode.title || "未命名", 120, 280, 1080, 110, 4);
  pen.strokeStyle = theme.ink;
  pen.lineWidth = 3;
  pen.beginPath();
  pen.moveTo(120, 760);
  pen.lineTo(980, 760);
  pen.stroke();
  pen.fillStyle = theme.ink;
  pen.font = "700 36px 'Noto Serif SC', serif";
  wrap(pen, episode.subtitle || "", 120, 820, 1000, 46, 1);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${episode.program || "podcast"}-${episode.number || "000"}-cover.png`;
    link.click();
    URL.revokeObjectURL(url);
  }, "image/png");
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

function renderVoices() {
  $("voices").innerHTML = SPEAKERS.map((name, index) => {
    const voice = state.voices[name];
    return `<article class="voice">
      <h3>${name}</h3>
      <p>${esc(PEOPLE[name].note)}</p>
      <div class="sliders">
        <label>语速 ${voice.rate > 0 ? "+" : ""}${voice.rate}%<input data-rate="${name}" type="range" min="-24" max="8" step="1" value="${voice.rate}"></label>
        <label>音高 ${voice.pitch > 0 ? "+" : ""}${voice.pitch}<input data-pitch="${name}" type="range" min="-8" max="4" step="1" value="${voice.pitch}"></label>
      </div>
      <button type="button" data-sample="${name}">听一句 ${index + 1}</button>
    </article>`;
  }).join("");
}

function renderLibrary() {
  const node = $("library");
  if (!state.episodes.length) {
    node.innerHTML = `<p class="help">还没有留下的稿。</p>`;
    return;
  }
  node.innerHTML = state.episodes.map((episode) => `<button type="button" class="tab ${episode.id === state.activeId ? "active" : ""}" data-open="${episode.id}">
    <span>${esc(episode.program)} ${episode.number ? `· ${esc(episode.number)}` : ""}</span>
    <b>${esc(episode.title || "未命名")}</b>
    <small>${episode.segments.length} 句</small>
  </button>`).join("");
}

function renderScript(episode) {
  $("work").hidden = !episode;
  $("meta").textContent = episode ? `${state.episodes.length} 期稿` : "还没有成品";
  if (!episode) return;
  $("work-title").textContent = episode.title || "未命名";
  $("download-audio").disabled = !audioUrl;
  renderCover(episode);
  $("script").innerHTML = episode.segments.map((segment, index) => `<article class="line">
    <div class="line-meta">
      <select data-section="${segment.id}" aria-label="段落">${(SECTIONS.includes(segment.section) ? SECTIONS : [segment.section, ...SECTIONS]).map((section) => `<option ${section === segment.section ? "selected" : ""}>${section}</option>`).join("")}</select>
      <select data-speaker="${segment.id}" aria-label="说话人">${SPEAKERS.map((speaker) => `<option ${speaker === segment.speaker ? "selected" : ""}>${speaker}</option>`).join("")}</select>
      <small>${String(index + 1).padStart(2, "0")}</small>
    </div>
    <textarea data-text="${segment.id}" aria-label="${esc(segment.speaker)}的句子">${esc(segment.text)}</textarea>
    <div class="line-actions">
      <button type="button" data-hear="${segment.id}">听这句</button>
      <button type="button" data-drop="${segment.id}">删</button>
    </div>
  </article>`).join("");
}

function render() {
  const episode = active();
  renderScript(episode);
  renderVoices();
  renderLibrary();
}

function onSheet(event) {
  const episode = active();
  if (!episode) return;
  const id = event.target.id;
  if (!["program", "number", "title", "subtitle", "theme", "material"].includes(id)) return;
  touch({
    program: field("program") || "东西两说",
    number: field("number"),
    title: field("title"),
    subtitle: field("subtitle"),
    theme: $("theme").value,
    material: $("material").value,
  });
  if (id === "title" || id === "subtitle" || id === "theme" || id === "program" || id === "number") renderCover(active());
  if (id === "title") $("work-title").textContent = field("title") || "未命名";
}

$("cut").addEventListener("click", cut);
$("record").addEventListener("click", () => { record(); });
$("download-cover").addEventListener("click", () => { downloadCover(); });
$("add-line").addEventListener("click", () => {
  const episode = active();
  if (!episode) return;
  episode.segments.push({ id: uid("line"), section: "第一轮", speaker: "林晚", text: "", origin: "script" });
  touch({});
  render();
});
$("sheet").addEventListener("input", onSheet);
$("theme").addEventListener("change", onSheet);

$("script").addEventListener("input", (event) => {
  const episode = active();
  if (!episode) return;
  const id = event.target.dataset.text;
  if (!id) return;
  const segment = episode.segments.find((item) => item.id === id);
  if (!segment) return;
  segment.text = event.target.value;
  touch({});
});
$("script").addEventListener("change", (event) => {
  const episode = active();
  if (!episode) return;
  const sectionId = event.target.dataset.section;
  const speakerId = event.target.dataset.speaker;
  const segment = episode.segments.find((item) => item.id === (sectionId || speakerId));
  if (!segment) return;
  if (sectionId) segment.section = event.target.value;
  if (speakerId) segment.speaker = event.target.value;
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

$("voices").addEventListener("input", (event) => {
  const rateName = event.target.dataset.rate;
  const pitchName = event.target.dataset.pitch;
  const name = rateName || pitchName;
  if (!name) return;
  if (rateName) state.voices[name].rate = Number(event.target.value);
  if (pitchName) state.voices[name].pitch = Number(event.target.value);
  save();
  renderVoices();
});
$("voices").addEventListener("click", (event) => {
  const name = event.target.dataset.sample;
  if (!name || busy) return;
  hear({
    id: `sample-${name}`,
    speaker: name,
    text: PEOPLE[name].sample,
    section: "人物",
  });
});

$("library").addEventListener("click", (event) => {
  const id = event.target.closest("[data-open]")?.dataset.open;
  if (!id) return;
  state.activeId = id;
  audioUrl = "";
  $("player").removeAttribute("src");
  $("download-audio").disabled = true;
  const episode = active();
  writeSheet(episode);
  save();
  render();
});

$("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ version: 1, episodes: state.episodes, voices: state.voices }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dongxi-desk-${new Date().toISOString().slice(0, 10)}.json`;
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
    if (data.voices) state.voices = { ...state.voices, ...data.voices };
    save();
    writeSheet(active());
    render();
  } catch (error) {
    showError(error instanceof Error ? error.message : "没导入");
  }
});

render();
if (active()) writeSheet(active());
