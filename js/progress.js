// Progress tab: what she's done, swim time, exercises getting easier, pain and energy, recovery,
// eating habits, and optional body measures. Real entries only, and never framed as a quota.
import * as db from "./db.js";
import { getPlan, parseDate, addDays, isoDate, position, sessionItems } from "./plan.js";
import { esc, fmt, toast, num, today } from "./ui.js";
import { lineChart } from "./charts.js";
import { sessionCrashed } from "./checks.js";
import { levelFor, swimTarget } from "./progression.js";

const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

// Average of pick(r) per week.
function perWeek(records, pick) {
  const m = new Map();
  for (const r of records) {
    const v = pick(r);
    if (v == null || !Number.isFinite(v)) continue;
    if (!m.has(r.week)) m.set(r.week, []);
    m.get(r.week).push(v);
  }
  return [...m].sort((a, b) => a[0] - b[0]).map(([x, ys]) => ({ x, y: avg(ys) }));
}

const later = (s) => {  // the latest recovery check that has scores
  const c = s.checks ?? {};
  return [c.h48, c.h24].find((x) => x && !x.skipped) ?? null;
};

const tile = (n, label) => `<div class="stat"><b>${n}</b><span>${esc(label)}</span></div>`;

function totals(sessions, days, now) {
  const count = (k, xs = sessions) => xs.filter((s) => s.kind === k).length;
  const mon = addDays(now, -((now.getDay() + 6) % 7));
  const wk = sessions.filter((s) => s.date >= isoDate(mon) && s.date <= isoDate(now));
  const rests = days.filter((d) => d.rest).length;
  const t = getPlan().schedule.targets;
  return `<h2>So far</h2><div class="stats">${tile(count("gym"), "gym sessions")}${tile(count("swim"), "swims")}
      ${tile(count("walk"), "walks")}${tile(rests, "rest days chosen")}</div>
    <p class="muted small">This week: ${count("gym", wk)} gym (up to ${t.gym_per_week}) and ${count("swim", wk)} swim${count("swim", wk) === 1 ? "" : "s"} (up to ${t.swims_per_week}). The targets are gentle guides, not quotas.</p>`;
}

async function swimSection(sessions) {
  const swims = sessions.filter((s) => s.kind === "swim" && s.minutes != null);
  const target = await swimTarget();
  const recent = [...swims].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 3);
  const comfy = swims.filter((s) => !sessionCrashed(s) && (s.after?.energy ?? 0) >= (s.before?.energy ?? 99) - 1);
  const best = comfy.length ? Math.max(...comfy.map((s) => s.minutes)) : null;
  return `<h2>Swimming</h2><div class="card">
    <div class="g-row"><span>Your swim target now</span><b>${esc(target.minutes)} min</b></div>
    <div class="g-row"><span>Longest comfortable swim</span><b>${best != null ? `${best} min` : "–"}</b></div>
    <div class="g-row"><span>Last few swims</span><b>${recent.length ? recent.map((s) => `${s.minutes}`).join(", ") + " min" : "–"}</b></div>
    <p class="muted small">"Comfortable" means no dip afterwards and energy held up.</p>
    ${swims.length ? lineChart({ title: "Swim minutes (weekly average)", unit: " min", series: [{ name: "Minutes", points: perWeek(swims, (s) => s.minutes) }] }) : ""}
  </div>`;
}

async function strengthSection(sessions) {
  const plan = getPlan();
  const seen = new Set();
  const rows = [];
  for (const actId of ["gym_a", "gym_b"]) {
    for (const it of sessionItems(actId)) {
      if (["warm_up", "cool_down"].includes(it.exercise) || seen.has(it.exercise)) continue;
      seen.add(it.exercise);
      const lv = await levelFor(it);
      const done = sessions.filter((s) => s.kind === "gym").flatMap((s) => s.items.filter((i) => i.exercise === it.exercise && i.status === "done").map((i) => ({ ...i, date: s.date })))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      const kgs = done.filter((i) => i.kg != null);
      const startDose = `${it.sets} × ${it.reps}`;
      const now = lv.since ? `${lv.sets} × ${lv.reps}` : startDose;
      const kg = kgs.length ? (kgs.length > 1 && kgs[0].kg !== kgs.at(-1).kg ? `${kgs[0].kg} → ${kgs.at(-1).kg} kg` : `${kgs.at(-1).kg} kg`) : "";
      rows.push(`<tr><td>${esc(plan.exercises[it.exercise].name)}</td><td>${esc(startDose)}</td>
        <td>${lv.since ? `<b>${esc(now)}</b> ✓` : esc(now)}${kg ? `<br><span class="muted small">${esc(kg)}</span>` : ""}</td><td>${done.length}</td></tr>`);
    }
  }
  const stepped = rows.filter((r) => r.includes("✓")).length;
  return `<h2>Exercises getting easier</h2><div class="card">
    <p class="small">${stepped ? `You've taken ${stepped} small step${stepped === 1 ? "" : "s"} up. Each one came after good recovery.` : "No steps up yet, and that's fine. Repeating the starting routine comfortably is progress."}</p>
    <table class="quad"><tr><th>Exercise</th><th>Started</th><th>Now</th><th>Times</th></tr>${rows.join("")}</table></div>`;
}

function feelSection(sessions) {
  const scored = sessions.filter((s) => s.before?.pain != null);
  if (!scored.length) return `<h2>Pain and energy</h2><div class="card empty">Your pain and energy trends will appear here after a few sessions.</div>`;
  const pain = [{ name: "Before sessions", dashed: true, points: perWeek(scored, (s) => s.before.pain) },
    { name: "1–2 days after", points: perWeek(scored, (s) => later(s)?.pain) }];
  const energy = [{ name: "Before sessions", dashed: true, points: perWeek(scored, (s) => s.before.energy) },
    { name: "1–2 days after", points: perWeek(scored, (s) => later(s)?.energy) }];
  const t = getPlan().tracking;
  return `<h2>Pain and energy</h2><div class="card">
    ${lineChart({ title: `Pain (${t.pain.min}–${t.pain.max}, lower is better)`, series: pain, yMin: 0, yMax: 10 })}
    ${lineChart({ title: `Energy (${t.energy.min}–${t.energy.max}, higher is better)`, series: energy, yMin: 1, yMax: 5 })}
    <p class="muted small">Weekly averages. "After" uses your 2-day check, or the 1-day check if that's all there is.</p></div>`;
}

function recoverySection(sessions) {
  const checked = sessions.filter((s) => later(s));
  if (!checked.length) return "";
  const weeks = new Map();
  for (const s of checked) {
    const w = weeks.get(s.week) ?? { n: 0, dips: 0 };
    w.n += 1;
    if (sessionCrashed(s)) w.dips += 1;
    weeks.set(s.week, w);
  }
  const dips = checked.filter(sessionCrashed).length;
  return `<h2>Recovery</h2><div class="card">
    <p><b>${checked.length - dips} of ${checked.length}</b> checked sessions recovered well${dips ? `, and ${dips} had a dip afterwards` : ""}.</p>
    <table class="quad"><tr><th>Week</th><th>Checked</th><th>Recovered well</th><th>Dips</th></tr>
      ${[...weeks].sort((a, b) => a[0] - b[0]).map(([w, v]) => `<tr><td>${w || "Before"}</td><td>${v.n}</td><td>${v.n - v.dips}</td>
        <td>${v.dips ? `<span class="pill amber">${v.dips}</span>` : "0"}</td></tr>`).join("")}</table>
    <p class="muted small">A dip means pain 2+ higher or energy 2+ lower than before the session. Fewer dips over time shows you're finding your pace.</p></div>`;
}

function habitsSection(days, now) {
  const habits = getPlan().nutrition.habits;
  const ticked = days.filter((d) => habits.some((h) => d.nutrition?.[h.id]));
  if (!ticked.length) return "";
  const since = isoDate(addDays(now, -6));
  const week = ticked.filter((d) => d.date >= since);
  return `<h2>Eating habits</h2><div class="card">
    <p class="small">You've ticked a habit on <b>${ticked.length}</b> day${ticked.length === 1 ? "" : "s"} so far (${week.length} in the last 7 days).</p>
    ${habits.map((h) => {
      const n = days.filter((d) => d.nutrition?.[h.id]).length;
      return `<div class="g-row"><span>${esc(h.label)}</span><b>${n} day${n === 1 ? "" : "s"}</b></div>`;
    }).join("")}</div>`;
}

async function bodySection(start) {
  const on = await db.getSetting("bodyOn", {});
  const measures = getPlan().body.measures;
  const active = measures.filter((m) => on[m.id]);
  const entries = (await db.all("body")).sort((a, b) => (a.date < b.date ? 1 : -1));
  const toggles = `<div class="chips">${measures.map((m) => `<button type="button" class="chip ${on[m.id] ? "on" : ""}" data-go="body-on" data-m="${m.id}"
    aria-pressed="${!!on[m.id]}">${on[m.id] ? "✓ " : ""}${esc(m.label)}</button>`).join("")}</div>`;
  if (!active.length) {
    return `<h2>Body measures <span class="muted small">(optional)</span></h2><div class="card">
      <p class="small">${esc(getPlan().body.note)} Tap one to start tracking it. You can turn it off again any time.</p>${toggles}</div>`;
  }
  const iso = isoDate(today());
  const form = `<div class="row2b">${active.map((m) => `<label class="mini">${esc(m.label)} (${m.unit})
    <input class="in" inputmode="decimal" id="body-${m.id}" placeholder="${m.unit}"></label>`).join("")}</div>
    <button type="button" class="btn" data-go="body-save">Save for ${fmt(parseDate(iso), { day: "numeric", month: "short" })}</button>`;
  const charts = active.map((m) => {
    const pts = entries.filter((e) => e[m.id] != null).map((e) => ({ x: weekOf(e.date, start), y: e[m.id] }));
    const byWeek = new Map();  // latest entry each week: entries are newest first, so walk them oldest first
    for (const p of [...pts].reverse()) byWeek.set(p.x, p.y);
    const points = [...byWeek].sort((a, b) => a[0] - b[0]).map(([x, y]) => ({ x, y }));
    return points.length ? lineChart({ title: `${m.label} (${m.unit})`, unit: ` ${m.unit}`, series: [{ name: m.label, points }], yMin: Math.floor(Math.min(...points.map((p) => p.y)) * 0.95), yMax: Math.ceil(Math.max(...points.map((p) => p.y)) * 1.03) }) : "";
  }).join("");
  const listed = entries.slice(0, 8).map((e) => `<div class="g-row"><span>${fmt(parseDate(e.date), { day: "numeric", month: "short" })}</span>
    <b>${active.map((m) => (e[m.id] != null ? `${e[m.id]} ${m.unit}` : "")).filter(Boolean).join(" · ") || "–"}</b>
    <button type="button" class="linkbtn" data-go="body-del" data-id="${e.id}" aria-label="Delete">✕</button></div>`).join("");
  return `<h2>Body measures <span class="muted small">(optional)</span></h2><div class="card">
    <p class="muted small">${esc(getPlan().body.note)} Measuring every week or two is plenty.</p>${toggles}${form}${charts}${listed}</div>`;
}

const weekOf = (iso, start) => {
  const p = position(parseDate(iso), start);
  return p.status === "before" ? 0 : p.week;
};

export async function renderProgress($screen, start) {
  const now = today();
  const sessions = (await db.all("sessions")).filter((s) => s.status === "finished");
  const days = await db.all("days");
  $screen.innerHTML = `<h1>Progress</h1>
    <p class="muted small">Success here means taking part in a way you can keep up, and recovering well. It doesn't mean doing every session.</p>
    ${totals(sessions, days, now)}
    ${await swimSection(sessions)}
    ${await strengthSection(sessions)}
    ${feelSection(sessions)}
    ${recoverySection(sessions)}
    ${habitsSection(days, now)}
    ${await bodySection(start)}`;
}

// Progress-screen taps. Returns true when handled (the caller then redraws).
export async function progressAction(go, b, start) {
  if (go === "body-on") {
    const on = await db.getSetting("bodyOn", {});
    on[b.dataset.m] = !on[b.dataset.m];
    await db.setSetting("bodyOn", on);
    return true;
  }
  if (go === "body-save") {
    const iso = isoDate(today());
    const rec = (await db.get("body", `body-${iso}`)) ?? { id: `body-${iso}`, date: iso, week: weekOf(iso, start) };
    let any = false;
    for (const m of getPlan().body.measures) {
      const v = num(document.getElementById(`body-${m.id}`)?.value);
      if (v != null) { rec[m.id] = v; any = true; }
    }
    if (!any) { toast("Type a number first"); return false; }
    await db.put("body", rec);
    toast("Saved");
    return true;
  }
  if (go === "body-del") {
    if (!confirm("Delete this entry?")) return false;
    await db.remove("body", b.dataset.id);
    return true;
  }
  return false;
}
