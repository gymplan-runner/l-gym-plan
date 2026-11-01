// History tab: everything logged, newest first, told kindly. No streaks, no "missed" days.
// Tapping a session opens it to view or correct.
import * as db from "./db.js";
import { getPlan, parseDate, ICONS } from "./plan.js";
import { esc, fmt } from "./ui.js";
import { sessionCrashed } from "./checks.js";

function recovery(s) {
  if (sessionCrashed(s)) return `<span class="pill amber">Dip after</span>`;
  const done = (c) => c && !c.skipped;
  if (done(s.checks?.h24) && done(s.checks?.h48)) return `<span class="pill green">Recovered well</span>`;
  return "";
}

function detail(s) {
  const lighter = s.level === "amber" ? "Lighter version · " : "";
  if (s.kind === "gym") {
    const n = s.items.filter((i) => i.status === "done").length;
    return `${lighter}${n} exercise${n === 1 ? "" : "s"}${s.durationMin ? ` · ${s.durationMin} min` : ""}`;
  }
  return `${lighter}${s.minutes != null ? `${s.minutes} min` : "time not noted"}`;
}

export async function renderHistory($screen) {
  const plan = getPlan();
  const sessions = (await db.all("sessions")).filter((s) => s.status === "finished");
  const rests = (await db.all("days")).filter((d) => d.rest);
  const rows = [
    ...sessions.map((s) => ({ date: s.date, html: `<button type="button" class="hist" data-go="open" data-id="${esc(s.id)}">
      <span class="hicon" aria-hidden="true">${ICONS[s.act]}</span>
      <span class="htxt"><b>${esc(s.title)}</b><span class="muted small">${esc(detail(s))}</span></span>
      ${recovery(s)}<span class="chev" aria-hidden="true">›</span></button>` })),
    ...rests.map((d) => ({ date: d.date, html: `<div class="hist">
      <span class="hicon" aria-hidden="true">🛋️</span>
      <span class="htxt"><b>Rest day</b><span class="muted small">${esc(plan.meta.principles.at(-1))}</span></span>
      ${d.readiness ? `<span class="pill ${d.readiness.level}">${plan.readiness.levels[d.readiness.level].label}</span>` : ""}</div>` })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  if (!rows.length) {
    $screen.innerHTML = `<h1>History</h1><div class="card empty">Nothing logged yet. Your sessions, swims, walks and rest days will appear here. Tap any session to correct it.</div>`;
    return;
  }
  let lastDate = "";
  const items = rows.map((x) => {
    const head = x.date !== lastDate ? `<h3 class="hdate">${fmt(parseDate(x.date), { weekday: "long", day: "numeric", month: "long" })}</h3>` : "";
    lastDate = x.date;
    return head + x.html;
  }).join("");
  $screen.innerHTML = `<h1>History</h1><p class="muted small">Every session and rest day counts. Tap a session to view or correct it.</p>${items}`;
}
