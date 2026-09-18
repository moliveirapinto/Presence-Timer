import {
  BASE_AVAILABLE, BASE_AWAY, BASE_BUSY, BASE_DND, BASE_OFFLINE,
  color, registerPresenceBase, resetPresenceBases, statusIcon, statusKind, statusOrder,
} from "../PresenceTimer/status";

const GREEN = "#92c353";
const RED = "#c4314b";
const PINK = "#e3008c";
const YELLOW = "#fcd116";
const GREY = "#8c8c8c";

beforeEach(() => resetPresenceBases());

describe("out-of-the-box statuses", () => {
  it.each([
    ["Available", GREEN],
    ["Busy", RED],
    ["Busy - DND", RED],
    ["Do Not Disturb", RED],
    ["Away", YELLOW],
    ["Offline", GREY],
    ["Inactive", GREY],
  ])("%s -> %s by keyword alone", (name, expected) => {
    expect(color(name)).toBe(expected);
  });

  // Regression: key iteration order meant "busy" matched before the longer ACW key.
  it("keeps after-conversation-work distinct from plain Busy", () => {
    expect(color("Busy - After Conversation Work")).toBe(PINK);
    expect(color("Do Not Disturb - After Conversation Work")).toBe(PINK);
  });
});

describe("custom statuses", () => {
  // Regression: the reported bug — everything grey except Available.
  it("is grey only when no base status is registered", () => {
    expect(color("Break")).toBe(GREY);
    expect(statusKind("Break")).toBe("unknown");
  });

  it.each([
    ["Break", BASE_AWAY, YELLOW],
    ["Lunch", BASE_AWAY, YELLOW],
    ["Training", BASE_BUSY, RED],
    ["Coaching", BASE_DND, RED],
    ["Signed out for the day", BASE_OFFLINE, GREY],
    ["Ready for work", BASE_AVAILABLE, GREEN],
  ])("%s resolves from its base status", (name, base, expected) => {
    registerPresenceBase(name, base);
    expect(color(name)).toBe(expected);
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    registerPresenceBase("Break", BASE_AWAY);
    expect(color("  bReAk ")).toBe(YELLOW);
  });

  it("prefers the base status over a misleading keyword in the name", () => {
    registerPresenceBase("Training (not available)", BASE_BUSY);
    expect(color("Training (not available)")).toBe(RED);
  });

  it("ignores a null base status", () => {
    registerPresenceBase("Break", null);
    expect(color("Break")).toBe(GREY);
  });
});

describe("edge cases", () => {
  it.each(["", "   ", null, undefined])("treats %p as unknown", (name) => {
    expect(statusKind(name as unknown as string)).toBe("unknown");
    expect(color(name as unknown as string)).toBe(GREY);
  });
});

describe("statusIcon", () => {
  it("emits no glyph for Busy, ACW and unknown", () => {
    expect(statusIcon("Busy")).toBe("");
    expect(statusIcon("Busy - After Conversation Work")).toBe("");
    expect(statusIcon("Mystery")).toBe("");
  });

  it("emits a glyph for the other kinds", () => {
    for (const name of ["Available", "Away", "Offline", "Do Not Disturb"]) {
      expect(statusIcon(name)).not.toBe("");
    }
  });

  it("follows the base status for custom presences", () => {
    registerPresenceBase("Break", BASE_AWAY);
    expect(statusIcon("Break")).toBe(statusIcon("Away"));
  });

  it("marks glyphs as decorative for screen readers", () => {
    expect(statusIcon("Available")).toContain('aria-hidden="true"');
  });
});

describe("statusOrder", () => {
  it("sorts Available first and Offline last", () => {
    const names = ["Offline", "Away", "Available", "Busy", "Do Not Disturb"];
    expect([...names].sort((a, b) => statusOrder(a) - statusOrder(b))).toEqual([
      "Available", "Busy", "Do Not Disturb", "Away", "Offline",
    ]);
  });
});
