const test = require("node:test");
const assert = require("node:assert/strict");
const reactions = require("../dist/reactions.js");

function historyOf(value, length = 12) {
  return Array.from({ length }, () => value);
}

test("does not trigger during warmup", () => {
  const result = reactions.evaluateReaction({ history: historyOf(1, 11), participants: 50, reactions: 20 });
  assert.equal(result.trigger, false);
  assert.match(result.reasons[0], /warming up/);
});

test("quiet chat and a small bump do not trigger", () => {
  assert.equal(reactions.evaluateReaction({ history: historyOf(10), participants: 12, reactions: 6 }).trigger, false);
  assert.equal(reactions.evaluateReaction({ history: historyOf(10), participants: 10, reactions: 8 }).trigger, false);
});

test("a real spike triggers", () => {
  const result = reactions.evaluateReaction({ history: historyOf(10), participants: 20, reactions: 8 });
  assert.equal(result.trigger, true);
  assert.ok(result.threshold > 10);
  assert.ok(result.threshold < 20);
});

test("low-chat channels can trigger", () => {
  const result = reactions.evaluateReaction({ history: historyOf(2), participants: 5, reactions: 2 });
  assert.equal(result.trigger, true);
  assert.ok(result.threshold <= 5);
});

test("a previous raid does not mask the next highlight", () => {
  const history = [...historyOf(10, 59), 200];
  const result = reactions.evaluateReaction({ history, participants: 20, reactions: 8 });
  assert.equal(result.trigger, true);
  assert.ok(result.threshold < 30);
});

test("reaction share is enforced", () => {
  const result = reactions.evaluateReaction({ history: historyOf(10), participants: 30, reactions: 3 });
  assert.equal(result.trigger, false);
  assert.match(result.reasons.join(" "), /reactions/);
});

test("strongReaction remains a boolean wrapper", () => {
  assert.equal(reactions.strongReaction(historyOf(10), 20, 8, 12), true);
  assert.equal(reactions.strongReaction(historyOf(10), 12, 6, 12), false);
});

test("isReaction recognizes words and emote names", () => {
  const emotes = new Set(["KEKW", "PogChamp"]);
  assert.equal(reactions.isReaction("KEKW", emotes), true);
  assert.equal(reactions.isReaction("PogChamp PogChamp", emotes), true);
  assert.equal(reactions.isReaction("lol that was insane", emotes), true);
  assert.equal(reactions.isReaction("hello there", emotes), false);
  assert.equal(reactions.isReaction("hello", null), false);
});

test("collectEmotes counts occurrences and topEmotes sorts them", () => {
  const emotes = new Map([["KEKW", "1"], ["PogChamp", "2"]]);
  const counts = reactions.collectEmotes("KEKW KEKW PogChamp hello", emotes);
  assert.equal(counts.get("KEKW"), 2);
  assert.equal(counts.get("PogChamp"), 1);
  assert.equal(counts.has("hello"), false);
  assert.deepEqual(reactions.topEmotes(counts), [
    { name: "KEKW", count: 2 },
    { name: "PogChamp", count: 1 }
  ]);
});
