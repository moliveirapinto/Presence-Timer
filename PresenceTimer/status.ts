/**
 * Presence status classification.
 *
 * Kept free of DOM and Dataverse dependencies so it can be unit-tested directly.
 * Mirrors the module of the same name in the Presence Hub / Queue Hub controls.
 */

/** msdyn_presence.msdyn_basepresencestatus option-set values. */
export const BASE_AVAILABLE = 192360000;
export const BASE_BUSY = 192360001;
export const BASE_DND = 192360002;
export const BASE_AWAY = 192360003;
export const BASE_OFFLINE = 192360004;

export type StatusKind = "available" | "busy" | "acw" | "dnd" | "away" | "offline" | "unknown";

const KIND_COLOR: Record<StatusKind, string> = {
  available: "#92c353",
  busy: "#c4314b",
  acw: "#e3008c",
  dnd: "#c4314b",
  away: "#fcd116",
  offline: "#8c8c8c",
  unknown: "#8c8c8c",
};

const BASE_KIND: Record<number, StatusKind> = {
  [BASE_AVAILABLE]: "available",
  [BASE_BUSY]: "busy",
  [BASE_DND]: "dnd",
  [BASE_AWAY]: "away",
  [BASE_OFFLINE]: "offline",
};

/** Relative sort weight: Available first, Offline last. */
const KIND_ORDER: Record<StatusKind, number> = {
  available: 0, busy: 1, acw: 1, dnd: 2, away: 3, unknown: 4, offline: 5,
};

/**
 * Lowercased presence text/name -> msdyn_basepresencestatus.
 * Custom presences ("Break", "Lunch", "Training"...) and localized OOB presences carry no
 * recognizable English keyword, so the admin-configured base status is the only reliable
 * way to classify them. Without this they all fell back to grey.
 */
const baseByText: Record<string, number> = {};

export function registerPresenceBase(label: string, base: number | null | undefined): void {
  if (base === null || base === undefined) return;
  const k = (label || "").trim().toLowerCase();
  if (k) baseByText[k] = base;
}

/** Test seam. */
export function resetPresenceBases(): void {
  for (const k of Object.keys(baseByText)) delete baseByText[k];
}

function kindFromText(l: string): StatusKind | null {
  if (!l) return null;
  if (l.indexOf("do not disturb") > -1 || l.indexOf("dnd") > -1) return "dnd";
  if (l.indexOf("available") > -1) return "available";
  if (l.indexOf("away") > -1) return "away";
  if (l.indexOf("offline") > -1 || l.indexOf("inactive") > -1 || l.indexOf("signed out") > -1) return "offline";
  if (l.indexOf("busy") > -1 || l.indexOf("on a call") > -1 || l.indexOf("reserved") > -1) return "busy";
  return null;
}

/**
 * Resolve a presence display text to a rendering kind. After-conversation-work is matched
 * first because it is a refinement of Busy that the base status cannot express; the
 * admin-configured base status wins next; English keyword matching is the last resort for
 * orgs where msdyn_basepresencestatus could not be read.
 */
export function statusKind(name: string): StatusKind {
  const l = (name || "").trim().toLowerCase();
  if (!l) return "unknown";
  if (l.indexOf("after conversation work") > -1 || l.indexOf("acw") > -1) return "acw";
  const base = baseByText[l];
  if (base !== undefined && BASE_KIND[base]) return BASE_KIND[base];
  return kindFromText(l) ?? "unknown";
}

export function color(name: string): string {
  return KIND_COLOR[statusKind(name)];
}

export function statusOrder(name: string): number {
  return KIND_ORDER[statusKind(name)];
}

/** Inner-HTML glyph for the status dot, so status is not conveyed by colour alone. */
export function statusIcon(name: string): string {
  switch (statusKind(name)) {
    case "dnd":
      return '<span class="dot-minus"></span>';
    case "available":
      return '<svg class="dot-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><polyline points="2.5,6.5 5,9 9.5,3.5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    case "away":
      return '<svg class="dot-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><circle cx="6" cy="6" r="3.5" fill="none" stroke="#fff" stroke-width="1.3"/><line x1="6" y1="4" x2="6" y2="6" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/><line x1="6" y1="6" x2="7.8" y2="6" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/></svg>';
    case "offline":
      return '<svg class="dot-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><line x1="3" y1="9" x2="9" y2="3" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></svg>';
    default:
      return "";
  }
}
