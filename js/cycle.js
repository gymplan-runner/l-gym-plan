// Cycle tracking: period days and symptoms, kept on each day's record (days store, field `cycle`).
// Only she logs it; it's in her backups like everything else. Predictions stay cautious: nothing until
// 3 full cycles are logged, a range rather than a date, and none at all if her cycles vary a lot.
import { parseDate, isoDate, addDays } from "./plan.js";
import { esc, fmt } from "./ui.js";

export const FLOWS = [["spotting", "Spotting"], ["light", "Light"], ["medium", "Medium"], ["heavy", "Heavy"]];
export const SYMPTOMS = [["cramps", "Cramps"], ["headache", "Headache"], ["bloating", "Bloating"],
  ["tiredness", "Tiredness"], ["low_mood", "Low mood"], ["poor_sleep", "Poor sleep"]];
const PERIOD = new Set(["light", "medium", "heavy"]);  // spotting alone doesn't start a cycle
const MIN_CYCLES = 3, MAX_SPREAD = 10, NEW_START_GAP = 7;

const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
const label = (list, id) => list.find(([k]) => k === id)?.[1] ?? id;

// First day of each period: a period day with no period day in the week before it.
export function starts(days) {
  const flow = days.filter((d) => PERIOD.has(d.cycle?.flow)).map((d) => d.date).sort();
  return flow.filter((iso, i) => i === 0 || daysBetween(flow[i - 1], iso) > NEW_START_GAP);
}

export function cycleInfo(days, iso) {
  const st = starts(days).filter((s) => s <= iso);
  const last = st.at(-1) ?? null;
  const lengths = st.slice(1).map((s, i) => daysBetween(st[i], s)).slice(-6);
  const info = { last, day: last ? daysBetween(last, iso) + 1 : null, cycles: lengths.length, prediction: null, why: "" };
  if (lengths.length < MIN_CYCLES) {
    info.why = `A likely date for your next period shows once ${MIN_CYCLES} full cycles are logged (${lengths.length} so far).`;
    return info;
  }
  const lo = Math.min(...lengths), hi = Math.max(...lengths);
  if (hi - lo > MAX_SPREAD) {
    info.why = `Your recent cycles ranged from ${lo} to ${hi} days, too varied for a useful prediction.`;
    return info;
  }
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const from = Math.min(lo, Math.round(mean) - 2), to = Math.max(hi, Math.round(mean) + 2);
  info.prediction = { from: isoDate(addDays(parseDate(last), from)), to: isoDate(addDays(parseDate(last), to)), lo, hi };
  return info;
}

// Heavy flow or cramps today: worth a gentle nudge towards the lighter version. Her pain and energy still decide.
export const toughDay = (day) => day?.cycle?.flow === "heavy" || !!day?.cycle?.symptoms?.includes("cramps");

export function summary(c) {
  if (!c) return "";
  return [c.flow ? `${label(FLOWS, c.flow)} flow` : "", ...(c.symptoms ?? []).map((s) => label(SYMPTOMS, s).toLowerCase())]
    .filter(Boolean).join(" · ");
}

const short = (iso) => fmt(parseDate(iso), { weekday: "short", day: "numeric", month: "short" });

// The Today card. `edit` is null (closed) or { date, flow, symptoms, note } while she's logging.
export function cycleCard(days, iso, edit) {
  const info = cycleInfo(days, iso);
  const todayRec = days.find((d) => d.date === iso)?.cycle;
  let line = info.day ? `Day ${info.day} of your cycle.` : "Log a period day to start tracking your cycle.";
  if (info.prediction) {
    const p = info.prediction;
    line += iso > p.to ? " Your next period may be due. Log it when it starts."
      : ` Next period likely ${short(p.from)} – ${short(p.to)}.`;
  }
  if (!edit) {
    return `<div class="card cycle"><div class="cyc-head"><b>Cycle</b>
      <button type="button" class="linkbtn" data-go="cyc-open">${todayRec ? "Edit today" : "Log today"}</button></div>
      ${todayRec ? `<p class="small"><b>Today:</b> ${esc(summary(todayRec)) || "noted"}</p>` : ""}
      <p class="muted small">${esc(line)}</p>
      ${info.prediction ? "" : info.last ? `<p class="muted small">${esc(info.why)}</p>` : ""}</div>`;
  }
  const yest = isoDate(addDays(parseDate(iso), -1));
  const pick = (go, val, on, text) => `<button type="button" class="chip ${on ? "on" : ""}" data-go="${go}" data-v="${val}" aria-pressed="${on}">${text}</button>`;
  return `<div class="card cycle"><div class="cyc-head"><b>Cycle</b></div>
    <div class="chips pick">${pick("cyc-date", iso, edit.date === iso, "Today")}${pick("cyc-date", yest, edit.date === yest, "Yesterday")}</div>
    <p class="q">Period</p>
    <div class="chips pick">${FLOWS.map(([k, t]) => pick("cyc-flow", k, edit.flow === k, t)).join("")}</div>
    <p class="muted small">Leave it blank for a non-period day with symptoms.</p>
    <p class="q">Anything else? <span class="muted small">(tap all that apply)</span></p>
    <div class="chips">${SYMPTOMS.map(([k, t]) => pick("cyc-sym", k, edit.symptoms.includes(k), t)).join("")}</div>
    <input class="in wide" id="cyc-note" value="${esc(edit.note ?? "")}" placeholder="Note (optional)" style="margin-top:10px">
    <div class="row2"><button type="button" class="btn ghost" data-go="cyc-cancel">Cancel</button>
    <button type="button" class="btn" data-go="cyc-save">Save</button></div>
    ${days.find((d) => d.date === edit.date)?.cycle ? `<button type="button" class="linkbtn" data-go="cyc-clear">Remove this day's entry</button>` : ""}</div>`;
}

// Progress: her pain, energy and feeling by week of her cycle, from days she did a readiness check.
export function patternsSection(days) {
  const st = starts(days);
  if (st.length < 2) return "";
  const rows = [["Days 1–7", 1, 7], ["Days 8–14", 8, 14], ["Days 15–21", 15, 21], ["Day 22 on", 22, 99]];
  const bucket = rows.map(() => ({ n: 0, pain: [], energy: [], feeling: [] }));
  for (const d of days) {
    if (!d.readiness) continue;
    const s = st.filter((x) => x <= d.date).at(-1);
    if (!s) continue;
    const day = daysBetween(s, d.date) + 1;
    const i = rows.findIndex(([, a, b]) => day >= a && day <= b);
    if (i < 0) continue;
    bucket[i].n += 1;
    for (const k of ["pain", "energy", "feeling"]) if (d.readiness[k] != null) bucket[i][k].push(d.readiness[k]);
  }
  const avg = (xs) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : "–");
  return `<h2>Your cycle and how you feel</h2><div class="card">
    <table class="quad"><tr><th>Cycle</th><th>Days</th><th>Pain</th><th>Energy</th><th>Feeling</th></tr>
    ${rows.map(([t], i) => `<tr><td>${t}</td><td>${bucket[i].n}</td><td>${avg(bucket[i].pain)}</td><td>${avg(bucket[i].energy)}</td><td>${avg(bucket[i].feeling)}</td></tr>`).join("")}</table>
    <p class="muted small">Averages from the days you did a "how are you" check, by day of your cycle. Patterns become clearer over a few months.</p></div>`;
}
