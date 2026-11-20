// Logging a gym session, swim or walk: exercises, sets, rest timer, autosave, resume, finish with pain and energy.
import * as db from "./db.js";
import { getPlan, activity, doseText, colour, picto, parseDate, isTimed, sessionItems, addDays, isoDate } from "./plan.js";
import { esc, toast, celebrate, num, mmss, fmt, today } from "./ui.js";
import { getDay, updateDay } from "./checks.js";
import { beep, unlockAudio } from "./beep.js";
import { swimTarget } from "./progression.js";

// it: a plan item already dosed for the day's level (sessionItems).
function newItem(it) {
  const type = isTimed(it.exercise) ? "cardio" : "strength";
  const sets = type === "strength" ? it.sets ?? 1 : null;
  const planned = { sets, reps: type === "strength" ? it.reps : null, minutes: it.minutes ?? null, optional: !!it.optional,
    note: it.note ?? null, setting: !!it.setting };
  planned.dose = doseText(planned);
  return {
    exercise: it.exercise, type, planned, lighter: false,
    sets: type === "strength" ? Array.from({ length: sets }, () => ({ kg: null, reps: null, done: false })) : [],
    minutes: null, kg: null, setting: "", note: "", status: "todo",
  };
}

// loggedLater: added afterwards, with no "before" check; baseline (her usual day) stands in for it.
export async function newSession({ act, date, week, level, before, loggedLater = false, baseline = null }) {
  const a = activity(act);
  const s = { id: `${act}-${date}-${Date.now().toString(36)}`, kind: a.kind, act, title: a.name, date, week, level,
    before, after: { pain: null, energy: null }, checks: {}, status: "in_progress", startedAt: Date.now(), note: "" };
  if (loggedLater) Object.assign(s, { loggedLater, baseline });
  if (a.kind === "gym") {
    s.items = [];
    for (const it of sessionItems(act, level)) {
      const item = newItem(it);
      if (it.setting) {
        item.setting = (await db.getSetting(`setting:${it.exercise}`, "")) || "";
        // Each set starts at last time's weight, so it isn't done from memory.
        item.kg = await db.getSetting(`kg:${it.exercise}`, null);
        for (const st of item.sets) st.kg = item.kg;
      }
      s.items.push(item);
    }
  } else {
    const target = act === "swim" ? (await swimTarget()).minutes : a.minutes;
    s.target = level === "amber" && act === "swim" ? a.amber_minutes : target ?? null;
    s.minutes = null;
  }
  await db.put("sessions", s);
  return s;
}

// Most recent finished record of each exercise (from an earlier session).
async function lastTimes(beforeId, beforeDate) {
  const sessions = (await db.all("sessions"))
    .filter((s) => s.kind === "gym" && s.status === "finished" && s.id !== beforeId && s.date <= beforeDate)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const last = {};
  for (const s of sessions) {
    for (const it of s.items) {
      if (!last[it.exercise] && it.status === "done") last[it.exercise] = { ...it, date: s.date };
    }
  }
  return last;
}

// Weight of a set: its own, else the exercise's (sessions before 16 Nov 2026 kept one weight per exercise).
const setKg = (it, st) => st.kg ?? it.kg ?? null;

function lastLine(last) {
  if (!last) return "";
  if (last.type === "cardio") return `Last time: ${last.minutes ?? "–"} min`;
  const done = last.sets.filter((x) => x.done);
  const reps = done.map((x) => x.reps ?? "–").join(", ");
  const kgs = [...new Set(done.map((x) => setKg(last, x)).filter((v) => v != null))];
  return `Last time: ${kgs.length ? `${kgs.join("/")} kg × ` : ""}${reps || "–"}${kgs.length ? "" : " reps"}${last.setting ? ` · ${last.setting}` : ""}`;
}

export function scoreChips(name, scale, selected, attrs = "") {
  const vals = [];
  for (let v = scale.min; v <= scale.max; v++) vals.push(v);
  return `<div class="chips score" role="group">${vals.map((v) =>
    `<button type="button" class="chip ${selected === v ? "on" : ""}" data-act="${name}" data-v="${v}" ${attrs}
      aria-pressed="${selected === v}">${v}</button>`).join("")}</div>
    <div class="scale-ends"><span>${esc(scale.low)}</span><span>${esc(scale.high)}</span></div>`;
}

// ------------------------------------------------------------------ view
export function createSessionView({ $screen, $tabs, onExit }) {
  let S, edit = null, last = {}, open = null, rest = null, restTimer = null, clock = null, wakeLock = null, finishing = false;

  async function save() {
    try { await db.put("sessions", S); } catch { toast("Couldn't save. Please try again.", "bad"); }
  }

  async function start(session, { finish = false } = {}) {
    S = session;
    // Editing a finished session: her "before" scores and the 1- and 2-day checks can be corrected too.
    // The optional overall feeling lives on that day's readiness record.
    edit = S.status === "finished" ? { feeling: (await getDay(S.date)).readiness?.feeling ?? null, beforeChanged: false } : null;
    last = S.kind === "gym" ? await lastTimes(S.id, S.date) : {};
    open = S.kind === "gym" ? S.items.findIndex((i) => i.status === "todo") : null;
    if (open < 0) open = null;
    finishing = finish || (S.kind !== "gym" && S.status === "finished");
    $tabs.hidden = true;
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* not supported */ }
    clock = setInterval(updateClock, 15000);
    render();
  }

  function leave() {
    clearInterval(clock); clearInterval(restTimer);
    rest = null;
    wakeLock?.release?.().catch(() => {});
    S = null;
    $tabs.hidden = false;
    onExit();
  }

  const elapsed = () => Math.max(1, Math.round((Date.now() - S.startedAt) / 60000));

  function updateClock() {
    const el = document.getElementById("elapsed");
    if (el && S?.status === "in_progress") el.textContent = `${elapsed()} min`;
  }

  const bg = () => colour(S.act);
  const lighterTag = () => (S.level === "amber" ? ` · <b>lighter version</b>` : S.level === "red" ? ` · <b>gentle version</b>` : "");
  const when = () => fmt(parseDate(S.date), { weekday: "long", day: "numeric", month: "long" });

  function chips(name, idx, values, selected) {
    return `<div class="chips" role="group">${values.map((v) =>
      `<button type="button" class="chip ${String(selected) === String(v) ? "on" : ""}" data-act="${name}" data-i="${idx}" data-v="${v}"
        aria-pressed="${String(selected) === String(v)}">${v}</button>`).join("")}</div>`;
  }

  function howTo(ex) {
    const list = (title, xs) => (xs?.length ? `<p class="small"><b>${title}</b></p><ul class="small">${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
    return `<details class="how"><summary>How to do it</summary><p class="small">${esc(ex.what)}</p>
      <p class="muted small">${esc(ex.equipment.join(" or "))}</p>
      <ol>${ex.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>${ex.tips.map((t) => `<p class="tip">✓ ${esc(t)}</p>`).join("")}
      ${list("Easier options", ex.modifications)}${list("Take care", [...(ex.contraindications ?? []), ...(ex.safety ?? [])])}</details>`;
  }

  function setRows(item, i) {
    if (item.type === "cardio") {
      return `<div class="setrow"><span>Minutes</span>
        <input class="in" inputmode="decimal" data-field="minutes" data-i="${i}" value="${item.minutes ?? ""}" placeholder="${esc(item.planned.minutes ?? "")}" aria-label="Minutes"></div>`;
    }
    // Weighted exercises get a kg box on every set (pre-filled from last time); bodyweight ones log reps only.
    const rows = item.sets.map((st, j) => `<div class="setrow ${st.done ? "done" : ""}"><span>Set ${j + 1}</span>
      ${item.planned.setting ? `<input class="in" inputmode="decimal" data-field="kg" data-i="${i}" data-j="${j}" value="${setKg(item, st) ?? ""}" placeholder="kg" aria-label="Set ${j + 1} kg">` : ""}
      <input class="in" inputmode="numeric" data-field="reps" data-i="${i}" data-j="${j}" value="${st.reps ?? ""}" placeholder="${esc(String(item.planned.reps ?? "reps"))}" aria-label="Set ${j + 1} reps">
      <button type="button" class="tickbtn" data-act="tick" data-i="${i}" data-j="${j}" aria-label="Set ${j + 1} done" aria-pressed="${st.done}">${st.done ? "✓" : "○"}</button></div>`).join("");
    return `${rows}<button type="button" class="linkbtn" data-act="addset" data-i="${i}">+ Add set</button>`;
  }

  function card(item, i) {
    const ex = getPlan().exercises[item.exercise];
    const isOpen = open === i;
    const badge = item.status === "done" ? `<span class="badge ok">✓ Done</span>`
      : item.status === "skipped" ? `<span class="badge skip">${item.lighter ? "Lighter day" : "Skipped"}</span>` : "";
    const head = `<button type="button" class="ex-head" data-act="toggle" data-i="${i}" aria-expanded="${isOpen}">
      <span class="pic-wrap">${picto(item.exercise, S.act)}</span><span class="txt"><span class="name">${esc(ex.name)}${item.planned.optional ? ' <span class="tag">optional</span>' : ""}</span>
      <span class="dose">${esc(item.planned.dose)}</span></span>${badge}</button>`;
    if (!isOpen) return `<div class="ex ${item.status}">${head}</div>`;
    if (item.status === "skipped" && item.lighter) {
      return `<div class="ex open skipped">${head}<div class="ex-body">
        <p class="small">Left out to make today lighter. Add it back only if you feel up to it.</p>
        <button type="button" class="btn ghost" data-act="addback" data-i="${i}">Add it back</button></div></div>`;
    }
    const lt = last[item.exercise];
    const setting = item.planned.setting
      ? `<label class="mini">Machine / seat setting<input class="in wide" data-field="setting" data-i="${i}" value="${esc(item.setting)}" placeholder="e.g. seat 4"></label>` : "";
    return `<div class="ex open ${item.status}">${head}<div class="ex-body">
      ${item.planned.note ? `<p class="note">${esc(item.planned.note)}</p>` : ""}${howTo(ex)}
      ${lt ? `<p class="last">${esc(lastLine(lt))}</p>` : item.type === "strength" ? `<p class="last">First time: start light, and ask an instructor to check the setup.</p>` : ""}
      ${setting}${setRows(item, i)}
      <input class="in wide" data-field="note" data-i="${i}" value="${esc(item.note)}" placeholder="Note (optional)" aria-label="Note">
      <div class="row2"><button type="button" class="btn ghost" data-act="skip" data-i="${i}">${item.status === "skipped" ? "Undo skip" : "Skip"}</button>
      <button type="button" class="btn" data-act="done" data-i="${i}">${item.status === "done" ? "Done ✓" : "Mark done"}</button></div>
    </div></div>`;
  }

  function stopSigns() {
    const p = getPlan().safety;
    return `<details class="how stop"><summary>When to stop</summary><p class="small">Stop if you notice: ${p.stop_if.map((x) => esc(x.toLowerCase())).join(", ")}.</p></details>`;
  }

  function render() {
    if (finishing) return renderFinish();
    if (S.kind !== "gym") return renderActivity();
    const total = S.items.filter((i) => !i.lighter || i.status !== "skipped").length;
    const done = S.items.filter((i) => i.status === "done").length;
    const editing = S.status === "finished";
    $screen.innerHTML = `
      <div class="wk-top" style="background:${bg()}">
        <button type="button" class="back" data-act="exit">‹ Today</button>
        <h1>${esc(S.title)}</h1>
        <p>${editing ? "Editing a finished session" : S.loggedLater ? `Adding ${esc(when())}` : `<span id="elapsed">${elapsed()} min</span>`} · ${done} of ${total} done${lighterTag()}</p>
      </div>
      <p class="muted small">Rest between exercises as long as you need. Skipping anything is fine.</p>
      ${stopSigns()}
      <div class="exlist">${S.items.map(card).join("")}</div>
      <button type="button" class="btn finish" data-act="finish">${editing ? "Save changes" : "Finish session"}</button>
      <button type="button" class="linkbtn danger-link" data-act="discard">${editing ? "Delete this session" : "Stop and discard this session"}</button>
      ${rest ? `<div class="restbar" role="timer"><span>Rest <b id="restleft">${mmss(rest.left)}</b></span>
        <button type="button" data-act="rest-" aria-label="15 seconds less">−15</button><button type="button" data-act="rest+" aria-label="15 seconds more">+15</button>
        <button type="button" data-act="restskip">Skip</button></div>` : ""}`;
  }

  // Swim or walk: the guidance, then log it when she's back.
  async function renderActivity() {
    const a = activity(S.act), ex = getPlan().exercises[a.exercise];
    $screen.innerHTML = `
      <div class="wk-top" style="background:${bg()}">
        <button type="button" class="back" data-act="exit">‹ Today</button>
        <h1>${esc(S.title)}</h1><p>${S.target ? `About ${esc(S.target)} min` : esc(a.focus)}${lighterTag()}</p>
      </div>
      <div class="card"><div class="guide-pic">${picto(a.exercise, S.act)}</div><p>${esc(ex.what)}</p><ul>${ex.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
        ${ex.tips.map((t) => `<p class="tip">✓ ${esc(t)}</p>`).join("")}${stopSigns()}</div>
      <button type="button" class="btn finish" data-act="finish">I'm back: log it</button>
      <button type="button" class="linkbtn danger-link" data-act="discard">Changed my mind: discard</button>`;
  }

  function startRest() {
    if (S.loggedLater) return;  // no rest timer when adding a session afterwards
    clearInterval(restTimer);
    rest = { left: getPlan().app.rest_timer_seconds };
    restTimer = setInterval(() => {
      rest.left -= 1;
      const el = document.getElementById("restleft");
      if (el) el.textContent = mmss(Math.max(0, rest.left));
      if (rest.left <= 0) { clearInterval(restTimer); rest = null; beep(2); render(); }
    }, 1000);
  }

  function renderFinish() {
    const t = getPlan().tracking;
    const editing = S.status === "finished";
    if (S.durationMin == null && S.kind === "gym" && !S.loggedLater) S.durationMin = elapsed();
    const later = S.loggedLater;
    const gym = S.kind === "gym";
    const summary = gym ? (() => {
      const done = S.items.filter((i) => i.status === "done").length;
      const skipped = S.items.filter((i) => i.status === "skipped").length;
      return `<p><b>${done}</b> done${skipped ? ` · ${skipped} skipped or left out` : ""}</p>`;
    })() : "";
    const mins = gym ? S.durationMin : S.minutes;
    $screen.innerHTML = `
      <div class="wk-top" style="background:${bg()}"><button type="button" class="back" data-act="${editing && !gym ? "exit" : later && !gym ? "drop" : "unfinish"}">‹ Back</button>
        <h1>${editing ? "Edit" : "Well done 💙"}</h1><p>${esc(S.title)}${later ? ` · ${esc(when())}` : ""}${lighterTag()}</p></div>
      <div class="card">${summary}
        <label class="mini">${gym ? "How long did it take? (minutes)" : `Minutes ${S.kind === "swim" ? "in the water" : "walking"}`}
          <input class="in wide" inputmode="numeric" data-field="mins" value="${mins ?? ""}" placeholder="${esc(S.target ?? "")}"></label>
        <p class="q">Pain ${editing ? "straight after" : later ? "afterwards" : "now"} (${t.pain.min}–${t.pain.max})</p>${scoreChips("apain", t.pain, S.after.pain)}
        <p class="q">Energy ${editing ? "straight after" : later ? "afterwards" : "now"} (${t.energy.min}–${t.energy.max})</p>${scoreChips("aenergy", t.energy, S.after.energy)}
        ${editing ? editScores(t) : S.before?.pain != null ? `<p class="muted small">Before: pain ${S.before.pain}, energy ${S.before.energy}.</p>` : ""}
        <label class="mini">Notes or symptoms<textarea class="in wide" data-field="snote" rows="3" placeholder="Anything to remember?">${esc(S.note ?? "")}</textarea></label>
        ${editing ? "" : `<p class="muted small">${later ? "I'll check in on how you're feeling over the next couple of days" : "I'll ask how you feel tomorrow and the day after"}, as delayed effects matter most.</p>`}
        <button type="button" class="btn" data-act="confirm">${editing ? "Save changes" : "Save"}</button>
      </div>
      ${editing && !gym ? `<button type="button" class="linkbtn danger-link" data-act="discard">Delete this entry</button>` : ""}`;
  }

  // On the Edit screen: the scores from before the session, and the 1- and 2-day checks, all changeable.
  function editScores(t) {
    const feel = { min: 1, max: 10, low: "exhausted or unwell", high: "full of energy" };
    const before = S.before ? `<h3 class="edit-h">Before the session</h3>
        <p class="q">Pain (${t.pain.min}–${t.pain.max})</p>${scoreChips("bpain", t.pain, S.before.pain)}
        <p class="q">Energy (${t.energy.min}–${t.energy.max})</p>${scoreChips("benergy", t.energy, S.before.energy)}
        <p class="q">Overall feeling (1–10, optional)</p>${scoreChips("bfeel", feel, edit.feeling)}` : "";
    const nowIso = isoDate(today());
    const checks = [["h24", 1, "1 day later"], ["h48", 2, "2 days later"]]
      .filter(([key, n]) => S.checks?.[key] || isoDate(addDays(parseDate(S.date), n)) <= nowIso)
      .map(([key, , label]) => {
        const c = S.checks?.[key] ?? {};
        return `<h3 class="edit-h">${label}${c.skipped ? ` <span class="muted small">(skipped)</span>` : ""}</h3>
        <p class="q">Pain (${t.pain.min}–${t.pain.max})</p>${scoreChips(`cpain-${key}`, t.pain, c.pain ?? null)}
        <p class="q">Energy (${t.energy.min}–${t.energy.max})</p>${scoreChips(`cenergy-${key}`, t.energy, c.energy ?? null)}`;
      }).join("");
    return before + checks;
  }

  function setCheck(key, field, v) {
    const c = { ...(S.checks?.[key] ?? {}) };
    delete c.skipped;
    c[field] = c[field] === v ? null : v;
    c.at ??= isoDate(today());
    c.edited = isoDate(today());
    S.checks = { ...S.checks, [key]: c };
  }

  async function onClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b || !S) return;
    unlockAudio();
    const act = b.dataset.act, i = Number(b.dataset.i), j = Number(b.dataset.j), v = Number(b.dataset.v);
    const item = S.items?.[i];
    switch (act) {
      case "exit": await save(); return leave();
      case "drop": await db.remove("sessions", S.id); return leave();  // backing out of adding one afterwards
      case "toggle": open = open === i ? null : i; break;
      case "tick": {
        const st = item.sets[j];
        // A tick with nothing typed means "did the planned reps".
        if (!st.done && st.reps == null) st.reps = Number(String(item.planned.reps).match(/\d+$/)?.[0]) || null;
        st.done = !st.done;
        if (st.done && j < item.sets.length - 1) startRest();
        break;
      }
      case "done": {
        item.status = "done";
        for (const st of item.sets) if (st.reps != null) st.done = true;
        const next = S.items.findIndex((x, k) => k > i && x.status === "todo");
        open = next < 0 ? null : next;
        if (next >= 0 && item.type === "strength") startRest();
        break;
      }
      case "skip": item.status = item.status === "skipped" ? "todo" : "skipped"; if (item.status === "skipped") open = null; break;
      case "addback": item.status = "todo"; item.lighter = false; break;
      case "rest-": if (rest) rest.left = Math.max(5, rest.left - 15); break;
      case "rest+": if (rest) rest.left += 15; break;
      case "addset": {
        const kgs = item.sets.map((x) => setKg(item, x)).filter((v) => v != null);
        item.sets.push({ kg: kgs.length ? kgs[kgs.length - 1] : item.kg, reps: null, done: false });
        break;
      }
      case "restskip": clearInterval(restTimer); rest = null; break;
      case "finish": clearInterval(restTimer); rest = null; finishing = true; break;
      case "unfinish": finishing = false; break;
      case "apain": S.after.pain = S.after.pain === v ? null : v; break;
      case "aenergy": S.after.energy = S.after.energy === v ? null : v; break;
      case "bpain": S.before.pain = S.before.pain === v ? null : v; edit.beforeChanged = true; break;
      case "benergy": S.before.energy = S.before.energy === v ? null : v; edit.beforeChanged = true; break;
      case "bfeel": edit.feeling = edit.feeling === v ? null : v; edit.beforeChanged = true; break;
      case "cpain-h24": setCheck("h24", "pain", v); break;
      case "cenergy-h24": setCheck("h24", "energy", v); break;
      case "cpain-h48": setCheck("h48", "pain", v); break;
      case "cenergy-h48": setCheck("h48", "energy", v); break;
      case "confirm": {
        const first = S.status !== "finished";
        // Ticked sets count even if "Mark done" was forgotten.
        if (S.items) for (const it of S.items) if (it.status === "todo" && it.sets.some((x) => x.done)) it.status = "done";
        if (first) {
          S.status = "finished";
          S.finishedAt = Date.now();
        }
        for (const it of S.items ?? []) {
          const kgs = (it.sets ?? []).filter((x) => x.done && x.kg != null).map((x) => x.kg);
          if (kgs.length) it.kg = Math.max(...kgs);
          if (it.setting) await db.setSetting(`setting:${it.exercise}`, it.setting);
          if (it.kg != null) await db.setSetting(`kg:${it.exercise}`, it.kg);
        }
        await save();
        // Keep that day's readiness record in step with corrected "before" scores (the colour she chose stays).
        if (!first && edit?.beforeChanged && S.before) {
          await updateDay(S.date, (d) => {
            if (!d.readiness) return;
            d.readiness.pain = S.before.pain;
            d.readiness.energy = S.before.energy;
            if (edit.feeling != null) d.readiness.feeling = edit.feeling; else delete d.readiness.feeling;
          });
        }
        if (!first) toast("Changes saved");
        else if (S.loggedLater) celebrate("Added", "Thanks for logging it. I'll check in on how you're feeling over the next couple of days.");
        else if (S.level === "amber" || S.level === "red") celebrate("Logged", "A lighter session is still a real session. Well listened to.");
        else celebrate(S.kind === "gym" ? "Session done" : S.kind === "swim" ? "Swim logged" : "Walk logged", "Lovely. Rest up, and let me know how you feel tomorrow.");
        return leave();
      }
      case "discard": {
        const msg = S.status === "finished" ? "Delete this entry? This can't be undone." : "Discard this session? That's completely fine; nothing is lost from your plan.";
        if (!confirm(msg)) return;
        await db.remove("sessions", S.id);
        toast(S.status === "finished" ? "Deleted" : "Discarded");
        return leave();
      }
      default: return;
    }
    await save();
    render();
  }

  function onInput(e) {
    const el = e.target.closest("[data-field]");
    if (!el || !S) return;
    const f = el.dataset.field, i = Number(el.dataset.i), j = Number(el.dataset.j);
    if (f === "snote") S.note = el.value;
    else if (f === "mins") { if (S.kind === "gym") S.durationMin = num(el.value); else S.minutes = num(el.value); }
    else if (f === "note") S.items[i].note = el.value;
    else if (f === "setting") S.items[i].setting = el.value;
    else if (f === "kg" && !Number.isNaN(j)) S.items[i].sets[j].kg = num(el.value);
    else if (f === "kg") S.items[i].kg = num(el.value);
    else if (f === "minutes") S.items[i].minutes = num(el.value);
    else S.items[i].sets[j][f] = num(el.value);
    save();
  }

  // Only handles events while a session is open (S is cleared on leave).
  $screen.addEventListener("click", (e) => { if (S) onClick(e); });
  $screen.addEventListener("input", (e) => { if (S) onInput(e); });
  return { start, active: () => !!S };
}
