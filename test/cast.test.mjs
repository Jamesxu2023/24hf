import test from "node:test";
import assert from "node:assert/strict";
import { castEpisode, grounded } from "../public/cast.js";

const BRIEF = "特朗普取消霍尔木兹20%守护费。不要只讲反复无常，要讨论谁最终承担安全成本，以及伊朗为什么反而得到了一套收费话术。";

test("casts a note into the two-shore shape using the note's own words", () => {
  const episode = castEpisode({ material: BRIEF, program: "东西两说" });
  assert.equal(episode.error, undefined);
  assert.equal(episode.mode, "model");
  const names = episode.segments.map((item) => item.section);
  assert.deepEqual([...new Set(names)].filter((name) => ["开场", "人物", "第一轮", "冷刀", "结尾"].includes(name)).length >= 4, true);
  const spoken = episode.segments.map((item) => item.text).join("");
  assert.match(spoken, /霍尔木兹/);
  assert.match(spoken, /20%/);
  assert.match(spoken, /反复无常/);
  assert.match(spoken, /谁最终承担安全成本/);
  assert.match(spoken, /收费话术/);
  assert.doesNotMatch(spoken, /不要只讲/);
  assert.doesNotMatch(spoken, /值得注意|综上所述|一方面|深入探讨|让我们|至关重要/);
  assert.deepEqual(grounded(episode, BRIEF), []);
  assert.ok(episode.segments.some((item) => item.speaker === "老麦" && item.section === "第一轮"));
  assert.ok(episode.segments.some((item) => item.speaker === "林晚" && item.section === "第一轮"));
  assert.ok(episode.segments.some((item) => item.text.includes("各站一岸")));
});

test("a short fact is not padded into a long essay", () => {
  const material = "保费这个月涨了四成。";
  const episode = castEpisode({ material });
  const spoken = episode.segments.map((item) => item.text).join("");
  assert.ok(spoken.length < material.length * 8);
  assert.equal(episode.segments.filter((item) => item.section === "人物").length, 1);
  assert.deepEqual(grounded(episode, material), []);
});

test("a script with the name on its own line stays in that order", () => {
  const material = [
    "# 澳大利亚人为什么不信AI",
    "### 《东西两说》三人版",
    "**詹姆斯：**",
    "语法错了一个，她反而松了口气。",
    "**老麦：**",
    "而且不是不用。",
    "这个很关键。",
    "**林晚：**",
    "这是两回事。",
  ].join("\n");
  const episode = castEpisode({ material, program: "东西两说" });
  assert.equal(episode.mode, "script");
  assert.equal(episode.title, "澳大利亚人为什么不信AI");
  assert.deepEqual(episode.segments.map((item) => `${item.speaker}:${item.text}`), [
    "詹姆斯:语法错了一个，她反而松了口气。",
    "老麦:而且不是不用。",
    "老麦:这个很关键。",
    "林晚:这是两回事。",
  ]);
  assert.doesNotMatch(episode.segments.map((item) => item.text).join(""), /各站一岸|先别鼓掌/);
  assert.deepEqual(grounded(episode, material), []);
});

test("a labeled script is kept as written", () => {
  const material = ["詹姆斯：今天就这一件。", "老麦：账单上是四成。", "林晚：先别把它说成天气。"].join("\n");
  const episode = castEpisode({ material });
  assert.equal(episode.mode, "script");
  assert.deepEqual(episode.segments.map((item) => item.text), [
    "今天就这一件。",
    "账单上是四成。",
    "先别把它说成天气。",
  ]);
});

test("a finance-shaped note still stays on two shores here", () => {
  const material = "油价从119掉到87。价差却重新拉开。市场买的是说法，不是通道重开。";
  const episode = castEpisode({ material, program: "东西两说" });
  const spoken = episode.segments.map((item) => item.text).join("");
  assert.match(spoken, /各站一岸/);
  assert.match(spoken, /老麦|林晚/);
  assert.doesNotMatch(spoken, /市场不会停止波动/);
  assert.doesNotMatch(spoken, /这是 24H Finance/);
  assert.deepEqual(grounded(episode, material), []);
});

test("two shores stay in the order of the material", () => {
  const material = "油轮保费这个月涨了四成。船东说是因为海峡不安全。保险公司说，危险从六月就写在价目表上了。";
  const episode = castEpisode({ material });
  const round = episode.segments.filter((item) => item.section === "第一轮" && item.origin === "user").map((item) => item.text);
  assert.equal(round[0].includes("船东"), true);
  assert.equal(round.some((line) => line.includes("价目表")), true);
  assert.deepEqual(grounded(episode, material), []);
});
