const SECTIONS = ["开场", "事实", "判断", "收束"];

const FINANCE = {
  tag: "这是 24H Finance。",
  close: "世界不会停止变化。市场不会停止波动。但判断，可以慢一点。",
};

function chars(value) {
  return [...String(value || "")].length;
}

function stripEnd(value) {
  return String(value || "").replace(/[。！？\s]+$/u, "").trim();
}

function ensureEnd(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /[。！？]$/u.test(text) ? text : `${text}。`;
}

function bare(value) {
  return String(value || "").replace(/[\s。！？，、；：:""「」《》]/gu, "");
}

function unique(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = bare(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function sentences(text) {
  const out = [];
  for (const line of String(text || "").split(/\n+/u)) {
    const cleaned = line.replace(/^[\s\-*•\d.、]+/u, "").trim();
    if (!cleaned) continue;
    const parts = cleaned.split(/(?<=[。！？])/u).map((part) => part.trim()).filter(Boolean);
    out.push(...(parts.length ? parts : [cleaned]));
  }
  return out;
}

function breaths(sentence) {
  const clean = stripEnd(sentence);
  if (!clean) return [];
  if (chars(clean) <= 78) return [ensureEnd(clean)];
  const parts = clean.split(/[，、]/u).map((part) => part.trim()).filter(Boolean);
  const chunks = [];
  let buf = "";
  for (const part of parts) {
    const next = buf ? `${buf}，${part}` : part;
    if (chars(next) > 78 && buf) {
      chunks.push(ensureEnd(buf));
      buf = part;
    } else {
      buf = next;
    }
  }
  if (buf) chunks.push(ensureEnd(buf));
  return chunks.length ? chunks : [ensureEnd(clean)];
}

function parseDirective(sentence) {
  if (!/不要|别只|别光|避免/u.test(sentence)) return null;
  const marker = sentence.match(/不要|别只|别光|避免/u);
  const lead = stripEnd(sentence.slice(0, marker.index).replace(/[，、\s]+$/u, ""));
  const rest = sentence.slice(marker.index);
  const avoidMatch = rest.match(/(?:不要|别只|别光|避免)(?:只)?(?:讲|说|谈|写)?([^，。！？]+)/u);
  const avoid = avoidMatch ? avoidMatch[1].replace(/^[的\s]+/u, "").trim() : "";
  return {
    lead: chars(lead) >= 4 ? lead : "",
    avoid: chars(avoid) >= 2 && chars(avoid) <= 18 ? avoid : "",
  };
}

function parseMaterial(text) {
  const facts = [];
  for (const sentence of sentences(text)) {
    const directive = parseDirective(sentence);
    if (directive) {
      if (directive.lead) facts.push(directive.lead);
      continue;
    }
    const fact = stripEnd(sentence);
    if (chars(fact) >= 4) facts.push(fact);
  }
  return unique(facts);
}

function segment(section, text, origin) {
  return { section, speaker: "詹姆斯", text: ensureEnd(text), origin };
}

function parseLabeled(text) {
  const lines = String(text || "").split(/\n/u).map((line) => line.trim()).filter(Boolean);
  const content = lines.filter((line) => !SECTIONS.includes(line));
  if (content.length < 3) return null;
  let section = "正文";
  const parsed = [];
  let hits = 0;
  for (const line of lines) {
    if (SECTIONS.includes(line)) {
      section = line;
      continue;
    }
    const match = line.match(/^(开场|事实|判断|收束)?\s*詹姆斯\s*[：:]\s*(.+)$/u);
    if (!match) continue;
    hits += 1;
    parsed.push(segment(match[1] || section, match[2], "script"));
  }
  if (hits < 3 || hits < content.length * 0.6) return null;
  return parsed;
}

function suggestTitle(segments) {
  const first = segments.find((item) => item.origin === "user" || item.origin === "script");
  if (!first) return "";
  const clause = stripEnd(first.text).split(/[，、]/u)[0];
  return chars(clause) <= 22 ? clause : "";
}

function finish(segments, program, mode) {
  const spoken = segments.reduce((sum, item) => sum + chars(item.text), 0);
  return {
    program: program || "24H Finance",
    mode,
    title: suggestTitle(segments),
    subtitle: "",
    minutes: Math.max(1, Math.round((spoken / 3.7 / 60) * 10) / 10),
    segments,
  };
}

export function castBrief({ material, program } = {}) {
  const text = String(material || "").replace(/\r/gu, "").trim();
  if (chars(text) < 8) return { error: "先写完整一点。一句事实就够。" };
  const labeled = parseLabeled(text);
  if (labeled) return finish(labeled, program, "script");
  const facts = parseMaterial(text);
  if (!facts.length) return { error: "没有能开口的句子。" };
  const segments = [];
  for (const breath of breaths(facts[0])) segments.push(segment("开场", breath, "user"));
  segments.push(segment("开场", FINANCE.tag, "show"));
  const rest = facts.slice(1);
  const judgment = rest.length > 1 ? rest[rest.length - 1] : "";
  for (const fact of (judgment ? rest.slice(0, -1) : rest)) {
    for (const breath of breaths(fact)) segments.push(segment("事实", breath, "user"));
  }
  if (judgment) {
    for (const breath of breaths(judgment)) segments.push(segment("判断", breath, "user"));
  }
  segments.push(segment("收束", FINANCE.close, "show"));
  return finish(segments, program, "brief");
}

export function grounded(episode, material) {
  const source = bare(material);
  const allowed = [stripEnd(FINANCE.tag), stripEnd(FINANCE.close)];
  const problems = [];
  for (const item of episode.segments || []) {
    if (item.speaker !== "詹姆斯") problems.push(item.text);
    if (item.origin === "show") {
      if (!allowed.includes(stripEnd(item.text))) problems.push(item.text);
    } else if (item.origin === "user" || item.origin === "script") {
      if (!source.includes(bare(item.text))) problems.push(item.text);
    }
  }
  return problems;
}

export { FINANCE, SECTIONS };
