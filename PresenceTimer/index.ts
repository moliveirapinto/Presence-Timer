import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { color, statusIcon, registerPresenceBase } from "./status";
import {
  clampSpan, dayBounds, fmtClock, fmtDateTime, fmtShort, fmtTimeRange,
  isToday, toUtcLiteral,
} from "./time";

const VERSION = "1.1.0";
const POLL_MS = 5000;
/** 1s ticks between automatic refreshes of the "Today" timeline (5 minutes). */
const DAY_REFRESH_TICKS = 300;

/** Skip polling work when the tab is hidden (saves bandwidth + API calls). */
function isTabHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function esc(s: string): string {
  const t = document.createElement("span");
  t.textContent = s;
  return t.innerHTML;
}

export class PresenceTimer implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private _container!: HTMLDivElement;
  private _context!: ComponentFramework.Context<IInputs>;

  // Presence map: id → name
  private _pmap: Record<string, string> = {};

  // State
  private _curId: string | null = null;
  private _start: number | null = null;
  private _userId: string | null = null;
  private _selectedDate: Date = new Date();

  private _polling = false;          // reentrancy guard for _poll()
  private _errStreak = 0;            // consecutive poll failures (for backoff)
  private _skipCount = 0;            // monotonic tick counter for backoff gating
  private _bootstrapped = false;     // true once first successful presence read happened
  private _ticks = 0;                // 1s ticks since init (drives rollover + auto-refresh)
  private _trackingToday = true;     // false once the user pins a specific past day

  // Timers
  private _tickTimer: number | null = null;
  private _pollTimer: number | null = null;

  // Calendar
  private _calViewDate: Date = new Date();
  private _calOpen = false;
  private _onDocClick: ((e: MouseEvent) => void) | null = null;
  private _onVisibility: (() => void) | null = null;

  // DOM refs
  private _elDot!: HTMLDivElement;
  private _elName!: HTMLSpanElement;
  private _elClock!: HTMLDivElement;
  private _elSince!: HTMLDivElement;
  private _elErr!: HTMLDivElement;
  private _elTL!: HTMLDivElement;
  private _elSum!: HTMLDivElement;
  private _elDpLbl!: HTMLSpanElement;
  private _elPrev!: HTMLButtonElement;
  private _elNext!: HTMLButtonElement;
  private _elToday!: HTMLButtonElement;
  private _elCalBtn!: HTMLButtonElement;
  private _elCalOverlay!: HTMLDivElement;

  constructor() {
    // Empty
  }

  public init(
    context: ComponentFramework.Context<IInputs>,
    notifyOutputChanged: () => void,
    state: ComponentFramework.Dictionary,
    container: HTMLDivElement
  ): void {
    this._context = context;
    this._container = container;
    this._container.classList.add("presence-timer");
    try {
      this._buildUI();
      this._initialize();
    } catch (e: unknown) {
      this._container.textContent = `Init error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  public updateView(context: ComponentFramework.Context<IInputs>): void {
    this._context = context;
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    if (this._tickTimer !== null) clearInterval(this._tickTimer);
    if (this._pollTimer !== null) clearInterval(this._pollTimer);
    if (this._onDocClick) document.removeEventListener("click", this._onDocClick);
    if (this._onVisibility) document.removeEventListener("visibilitychange", this._onVisibility);
  }

  /* --- UI Construction --- */

  private _buildUI(): void {
    this._container.innerHTML = `
      <div class="card">
        <div class="pill">
          <div class="dot" data-ref="dot" role="img"></div>
          <span class="name" data-ref="sName">Loading\u2026</span>
        </div>
        <div class="time" data-ref="clock" role="timer">00:00:00</div>
        <div class="lbl">time in status</div>
        <div class="since" data-ref="since"></div>
        <div class="err" data-ref="err" role="status"></div>
      </div>
      <div class="dp-section">
        <div class="dp-wrap">
          <button class="dp-btn" data-ref="prevDay">\u2039</button>
          <span class="dp-label" data-ref="dpLabel">Today</span>
          <button class="dp-btn" data-ref="nextDay">\u203A</button>
          <button class="dp-cal-btn" data-ref="calBtn" title="Pick a date"><svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M7 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm1 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm2-2a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm1 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm2-2a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM17 5.5A2.5 2.5 0 0 0 14.5 3h-9A2.5 2.5 0 0 0 3 5.5v9A2.5 2.5 0 0 0 5.5 17h9a2.5 2.5 0 0 0 2.5-2.5v-9zM4 7h12v7.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 14.5V7zm1.5-3h9A1.5 1.5 0 0 1 16 5.5V6H4v-.5A1.5 1.5 0 0 1 5.5 4z"/></svg></button>
          <button class="dp-today" data-ref="todayBtn">Today</button>
        </div>
        <div class="cal-overlay" data-ref="calOverlay" style="display:none"></div>
      </div>
      <div class="summary" data-ref="summary"></div>
      <div class="hist">
        <div class="hist-title">Timeline</div>
        <div data-ref="timeline"></div>
      </div>
      <div style="font-size:9px;color:#999;text-align:right;padding:2px 6px 0 0;opacity:.6">Presence Timer v${VERSION}</div>`;

    this._elDot = this._ref("dot") as HTMLDivElement;
    this._elName = this._ref("sName") as HTMLSpanElement;
    this._elClock = this._ref("clock") as HTMLDivElement;
    this._elSince = this._ref("since") as HTMLDivElement;
    this._elErr = this._ref("err") as HTMLDivElement;
    this._elTL = this._ref("timeline") as HTMLDivElement;
    this._elSum = this._ref("summary") as HTMLDivElement;
    this._elDpLbl = this._ref("dpLabel") as HTMLSpanElement;
    this._elPrev = this._ref("prevDay") as HTMLButtonElement;
    this._elNext = this._ref("nextDay") as HTMLButtonElement;
    this._elToday = this._ref("todayBtn") as HTMLButtonElement;
    this._elCalBtn = this._ref("calBtn") as HTMLButtonElement;
    this._elCalOverlay = this._ref("calOverlay") as HTMLDivElement;

    this._elPrev.addEventListener("click", () => this._shiftDay(-1));
    this._elNext.addEventListener("click", () => this._shiftDay(1));
    this._elToday.addEventListener("click", () => {
      this._setSelectedDate(new Date());
      this._calOpen = false;
      this._elCalOverlay.style.display = "none";
      this._loadDay();
    });
    this._elCalBtn.addEventListener("click", () => this._toggleCalendar());
    this._elCalOverlay.addEventListener("click", (e) => e.stopPropagation());
    this._onDocClick = (e: MouseEvent) => {
      if (this._calOpen && !this._elCalBtn.contains(e.target as Node)) {
        this._calOpen = false;
        this._elCalOverlay.style.display = "none";
      }
    };
    document.addEventListener("click", this._onDocClick);

    // Polling is suspended while the tab is hidden, and browsers throttle background
    // timers heavily. Refresh the moment the user comes back instead of showing stale
    // data until the next interval fires.
    this._onVisibility = () => {
      if (isTabHidden()) return;
      this._errStreak = 0;
      this._skipCount = 0;
      void this._poll();
      if (this._trackingToday) {
        this._selectedDate = new Date();
        void this._loadDay();
      }
    };
    document.addEventListener("visibilitychange", this._onVisibility);
  }

  private _ref(name: string): HTMLElement {
    return this._container.querySelector(`[data-ref="${name}"]`) as HTMLElement;
  }

  /* --- Initialization --- */

  private async _initialize(): Promise<void> {
    // Always wire timers up FIRST so a transient first-call failure can self-heal.
    this._tickTimer = window.setInterval(() => this._tick(), 1000);
    this._pollTimer = window.setInterval(() => this._poll(), POLL_MS);
    try {
      this._userId = this._getUserId();
      await this._loadPresenceMap();
      const p = await this._getPresence();
      this._curId = p.id;
      this._start = p.since ? new Date(p.since).getTime() : Date.now();
      this._bootstrapped = true;
      this._render(p);
      this._renderSince(p.since);
      this._tick();
      this._loadDay();
    } catch (e: unknown) {
      this._elName.textContent = "\u2014";
      this._showErr(e instanceof Error ? e.message : String(e));
      // _poll() will keep retrying — and on first success will trigger _loadDay().
    }
  }

  /* --- Data Access --- */

  private _getWebApi(): { retrieveMultipleRecords: (entity: string, query: string, maxPageSize?: number) => Promise<ComponentFramework.WebApi.RetrieveMultipleResponse> } {
    // Prefer PCF context.webAPI
    if (this._context.webAPI) {
      return this._context.webAPI;
    }
    // Fallback: Xrm.WebApi (global in D365 workspace)
    const xrm = (window as unknown as Record<string, unknown>)["Xrm"] as
      { WebApi?: { retrieveMultipleRecords: (entity: string, query: string, maxPageSize?: number) => Promise<ComponentFramework.WebApi.RetrieveMultipleResponse> } } | undefined;
    if (xrm?.WebApi) {
      return xrm.WebApi;
    }
    throw new Error("WebAPI not available in this context");
  }

  private _getUserId(): string {
    // Try PCF context.userSettings
    const ctx = this._context as ComponentFramework.Context<IInputs> & { userSettings?: { userId?: string } };
    const uid = ctx.userSettings?.userId;
    if (uid) return uid.replace(/[{}]/g, "").toLowerCase();

    // Fallback: Xrm global
    const xrm = (window as unknown as Record<string, unknown>)["Xrm"] as
      { Utility?: { getGlobalContext?: () => { userSettings?: { userId?: string } } } } | undefined;
    const xrmUid = xrm?.Utility?.getGlobalContext?.()?.userSettings?.userId;
    if (xrmUid) return xrmUid.replace(/[{}]/g, "").toLowerCase();

    throw new Error("Cannot determine user ID");
  }

  private async _loadPresenceMap(): Promise<void> {
    const webAPI = this._getWebApi();
    let resp: ComponentFramework.WebApi.RetrieveMultipleResponse;
    let hasBase = true;
    try {
      resp = await webAPI.retrieveMultipleRecords(
        "msdyn_presence",
        "?$select=msdyn_presenceid,msdyn_name,msdyn_presencestatustext,msdyn_basepresencestatus"
      );
    } catch (e) {
      // Older/locked-down orgs may reject msdyn_basepresencestatus — degrade to text matching.
      console.warn("[PresenceTimer] base presence status unavailable, falling back to text matching", e);
      hasBase = false;
      resp = await webAPI.retrieveMultipleRecords(
        "msdyn_presence",
        "?$select=msdyn_presenceid,msdyn_presencestatustext"
      );
    }
    for (const e of resp.entities) {
      const text = (e.msdyn_presencestatustext as string) || (e.msdyn_name as string) || "";
      this._pmap[e.msdyn_presenceid as string] = text;
      if (!hasBase) continue;
      registerPresenceBase(text, e.msdyn_basepresencestatus as number | null);
      registerPresenceBase(e.msdyn_name as string, e.msdyn_basepresencestatus as number | null);
    }
  }

  private _presenceName(id: string | null): string {
    if (!id) return "Offline";
    return this._pmap[id] || "Unknown";
  }

  private async _getPresence(): Promise<{ id: string; name: string; since: string | null }> {
    const webAPI = this._getWebApi();
    const resp = await webAPI.retrieveMultipleRecords(
      "msdyn_agentstatus",
      `?$filter=_msdyn_agentid_value eq ${this._userId}&$select=_msdyn_currentpresenceid_value,msdyn_presencemodifiedon&$top=1`
    );
    // Never throw on missing record / null presence. Render "Offline" instead so the pill
    // always escapes the "Loading…" state on first paint even when the OmniChannel
    // agent-status row hasn't been initialized yet.
    if (!resp.entities || !resp.entities.length) {
      console.warn("[PresenceTimer] no msdyn_agentstatus row for user", this._userId);
      return { id: "", name: "Offline", since: null };
    }
    const rec = resp.entities[0];
    const pid = rec["_msdyn_currentpresenceid_value"] as string;
    if (!pid) {
      console.warn("[PresenceTimer] msdyn_agentstatus has null currentpresenceid for user", this._userId);
      return { id: "", name: "Offline", since: null };
    }

    // The authoritative start of the CURRENT status is the still-open history segment
    // (msdyn_endtime is null), not msdyn_presencemodifiedon — that field can lag or be stale.
    // Fall back to msdyn_presencemodifiedon when no open segment exists yet.
    let since: string | null = null;
    try {
      const hResp = await webAPI.retrieveMultipleRecords(
        "msdyn_agentstatushistory",
        `?$filter=_msdyn_agentid_value eq ${this._userId} and _msdyn_presenceid_value eq ${pid}` +
        ` and msdyn_endtime eq null` +
        `&$select=msdyn_starttime&$orderby=msdyn_starttime desc&$top=1`
      );
      if (hResp.entities && hResp.entities.length) {
        since = (hResp.entities[0]["msdyn_starttime"] as string) || null;
      }
    } catch { /* fall through to msdyn_presencemodifiedon */ }
    if (!since) since = (rec["msdyn_presencemodifiedon"] as string) || null;

    return { id: pid, name: this._presenceName(pid), since };
  }

  private async _fetchHistory(date: Date): Promise<ComponentFramework.WebApi.Entity[]> {
    const webAPI = this._getWebApi();
    const b = dayBounds(date);
    const dayStartStr = toUtcLiteral(new Date(b.start));
    const dayEndStr = toUtcLiteral(new Date(b.end));

    // Match every segment that OVERLAPS the day, not only those that START in it. A status
    // held across midnight (e.g. Offline since last week) otherwise vanished and the day
    // rendered as "No activity on this day" while the pill showed hours in that status.
    const filter =
      `_msdyn_agentid_value eq ${this._userId}` +
      ` and msdyn_starttime lt ${dayEndStr}` +
      ` and (msdyn_endtime eq null or msdyn_endtime gt ${dayStartStr})`;
    const q =
      `?$filter=${filter}` +
      `&$select=msdyn_starttime,msdyn_endtime,_msdyn_presenceid_value` +
      `&$orderby=msdyn_starttime desc`;

    const resp = await webAPI.retrieveMultipleRecords("msdyn_agentstatushistory", q, 5000);
    return resp.entities || [];
  }

  /** Clamp a history segment to the visible day so cross-midnight spans report day-local time. */
  private _span(r: ComponentFramework.WebApi.Entity): { st: number; en: number } {
    const rawSt = new Date(r["msdyn_starttime"] as string).getTime();
    const rawEn = r["msdyn_endtime"] ? new Date(r["msdyn_endtime"] as string).getTime() : null;
    return clampSpan(rawSt, rawEn, dayBounds(this._selectedDate));
  }

  /* --- Rendering --- */

  private _tick(): void {
    if (this._start) this._elClock.textContent = fmtClock(Date.now() - this._start);
    // The panel can stay mounted for days. Roll the "Today" view over at midnight and
    // refresh the day periodically so the still-open segment keeps growing.
    this._ticks++;
    if (this._ticks % 30 === 0 && this._trackingToday && !isToday(this._selectedDate)) {
      this._selectedDate = new Date();
      void this._loadDay();
    } else if (this._ticks % DAY_REFRESH_TICKS === 0 && isToday(this._selectedDate) && !isTabHidden()) {
      void this._loadDay();
    }
  }

  private _render(p: { id: string; name: string }): void {
    // Defensive null-checks — if the panel was destroyed/re-rendered, the cached refs may
    // be detached. Re-query before bailing.
    if (!this._elName || !this._elName.isConnected) {
      const fresh = this._container.querySelector('[data-ref="sName"]') as HTMLElement | null;
      if (fresh) this._elName = fresh; else return;
    }
    this._elName.textContent = p.name || "Unknown";
    if (this._elDot) {
      this._elDot.style.background = color(p.name);
      this._elDot.innerHTML = statusIcon(p.name);
      this._elDot.setAttribute("aria-label", p.name || "Unknown");
    }
    if (this._elErr) this._elErr.style.display = "none";
  }

  /** Show when the current status started, so a large "time in status" is self-explanatory. */
  private _renderSince(iso: string | null): void {
    if (!this._elSince) return;
    this._elSince.textContent = iso ? fmtDateTime(iso) : "";
  }

  private _setSelectedDate(d: Date): void {
    this._selectedDate = d;
    this._trackingToday = isToday(d);
  }

  private _showErr(msg: string): void {
    this._elErr.textContent = msg;
    this._elErr.style.display = "block";
  }

  private async _poll(): Promise<void> {
    // Skip while a previous poll is still in flight (slow WebAPI → no thundering herd).
    if (this._polling) return;
    // Skip while tab is hidden — resume immediately when it becomes visible again.
    if (isTabHidden()) return;
    // After 3+ failures, back off: only attempt every Nth poll (N = min(6, streak-2)).
    if (this._errStreak >= 3) {
      this._skipCount++;
      const everyN = Math.min(6, this._errStreak - 2);
      if ((this._skipCount % everyN) !== 0) return;
    }
    this._polling = true;
    try {
      const p = await this._getPresence();
      const wasBootstrapping = !this._bootstrapped;
      const since = p.since ? new Date(p.since).getTime() : null;
      // Resync on presence change AND on a new segment start for the same presence
      // (A -> B -> A between two polls looks unchanged by id alone, which froze the timer).
      if (p.id !== this._curId || (since !== null && since !== this._start) || wasBootstrapping) {
        this._curId = p.id;
        this._start = since ?? Date.now();
        this._renderSince(p.since);
        if (this._trackingToday) {
          this._selectedDate = new Date();
          void this._loadDay();
        }
      }
      this._bootstrapped = true;
      this._errStreak = 0;
      this._skipCount = 0;
      this._render(p);
      if (this._elErr.style.display !== "none") this._elErr.style.display = "none";
    } catch (e: unknown) {
      this._errStreak++;
      this._showErr(e instanceof Error ? e.message : String(e));
    } finally {
      this._polling = false;
    }
  }

  /* --- Timeline --- */

  private _renderTimeline(records: ComponentFramework.WebApi.Entity[]): void {
    if (!records.length) {
      this._elTL.innerHTML = '<div class="tl-empty">No activity on this day</div>';
      this._elSum.innerHTML = "";
      return;
    }

    const totals: Record<string, number> = {};
    let maxDur = 0;
    for (const r of records) {
      const name = this._presenceName(r["_msdyn_presenceid_value"] as string);
      const { st, en } = this._span(r);
      const dur = en - st;
      totals[name] = (totals[name] || 0) + dur;
      if (dur > maxDur) maxDur = dur;
    }

    const sortedNames = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
    let sumHtml = "";
    for (const n of sortedNames) {
      sumHtml += `<div class="sum-chip"><div class="sum-dot" style="background:${color(n)}">${statusIcon(n)}</div><span>${esc(n)}</span> <span class="sum-val">${fmtShort(totals[n])}</span></div>`;
    }
    this._elSum.innerHTML = sumHtml;

    let filteredMaxDur = 0;
    for (const r of records) {
      const { st, en } = this._span(r);
      const dur = en - st;
      if (dur > filteredMaxDur) filteredMaxDur = dur;
    }

    let html = '<div class="tl">';
    for (const r of records) {
      const name = this._presenceName(r["_msdyn_presenceid_value"] as string);
      const c = color(name);
      const { st, en } = this._span(r);
      const dur = en - st;
      const barPct = filteredMaxDur > 0 ? Math.max(4, Math.round((dur / filteredMaxDur) * 100)) : 100;
      const openEnded = !r["msdyn_endtime"] && isToday(this._selectedDate);

      html += `<div class="tl-item"><div class="tl-dot" style="background:${c}">${statusIcon(name)}</div><div class="tl-body"><div class="tl-row"><span class="tl-name">${esc(name)}</span><span class="tl-dur">${fmtShort(dur)}</span></div><div class="tl-time">${fmtTimeRange(new Date(st).toISOString(), openEnded ? null : new Date(en).toISOString())}</div><div class="tl-bar" style="width:${barPct}%;background:${c}"></div></div></div>`;
    }
    html += "</div>";
    this._elTL.innerHTML = html;
  }

  /* --- Date Picker --- */

  private _updateDateLabel(): void {
    if (isToday(this._selectedDate)) {
      this._elDpLbl.textContent = "Today";
      this._elToday.style.display = "none";
      this._elNext.style.visibility = "hidden";
    } else {
      this._elDpLbl.textContent = this._selectedDate.toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      this._elToday.style.display = "";
      this._elNext.style.visibility = "";
    }
  }

  private async _loadDay(): Promise<void> {
    this._updateDateLabel();
    this._elTL.innerHTML = '<div class="hist-loading">Loading\u2026</div>';
    this._elSum.innerHTML = "";
    try {
      const records = await this._fetchHistory(this._selectedDate);
      this._renderTimeline(records);
    } catch (e: unknown) {
      this._elTL.innerHTML = `<div class="tl-empty">Failed to load: ${esc(e instanceof Error ? e.message : String(e))}</div>`;
    }
  }

  private _shiftDay(offset: number): void {
    const d = new Date(this._selectedDate);
    d.setDate(d.getDate() + offset);
    if (d > new Date()) return;
    this._setSelectedDate(d);
    this._loadDay();
  }

  /* --- Calendar Overlay --- */

  private _toggleCalendar(): void {
    this._calOpen = !this._calOpen;
    if (this._calOpen) {
      this._calViewDate = new Date(this._selectedDate.getFullYear(), this._selectedDate.getMonth(), 1);
      this._renderCalendar();
      this._elCalOverlay.style.display = "";
    } else {
      this._elCalOverlay.style.display = "none";
    }
  }

  private _renderCalendar(): void {
    const year = this._calViewDate.getFullYear();
    const month = this._calViewDate.getMonth();
    const today = new Date();
    const sel = this._selectedDate;
    const monthName = new Date(year, month, 1).toLocaleDateString([], { month: "long", year: "numeric" });
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const canGoNext = new Date(year, month + 1, 1) <= today;

    let html = `<div class="cal-head">`;
    html += `<button class="cal-nav" data-action="calPrev">\u2039</button>`;
    html += `<span class="cal-title">${esc(monthName)}</span>`;
    html += `<button class="cal-nav${canGoNext ? "" : " cal-nav-dis"}" data-action="calNext">\u203A</button>`;
    html += `</div><div class="cal-dow-row">`;
    for (const d of ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]) {
      html += `<span class="cal-dow">${d}</span>`;
    }
    html += `</div><div class="cal-grid">`;
    for (let i = 0; i < firstDow; i++) html += `<span class="cal-cell"></span>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const cellDate = new Date(year, month, d);
      const isFuture = cellDate > today;
      const isTdy = cellDate.toDateString() === today.toDateString();
      const isSel = cellDate.toDateString() === sel.toDateString();
      let cls = "cal-day";
      if (isFuture) cls += " cal-dis";
      if (isTdy) cls += " cal-today";
      if (isSel) cls += " cal-sel";
      html += `<button class="${cls}"${isFuture ? " disabled" : ""} data-day="${d}">${d}</button>`;
    }
    html += `</div>`;
    this._elCalOverlay.innerHTML = html;

    this._elCalOverlay.querySelector('[data-action="calPrev"]')
      ?.addEventListener("click", () => this._shiftCalMonth(-1));
    if (canGoNext) {
      this._elCalOverlay.querySelector('[data-action="calNext"]')
        ?.addEventListener("click", () => this._shiftCalMonth(1));
    }
    this._elCalOverlay.querySelectorAll(".cal-day:not(.cal-dis)").forEach((btn) => {
      btn.addEventListener("click", () => {
        const day = parseInt((btn as HTMLElement).dataset.day || "1", 10);
        this._setSelectedDate(new Date(year, month, day));
        this._calOpen = false;
        this._elCalOverlay.style.display = "none";
        this._loadDay();
      });
    });
  }

  private _shiftCalMonth(offset: number): void {
    this._calViewDate = new Date(this._calViewDate.getFullYear(), this._calViewDate.getMonth() + offset, 1);
    this._renderCalendar();
  }
}
