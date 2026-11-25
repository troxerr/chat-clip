const test = require("node:test");
const assert = require("node:assert/strict");
const { channelProblem, startBlocker, licenseBanner, bannerButtons, captureIntro } = require("../renderer/start-guide.js");

const ok = { valid: true, mode: "licensed", required: true };

test("channel names and Twitch links pass, anything else says why", () => {
  for (const good of ["abc", "Some_Streamer", "twitch.tv/abc", "https://www.twitch.tv/Some_Streamer/", ""]) assert.equal(channelProblem(good), "", good);
  assert.match(channelProblem("ab"), /3 to 25/);
  assert.match(channelProblem("bad name!"), /3 to 25/);
  assert.match(channelProblem("https://kick.com/abc"), /Twitch channels only/);
  assert.match(channelProblem("https://twitch.tv/videos/123"), /live channel link/);
});

test("Start says what is missing, in the order a person would fix it", () => {
  assert.match(startBlocker({ license: { valid: false, message: "The trial has ended." }, channel: "abc" }), /trial has ended/);
  assert.match(startBlocker({ license: ok, channel: "" }), /Enter a Twitch channel/);
  assert.match(startBlocker({ license: ok, channel: "a" }), /3 to 25/);
  assert.match(startBlocker({ license: ok, channel: "abc", ackNeeded: true, ack: false }), /permission/);
  assert.equal(startBlocker({ license: ok, channel: "abc", ackNeeded: true, ack: true }), "");
});

test("the banner shows trial days, an expired trial, or nothing", () => {
  assert.deepEqual(licenseBanner({ required: true, mode: "trial", daysLeft: 1 }), { kind: "info", text: "Trial: 1 day left.", actions: ["buy"] });
  assert.deepEqual(licenseBanner({ required: true, mode: "expired", message: "Ended." }).actions, ["buy", "key"]);
  assert.equal(licenseBanner({ required: true, mode: "licensed" }), null);
  assert.equal(licenseBanner({ required: false, mode: "development" }), null);
});

test("checkout is the banner's buy button, and an ended trial also offers the key field", () => {
  const offer = { checkoutUrl: "https://buy.polar.sh/x", priceLabel: "$39" };
  assert.deepEqual(bannerButtons({ required: true, mode: "trial", daysLeft: 2, ...offer }), [
    { action: "buy", label: "Buy for $39" }
  ]);
  assert.deepEqual(bannerButtons({ required: true, mode: "expired", message: "Ended.", ...offer }), [
    { action: "buy", label: "Buy for $39" },
    { action: "settings", label: "Enter license key" }
  ]);
  assert.deepEqual(bannerButtons({ required: true, mode: "expired", message: "Ended.", priceLabel: "$39" }), [
    { action: "settings", label: "Enter license key" }
  ]);
  assert.deepEqual(bannerButtons({ required: true, mode: "trial", daysLeft: 2, checkoutUrl: "https://buy.polar.sh/x" }), [
    { action: "buy", label: "Buy a license" }
  ]);
});

test("the capture intro is there before recording and gone once it starts", () => {
  assert.match(captureIntro("idle"), /Save highlight now/);
  assert.match(captureIntro("error"), /vertical clip/);
  assert.equal(captureIntro("watching"), "");
  assert.equal(captureIntro("buffering"), "");
});
