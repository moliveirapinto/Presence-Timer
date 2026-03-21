import { IInputs, IOutputs } from "./generated/ManifestTypes";

const POLL_MS = 5000;

const COLORS: Record<string, string> = {
  available: "#92c353",
  busy: "#c4314b",
  "busy - dnd": "#c4314b",
  "do not disturb": "#c4314b",
  away: "#fcd116",
  "appear away": "#fcd116",
  offline: "#8c8c8c",
  inactive: "#8c8c8c",
  "busy - after conversation work": "#e3008c",
  "after conversation work": "#e3008c",
  "dnd-initiating outbound call": "#c4314b",
  "voice consult dnd": "#c4314b",
  "do not disturb - after conversation work": "#e3008c",
};

function color(name: string): string {
  const l = (name || "").toLowerCase();
  for (const k of Object.keys(COLORS)) {
    if (l.indexOf(k) > -1) return COLORS[k];
  }
  return "#8c8c8c";
}

function fmt(ms: number): string {
  let s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  s = s % 60;
  return `${h < 10 ? "0" : ""}${h}:${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
}

function fmtShort(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s % 60}s`;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function fmtTimeRange(startIso: string, endIso: string | null): string {
  return fmtTime(startIso) + (endIso ? ` \u2013 ${fmtTime(endIso)}` : " \u2013 now");
}

function isToday(d: Date): boolean {
  const t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

  // Timers
  private _tickTimer: number | null = null;
  private _pollTimer: number | null = null;

  // Calendar
  private _calViewDate: Date = new Date();
  private _calOpen = false;
  private _onDocClick: ((e: MouseEvent) => void) | null = null;

  // DOM refs
  private _elDot!: HTMLDivElement;
  private _elName!: HTMLDivElement;
  private _elClock!: HTMLDivElement;
  private _elErr!: HTMLDivElement;
  private _elAccent!: HTMLDivElement;
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
  }

  /* --- UI Construction --- */

  private _buildUI(): void {
    this._container.innerHTML = `
      <div class="card">
        <div class="orb" data-ref="dot"></div>
        <div class="sname" data-ref="sName">Loading\u2026</div>
        <div class="time" data-ref="clock">00:00:00</div>
        <div class="lbl">elapsed</div>
        <div class="accent" data-ref="accentBar"></div>
        <div class="err" data-ref="err"></div>
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
      </div>`;

    this._elDot = this._ref("dot") as HTMLDivElement;
    this._elName = this._ref("sName") as HTMLDivElement;
    this._elClock = this._ref("clock") as HTMLDivElement;
    this._elErr = this._ref("err") as HTMLDivElement;
    this._elAccent = this._ref("accentBar") as HTMLDivElement;
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
      this._selectedDate = new Date();
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
  }

  private _ref(name: string): HTMLElement {
    return this._container.querySelector(`[data-ref="${name}"]`) as HTMLElement;
  }

  /* --- Initialization --- */

  private async _initialize(): Promise<void> {
    try {
      this._userId = this._getUserId();
      await this._loadPresenceMap();
      const p = await this._getPresence();
      this._curId = p.id;
      this._start = p.since ? new Date(p.since).getTime() : Date.now();
      this._render(p);
      this._tick();

      this._tickTimer = window.setInterval(() => this._tick(), 1000);
      this._pollTimer = window.setInterval(() => this._poll(), POLL_MS);

      this._loadDay();
    } catch (e: unknown) {
      this._elName.textContent = "\u2014";
      this._showErr(e instanceof Error ? e.message : String(e));
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
    const resp = await webAPI.retrieveMultipleRecords(
      "msdyn_presence",
      "?$select=msdyn_presenceid,msdyn_presencestatustext"
    );
    for (const e of resp.entities) {
      this._pmap[e.msdyn_presenceid as string] = e.msdyn_presencestatustext as string;
    }
  }

  private _presenceName(id: string): string {
    return this._pmap[id] || "Unknown";
  }

  private async _getPresence(): Promise<{ id: string; name: string; since: string | null }> {
    const webAPI = this._getWebApi();
    const resp = await webAPI.retrieveMultipleRecords(
      "msdyn_agentstatus",
      `?$filter=_msdyn_agentid_value eq ${this._userId}&$select=_msdyn_currentpresenceid_value,msdyn_presencemodifiedon&$top=1`
    );
    if (!resp.entities || !resp.entities.length) throw new Error("No agent status record found");
    const rec = resp.entities[0];
    const pid = rec["_msdyn_currentpresenceid_value"] as string;
    if (!pid) throw new Error("No current presence assigned");
    return {
      id: pid,
      name: this._presenceName(pid),
      since: (rec["msdyn_presencemodifiedon"] as string) || null,
    };
  }

  private async _fetchHistory(date: Date): Promise<ComponentFramework.WebApi.Entity[]> {
    const webAPI = this._getWebApi();
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(dayStart.getTime() + 86400000);

    const filter =
      `_msdyn_agentid_value eq ${this._userId}` +
      ` and msdyn_starttime ge ${dayStart.toISOString()}` +
      ` and msdyn_starttime lt ${dayEnd.toISOString()}`;
    const q =
      `?$filter=${filter}` +
      `&$select=msdyn_starttime,msdyn_endtime,_msdyn_presenceid_value` +
      `&$orderby=msdyn_starttime desc`;

    const all: ComponentFramework.WebApi.Entity[] = [];
    const resp = await webAPI.retrieveMultipleRecords("msdyn_agentstatushistory", q, 5000);
    if (resp.entities) all.push(...resp.entities);
    return all;
  }

  /* --- Rendering --- */

  private _tick(): void {
    if (this._start) {
      this._elClock.textContent = fmt(Date.now() - this._start);
    }
  }

  private _render(p: { id: string; name: string }): void {
    const c = color(p.name);
    this._elName.textContent = p.name;
    this._elDot.style.background = c;
    this._elDot.style.boxShadow = `0 0 10px 3px ${c}40`;
    this._elAccent.style.background = c;
    this._elErr.style.display = "none";
  }

  private _showErr(msg: string): void {
    this._elErr.textContent = msg;
    this._elErr.style.display = "block";
  }

  private async _poll(): Promise<void> {
    try {
      const p = await this._getPresence();
      if (p.id !== this._curId) {
        this._curId = p.id;
        this._start = p.since ? new Date(p.since).getTime() : Date.now();
        if (isToday(this._selectedDate)) this._loadDay();
      }
      this._render(p);
    } catch (e: unknown) {
      this._showErr(e instanceof Error ? e.message : String(e));
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
      const st = new Date(r["msdyn_starttime"] as string).getTime();
      const en = r["msdyn_endtime"] ? new Date(r["msdyn_endtime"] as string).getTime() : Date.now();
      const dur = en - st;
      totals[name] = (totals[name] || 0) + dur;
      if (dur > maxDur) maxDur = dur;
    }

    const sortedNames = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
    let sumHtml = "";
    for (const n of sortedNames) {
      sumHtml += `<div class="sum-chip"><div class="sum-dot" style="background:${color(n)}"></div><span>${esc(n)}</span> <span class="sum-val">${fmtShort(totals[n])}</span></div>`;
    }
    this._elSum.innerHTML = sumHtml;

    let html = '<div class="tl">';
    for (const r of records) {
      const name = this._presenceName(r["_msdyn_presenceid_value"] as string);
      const c = color(name);
      const st = new Date(r["msdyn_starttime"] as string).getTime();
      const en = r["msdyn_endtime"] ? new Date(r["msdyn_endtime"] as string).getTime() : Date.now();
      const dur = en - st;
      const barPct = maxDur > 0 ? Math.max(4, Math.round((dur / maxDur) * 100)) : 100;

      html += `<div class="tl-item"><div class="tl-dot" style="background:${c}"></div><div class="tl-body"><div class="tl-row"><span class="tl-name">${esc(name)}</span><span class="tl-dur">${fmtShort(dur)}</span></div><div class="tl-time">${fmtTimeRange(r["msdyn_starttime"] as string, (r["msdyn_endtime"] as string) || null)}</div><div class="tl-bar" style="width:${barPct}%;background:${c}"></div></div></div>`;
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
    this._selectedDate = d;
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
        this._selectedDate = new Date(year, month, day);
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
