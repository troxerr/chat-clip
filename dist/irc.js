(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HDIrc = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TAG_ESCAPES = { ":": ";", s: " ", "\\": "\\", r: "\r", n: "\n" };

  function unescapeTag(value) {
    return String(value).replace(/\\(.)/g, (_, char) =>
      Object.prototype.hasOwnProperty.call(TAG_ESCAPES, char) ? TAG_ESCAPES[char] : char
    );
  }

  function parseTags(raw) {
    const tags = Object.create(null);
    if (!raw) return tags;
    for (const pair of raw.split(";")) {
      if (!pair) continue;
      const equals = pair.indexOf("=");
      if (equals < 0) tags[pair] = "";
      else tags[pair.slice(0, equals)] = unescapeTag(pair.slice(equals + 1));
    }
    return tags;
  }

  function parseLine(raw) {
    const result = {
      raw: String(raw || "").replace(/\r$/, ""),
      tags: Object.create(null),
      prefix: "",
      command: "",
      params: [],
      text: ""
    };
    let line = result.raw;
    if (line.startsWith("@")) {
      const space = line.indexOf(" ");
      if (space < 0) return result;
      result.tags = parseTags(line.slice(1, space));
      line = line.slice(space + 1).trimStart();
    }
    if (line.startsWith(":")) {
      const space = line.indexOf(" ");
      if (space < 0) {
        result.prefix = line.slice(1);
        return result;
      }
      result.prefix = line.slice(1, space);
      line = line.slice(space + 1).trimStart();
    }
    const trailing = line.indexOf(" :");
    let head = line;
    if (trailing >= 0) {
      result.text = line.slice(trailing + 2);
      head = line.slice(0, trailing);
    }
    const parts = head.split(/\s+/).filter(Boolean);
    result.command = (parts.shift() || "").toUpperCase();
    result.params = parts;
    return result;
  }

  function nickFromPrefix(prefix) {
    const nick = String(prefix || "").split("!")[0];
    return nick.split("@")[0];
  }

  function channelFromParams(params) {
    const found = (params || []).find((param) => param.startsWith("#"));
    return found ? found.slice(1).toLowerCase() : "";
  }

  function badgeMap(tags) {
    const badges = Object.create(null);
    const raw = tags && tags.badges;
    if (!raw) return badges;
    for (const entry of raw.split(",")) {
      const slash = entry.indexOf("/");
      const name = slash < 0 ? entry : entry.slice(0, slash);
      const version = slash < 0 ? "1" : entry.slice(slash + 1);
      if (name) badges[name] = version;
    }
    return badges;
  }

  function isPrivileged(tags, nick, channel) {
    if (!tags) return false;
    if (tags.mod === "1") return true;
    const badges = badgeMap(tags);
    if (badges.broadcaster || badges.moderator) return true;
    return String(nick || "").toLowerCase() === String(channel || "").toLowerCase();
  }

  function isClipCommand(text) {
    return /^!(?:clip|highlight)(?:\s|$)/i.test(String(text || "").trim());
  }

  function roomId(tags) {
    return tags && tags["room-id"] ? String(tags["room-id"]) : "";
  }

  function parseChatLine(raw) {
    const parsed = parseLine(raw);
    const event = {
      raw: parsed.raw,
      tags: parsed.tags,
      prefix: parsed.prefix,
      command: parsed.command,
      params: parsed.params,
      text: parsed.text,
      nick: nickFromPrefix(parsed.prefix),
      channel: channelFromParams(parsed.params),
      type: "other"
    };

    if (parsed.command === "PING") {
      event.type = "ping";
    } else if (parsed.command === "001") {
      event.type = "ready";
    } else if (parsed.command === "366") {
      event.type = "joined";
    } else if (parsed.command === "JOIN") {
      event.type = "join";
    } else if (parsed.command === "PART") {
      event.type = "part";
    } else if (parsed.command === "PRIVMSG") {
      event.type = "chat";
      event.message = parsed.text;
    } else if (parsed.command === "USERNOTICE") {
      event.type = "usernotice";
      event.msgId = event.tags["msg-id"] || "";
      if (event.msgId === "raid") {
        const viewers = Number(event.tags["msg-param-viewerCount"]);
        event.raid = { viewers: Number.isFinite(viewers) ? viewers : 0 };
      }
    } else if (parsed.command === "NOTICE") {
      event.type = "notice";
    } else if (parsed.command === "CLEARCHAT" || parsed.command === "CLEARMSG") {
      event.type = "clear";
    }

    return event;
  }

  return {
    parseLine,
    parseChatLine,
    parseTags,
    unescapeTag,
    nickFromPrefix,
    channelFromParams,
    badgeMap,
    isPrivileged,
    isClipCommand,
    roomId
  };
});
