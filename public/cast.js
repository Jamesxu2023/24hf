const SPEAKERS = ["詹姆斯", "老麦", "林晚"];
const SECTIONS = ["开场", "人物", "第一轮", "交叉", "冷刀", "结尾"];
const MONEY = /费|钱|成本|价|税|预算|账单|保费|赔偿/;

const SHOW = {
  frame(program) {
    return `今天《${program || "东西两说"}》换个开法。两个人，各站一岸。`;
  },
  introShort: "老麦做过保险。林晚做过编辑。",
  introA: "老麦做过海运保险，在新加坡和香港算过保费。",
  introB: "林晚做过海外中文媒体的编辑。",
  closeShort: "判断，可以慢一点。",
  closeA: "世界不会停止变化。情绪也不会停止翻涌。但判断，可以慢一点。",
  closeB: "下期继续，看同一件事的另一面。",
  spoil: "先别鼓掌。",
  sameThing: "同一件事？",
  noOtherShore: "没有第二边。",
  noSecondLine: "账上没有第二行。",
  putDown: "这句先放下。",
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

function findPrice(text) {
  const match = String(text || "").match(
    /\d+(?:\.\d+)?\s*[%％]|百分之[一二三四五六七八九十百零两\d]+|[一二三四五六七八九十两]+成/u,
  );
  return match ? match[0].replace(/\s/gu, "") : "";
}

function parseDirective(sentence) {
  if (!/不要|别只|别光|避免/u.test(sentence)) return null;
  const marker = sentence.match(/不要|别只|别光|避免/u);
  const lead = stripEnd(sentence.slice(0, marker.index).replace(/[，、\s]+$/u, ""));
  const rest = sentence.slice(marker.index);
  const avoidMatch = rest.match(/(?:不要|别只|别光|避免)(?:只)?(?:讲|说|谈|写)?([^，。！？]+)/u);
  const avoid = avoidMatch ? avoidMatch[1].replace(/^[的\s]+/u, "").trim() : "";
  const angles = [];
  const want = rest.match(/(?:要|重点)?(?:讨论|看|问|谈)([^。！？]*)/u);
  if (want) {
    for (const piece of want[1].split(/以及|，|、/u)) {
      const angle = piece.replace(/^(要|讨论|看|问|谈)/u, "").trim();
      if (chars(angle) >= 4) angles.push(stripEnd(angle));
    }
  }
  return {
    lead: chars(lead) >= 4 ? lead : "",
    avoid: chars(avoid) >= 2 && chars(avoid) <= 18 ? avoid : "",
    angles,
  };
}

function parseMaterial(text) {
  const facts = [];
  const angles = [];
  let avoid = "";
  for (const sentence of sentences(text)) {
    const directive = parseDirective(sentence);
    if (directive) {
      if (directive.lead) facts.push(directive.lead);
      if (directive.avoid && !avoid) avoid = directive.avoid;
      angles.push(...directive.angles);
      continue;
    }
    const fact = stripEnd(sentence);
    if (chars(fact) >= 4) facts.push(fact);
  }
  return {
    facts: unique(facts),
    angles: unique(angles),
    avoid,
  };
}

function segment(section, speaker, text, origin) {
  return { section, speaker, text: ensureEnd(text), origin };
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
    const match = line.match(/^(开场|人物|第一轮|交叉|冷刀|结尾)?\s*(詹姆斯|老麦|林晚)\s*[：:]\s*(.+)$/u);
    if (!match) continue;
    hits += 1;
    parsed.push(segment(match[1] || section, match[2], match[3], "script"));
  }
  if (hits < 3 || hits < content.length * 0.6) return null;
  return parsed;
}

function fragment(text) {
  const clean = stripEnd(text);
  if (!clean) return "";
  const comma = clean
    .split(/[，、]/u)
    .map((part) => part.trim())
    .filter((part) => chars(part) >= 4 && chars(part) <= 18 && chars(part) < chars(clean));
  if (comma.length) return comma[comma.length - 1];
  const after = clean.split(/[的了]/u).map((part) => part.trim()).filter(Boolean).pop();
  if (after && after !== clean && chars(after) >= 4 && chars(after) <= 10) return after;
  const price = findPrice(clean);
  if (price && bare(price) !== bare(clean)) return price;
  return "";
}

function assignShores(lines) {
  const draft = lines.map((line) => ({
    line,
    speaker: MONEY.test(line) || findPrice(line) ? "老麦" : "林晚",
  }));
  const speakers = new Set(draft.map((item) => item.speaker));
  if (draft.length >= 2 && speakers.size < 2) {
    const missing = draft[0].speaker === "老麦" ? "林晚" : "老麦";
    draft[draft.length - 1].speaker = missing;
  }
  return draft;
}

function suggestTitle(segments) {
  const first = segments.find((item) => item.origin === "user" || item.origin === "script");
  if (!first) return "";
  const clause = stripEnd(first.text).split(/[，、]/u)[0];
  return chars(clause) <= 22 ? clause : "";
}

function suggestSubtitle(angles) {
  const angle = angles.find((item) => chars(item) <= 28);
  return angle || "";
}

function finish(segments, program, mode, angles) {
  const spoken = segments.reduce((sum, item) => sum + chars(item.text), 0);
  return {
    program: program || "东西两说",
    mode,
    title: suggestTitle(segments),
    subtitle: suggestSubtitle(angles || []),
    minutes: Math.max(1, Math.round((spoken / 3.7 / 60) * 10) / 10),
    segments,
  };
}

export function castEpisode({ material, program } = {}) {
  const text = String(material || "").replace(/\r/gu, "").trim();
  if (chars(text) < 8) {
    return { error: "先写完整一点。一句事实就够。" };
  }

  const labeled = parseLabeled(text);
  if (labeled) return finish(labeled, program, "script", []);

  const { facts, angles, avoid } = parseMaterial(text);
  if (!facts.length && !angles.length && !avoid) {
    return { error: "没有能开口的句子。" };
  }

  const weight = [...facts, ...angles, avoid].join("").length;
  const full = weight >= 120;
  const segments = [];
  const opening = facts[0] || angles[0] || avoid;
  const rest = facts[0] ? facts.slice(1) : facts;

  for (const breath of breaths(opening)) {
    segments.push(segment("开场", "詹姆斯", breath, "user"));
  }
  segments.push(segment("开场", "詹姆斯", SHOW.frame(program), "show"));

  if (full) {
    segments.push(segment("人物", "詹姆斯", SHOW.introA, "show"));
    segments.push(segment("人物", "詹姆斯", SHOW.introB, "show"));
  } else {
    segments.push(segment("人物", "詹姆斯", SHOW.introShort, "show"));
  }

  const roundLines = [...angles, ...rest];
  const assigned = assignShores(roundLines);
  const round = [];
  if (avoid) round.push(segment("第一轮", "林晚", `${avoid}，${SHOW.putDown}`, "cut"));
  for (const item of assigned) {
    for (const breath of breaths(item.line)) {
      round.push(segment("第一轮", item.speaker, breath, "user"));
    }
  }

  const price = findPrice([...facts, ...angles].join("。"));
  if (price) round.push(segment("第一轮", "老麦", price, "user"));

  const userLines = round.filter((item) => item.origin === "user");
  const hasMai = userLines.some((item) => item.speaker === "老麦");
  const hasLin = userLines.some((item) => item.speaker === "林晚") || Boolean(avoid);
  if (hasMai && hasLin) {
    const index = round.findIndex((item) => item.speaker === "林晚");
    round.splice(Math.max(index, 0), 0, segment("第一轮", "林晚", SHOW.spoil, "show"));
  } else if (!hasLin) {
    round.push(segment("第一轮", "林晚", SHOW.noOtherShore, "show"));
  } else if (!hasMai) {
    round.push(segment("第一轮", "老麦", SHOW.noSecondLine, "show"));
  }
  segments.push(...round);

  const pieces = unique([opening, ...angles, ...rest].map(fragment).filter(Boolean));
  const fresh = pieces.filter((piece) => !userLines.some((item) => bare(item.text) === bare(piece)));
  if (fresh.length >= 1 && pieces.length >= 2) {
    const left = pieces[0];
    const right = pieces[pieces.length - 1];
    if (bare(left) !== bare(right)) {
      segments.push(segment("交叉", "老麦", SHOW.sameThing, "show"));
      segments.push(segment("交叉", "林晚", fresh.includes(right) ? right : left, "user"));
      if (fresh.includes(left) && bare(left) !== bare(right)) {
        segments.push(segment("交叉", "老麦", left, "user"));
      }
    }
  }
  if (pieces.length >= 2 && bare(pieces[0]) !== bare(pieces[pieces.length - 1])) {
    const said = new Set(
      segments.filter((item) => item.section === "交叉" && item.origin === "user").map((item) => bare(item.text)),
    );
    const bothSaid = said.has(bare(pieces[0])) && said.has(bare(pieces[pieces.length - 1]));
    if (!bothSaid) {
      segments.push(segment("冷刀", "林晚", `${stripEnd(pieces[0])}。${ensureEnd(pieces[pieces.length - 1])}`, "cut"));
    }
  }

  segments.push(segment("结尾", "詹姆斯", full ? SHOW.closeA : SHOW.closeShort, "show"));
  if (full) segments.push(segment("结尾", "詹姆斯", SHOW.closeB, "show"));

  return finish(segments, program, "model", angles);
}

export function grounded(episode, material) {
  const source = bare(material);
  const problems = [];
  for (const item of episode.segments || []) {
    if (item.origin === "show") {
      const allowed = Object.values(SHOW)
        .filter((value) => typeof value === "string")
        .map((value) => stripEnd(value));
      const dynamic = stripEnd(item.text).startsWith("今天《") && stripEnd(item.text).endsWith("两个人，各站一岸");
      if (!dynamic && !allowed.includes(stripEnd(item.text))) {
        problems.push(item.text);
      }
    } else if (item.origin === "user" || item.origin === "script") {
      if (!source.includes(bare(item.text))) problems.push(item.text);
    } else if (item.origin === "cut") {
      const body = item.text.replace(/这句先放下。$/u, "");
      for (const piece of body.split(/[。！？]/u)) {
        if (bare(piece) && !source.includes(bare(piece))) problems.push(item.text);
      }
    }
  }
  return problems;
}

export { SECTIONS, SPEAKERS, SHOW };
