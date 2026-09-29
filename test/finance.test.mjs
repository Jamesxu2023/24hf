import test from "node:test";
import assert from "node:assert/strict";
import { castBrief, grounded } from "../public/24hf/cast.js";
import { castEpisode } from "../public/cast.js";

const NOTE = "油价从119掉到87。价差却重新拉开。市场买的是说法，不是通道重开。";

test("24H Finance is a solo brief", () => {
  const episode = castBrief({ material: NOTE });
  const spoken = episode.segments.map((item) => `${item.speaker}:${item.section}:${item.text}`).join("\n");
  assert.equal(episode.program, "24H Finance");
  assert.equal(episode.mode, "brief");
  assert.match(spoken, /詹姆斯:开场:油价从119掉到87/);
  assert.match(spoken, /这是 24H Finance/);
  assert.match(spoken, /詹姆斯:事实:价差却重新拉开/);
  assert.match(spoken, /詹姆斯:判断:市场买的是说法/);
  assert.match(spoken, /市场不会停止波动/);
  assert.doesNotMatch(spoken, /老麦|林晚|各站一岸|先别鼓掌/);
  assert.deepEqual(grounded(episode, NOTE), []);
});

test("a labeled finance script stays with James", () => {
  const material = ["詹姆斯：今天就看价。", "詹姆斯：价差重新拉开。", "詹姆斯：通道还没重开。"].join("\n");
  const episode = castBrief({ material });
  assert.equal(episode.mode, "script");
  assert.deepEqual(episode.segments.map((item) => item.speaker), ["詹姆斯", "詹姆斯", "詹姆斯"]);
  assert.deepEqual(grounded(episode, material), []);
});

test("the two-shore desk does not emit the finance sign-off", () => {
  const episode = castEpisode({ material: NOTE, program: "东西两说" });
  const spoken = episode.segments.map((item) => item.text).join("");
  assert.doesNotMatch(spoken, /这是 24H Finance|市场不会停止波动/);
  assert.match(spoken, /各站一岸/);
});
