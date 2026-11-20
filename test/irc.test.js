const test = require("node:test");
const assert = require("node:assert/strict");
const irc = require("../dist/irc.js");

const broadcaster = "@badge-info=;badges=broadcaster/1;color=;display-name=Streamer;mod=0;room-id=123;tmi-sent-ts=1;user-id=9 :streamer!streamer@streamer.tmi.twitch.tv PRIVMSG #streamer :hello world";

test("parses a tagged PRIVMSG", () => {
  const event = irc.parseChatLine(broadcaster);
  assert.equal(event.type, "chat");
  assert.equal(event.nick, "streamer");
  assert.equal(event.channel, "streamer");
  assert.equal(event.text, "hello world");
  assert.equal(event.tags["room-id"], "123");
  assert.equal(event.tags.mod, "0");
});

test("parses IRCv3 tag escapes", () => {
  assert.equal(irc.unescapeTag("hello\\sworld"), "hello world");
  assert.equal(irc.unescapeTag("a\\:b"), "a;b");
  assert.equal(irc.unescapeTag("a\\\\b"), "a\\b");
  assert.equal(irc.unescapeTag("a\\rb\\nc"), "a\rb\nc");
  const event = irc.parseLine("@display-name=hello\\sworld :x!x@x PRIVMSG #c :hi");
  assert.equal(event.tags["display-name"], "hello world");
  assert.equal(event.text, "hi");
});

test("parses ready, joined, join, and ping events", () => {
  assert.equal(irc.parseChatLine(":tmi.twitch.tv 001 justinfan123 :Welcome").type, "ready");
  const joined = irc.parseChatLine(":tmi.twitch.tv 366 justinfan123 #Streamer :End of /NAMES list.");
  assert.equal(joined.type, "joined");
  assert.equal(joined.channel, "streamer");
  assert.equal(irc.parseChatLine(":streamer!streamer@streamer.tmi.twitch.tv JOIN #streamer").type, "join");
  assert.equal(irc.parseChatLine("PING :tmi.twitch.tv").type, "ping");
});

test("parses raids", () => {
  const event = irc.parseChatLine("@badges=;msg-id=raid;msg-param-viewerCount=42 :tmi.twitch.tv USERNOTICE #streamer :Incoming raid");
  assert.equal(event.type, "usernotice");
  assert.equal(event.msgId, "raid");
  assert.equal(event.raid.viewers, 42);
});

test("recognizes privileged users", () => {
  const broadcasterEvent = irc.parseChatLine(broadcaster);
  assert.equal(irc.isPrivileged(broadcasterEvent.tags, broadcasterEvent.nick, "streamer"), true);

  const mod = irc.parseChatLine("@badges=moderator/1;mod=1 :mod!mod@mod.tmi.twitch.tv PRIVMSG #streamer :!clip");
  assert.equal(irc.isPrivileged(mod.tags, mod.nick, "streamer"), true);

  const viewer = irc.parseChatLine("@badges=;mod=0 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #streamer :!clip");
  assert.equal(irc.isPrivileged(viewer.tags, viewer.nick, "streamer"), false);
});

test("recognizes clip commands", () => {
  assert.equal(irc.isClipCommand("!clip"), true);
  assert.equal(irc.isClipCommand("  !highlight now "), true);
  assert.equal(irc.isClipCommand("!clipped"), false);
  assert.equal(irc.isClipCommand("please !clip"), false);
  assert.equal(irc.isClipCommand(""), false);
});

test("parses badges and room id", () => {
  const badges = irc.badgeMap({ badges: "broadcaster/1,subscriber/12" });
  assert.equal(badges.broadcaster, "1");
  assert.equal(badges.subscriber, "12");
  assert.equal(irc.roomId({ "room-id": "123" }), "123");
  assert.equal(irc.roomId({}), "");
});

test("survives malformed lines", () => {
  for (const line of ["", "@badges=x", "PING", ":server", "  ", "not irc at all"]) {
    assert.doesNotThrow(() => irc.parseChatLine(line));
  }
});

test("channelFromParams finds the channel", () => {
  assert.equal(irc.channelFromParams(["justinfan", "#Streamer"]), "streamer");
  assert.equal(irc.channelFromParams([]), "");
});
