import * as db from "./db.js";
import {
  loadPlan, getPlan, position, weekDates, suggestedFor, dayNote, activity, sessionItems, doseText, picto,
  DAY_NAMES, SHORT, ICONS, colour, isoDate, parseDate, dayKeyOf, addDays,
} from "./plan.js";
import { renderPlan, openGuide } from "./planview.js";
import { renderProgress, progressAction } from "./progress.js";
import { renderHistory } from "./history.js";
import { esc, fmt, today, toast, celebrate } from "./ui.js";
import { unlockAudio } from "./beep.js";
import { getDay, updateDay, suggestLevel, pendingChecks, recentCrashes, isCrash, baselineOf } from "./checks.js";
import { createSessionView, newSession, scoreChips } from "./session.js";
import { suggestion, describe, accept, snooze, swimTarget, withLevels } from "./progression.js";
import { createSettingsView, needsBackupReminder, backupNow, readBackup, BACKUP_HOW } from "./settings.js";

const $screen = document.getElementById("screen");
const $tabs = document.getElementById("tabs");
const state = { tab: "today", name: "", start: null, usual: null, flow: null, drafts: {}, sug: null };
const sessionView = createSessionView({ $screen, $tabs, onExit: () => show(state.tab) });
const settingsView = createSettingsView({ $screen, $tabs });
const viewActive = () => sessionView.active() || settingsView.active();
const ACTS = ["gym_a", "gym_b", "swim"];
const LEVELS = ["green", "amber", "red"];

const todayIso = () => isoDate(today());
const weekOf = (iso) => {
  const pos = position(parseDate(iso), state.start);
  return pos.status === "before" ? 0 : pos.week;
};

// ------------------------------------------------------------------ first run
function renderWelcome() {
  $tabs.hidden = true;
  const t = getPlan().tracking;
  const u = state.usual ?? {};
  $screen.innerHTML = `
    <h1>Welcome 👋</h1>
    <p class="muted">A gentle, flexible plan for the gym and the pool. Everything you log stays on this phone.</p>
    <form id="welcome" class="card">
      <label for="name">What should the app call you?</label>
      <input id="name" type="text" autocomplete="given-name" maxlength="30" placeholder="Your first name" required>
      <label for="start">Your 12 weeks start on</label>
      <input id="start" type="date" value="${todayIso()}" required>
      <p class="muted small" style="margin-top:6px">Any day is fine. You can change this later.</p>
      <p class="q">On an ordinary day, your pain is usually about…</p>${scoreChips("upain", t.pain, u.pain, "data-go=upain")}
      <p class="q">…and your energy is usually about</p>${scoreChips("uenergy", t.energy, u.energy, "data-go=uenergy")}
      <p class="muted small">This helps the app suggest green, amber or red each day. You always have the final say.</p>
      <button class="btn" type="submit">Let's begin</button>
    </form>
    <div class="card"><b>New phone, or reinstalled?</b>
      <p class="muted small">Restore your logs from a backup file you saved earlier.</p>
      <label class="btn ghost filebtn">Restore from a backup file<input type="file" accept="application/json,.json" id="w-restore" hidden></label></div>
    <p class="muted small">${esc(getPlan().meta.disclaimer)}</p>`;
  document.getElementById("w-restore").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = await readBackup(f);
      if (!confirm(`Restore this backup (${data.sessions?.length ?? 0} logged sessions)?`)) return;
      await db.importAll(data);
      toast("Backup restored");
      init();
    } catch (err) {
      toast(err.message, "bad");
    }
  });
  document.getElementById("welcome").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (state.usual?.pain == null || state.usual?.energy == null) { toast("Please pick your usual pain and energy"); return; }
    state.name = document.getElementById("name").value.trim();
    state.start = document.getElementById("start").value;
    await db.setSetting("name", state.name);
    await db.setSetting("startDate", state.start);
    await db.setSetting("usual", state.usual);
    $tabs.hidden = false;
    show("today");
  });
}

function welcomeChip(b) {
  state.usual = { ...state.usual, [b.dataset.go === "upain" ? "pain" : "energy"]: Number(b.dataset.v) };
  for (const c of b.parentElement.children) {
    c.classList.toggle("on", c === b);
    c.setAttribute("aria-pressed", String(c === b));
  }
}

// ------------------------------------------------------------------ today
function ring(week, weeks) {
  const r = 26, c = 2 * Math.PI * r, frac = Math.min(week, weeks) / weeks;
  return `<svg class="ring" viewBox="0 0 64 64"><circle class="bg" cx="32" cy="32" r="${r}"/>
    <circle class="fg" cx="32" cy="32" r="${r}" stroke-dasharray="${(c * frac).toFixed(1)} ${c.toFixed(1)}"/>
    <text x="32" y="32">${Math.min(week, weeks)}/${weeks}</text></svg>`;
}

function dayStrip(now, doneDates) {
  const iso = isoDate(now);
  return `<div class="daystrip">${weekDates(now).map(({ key, date }) => {
    const acts = suggestedFor(key).filter((a) => a !== "recovery");
    const d = isoDate(date);
    const name = `<b>${key[0].toUpperCase() + key.slice(1)}</b>`, tick = doneDates.has(d) ? "<i>✓</i>" : "";
    const cls = `${acts.length ? "act" : ""} ${acts.length > 1 ? "split" : ""} ${d === iso ? "today" : ""}`;
    // A day with two sessions (Saturday: Gym B, then swim) is stacked in two colours.
    if (acts.length > 1) {
      return `<div class="${cls}">${acts.map((a, i) => `<span style="background:${colour(a)}">${i ? "" : name}${SHORT[a]}${i === acts.length - 1 ? tick : ""}</span>`).join("")}</div>`;
    }
    const style = acts.length ? `style="background:${colour(acts[0])}"` : "";
    return `<div class="${cls}" ${style}>${name}${acts.length ? SHORT[acts[0]] : SHORT.recovery}${tick}</div>`;
  }).join("")}</div>`;
}

function itemRow(it, actId) {
  const ex = getPlan().exercises[it.exercise];
  const opt = it.optional ? `<span class="tag">optional</span>` : "";
  return `<button type="button" class="item linkrow" data-go="guide" data-ex="${it.exercise}" data-act="${actId}">
    <span class="pic-wrap">${picto(it.exercise, actId)}</span>
    <span class="txt"><span class="name">${esc(ex.name)}${opt}</span>
    <span class="dose">${esc(doseText(it))}</span><span class="note">${esc(it.note ?? "")}</span></span></button>`;
}

async function planCard(actId, level = "green") {
  const a = activity(actId);
  const swim = actId === "swim" ? (level === "amber" ? a.amber_minutes : (await swimTarget()).minutes) : null;
  const sub = [a.focus, a.max_minutes ? `up to ${a.max_minutes} min` : "", swim ? `${swim} min` : ""].filter(Boolean).join(" · ");
  const head = `<div class="session-head" style="background:${colour(actId)}"><h2>${ICONS[actId]} ${esc(a.name)}</h2><p>${esc(sub)}</p></div>`;
  if (a.kind === "gym") {
    const items = await withLevels(sessionItems(actId, level), level);
    const left = level === "amber" ? sessionItems(actId).filter((it) => !it.amber) : [];
    const leftNote = left.length
      ? `<p class="muted small" style="margin:8px 0">Left out today: ${left.map((it) => esc(getPlan().exercises[it.exercise].name)).join(", ")}. You can add any back during the session.</p>` : "";
    return `${head}<div class="session-body">${items.map((it) => itemRow(it, actId)).join("")}${leftNote}</div>`;
  }
  const ex = a.exercise ? getPlan().exercises[a.exercise] : null;
  const body = ex
    ? `<div class="guide-pic small-pic">${picto(a.exercise, actId)}</div><p>${esc(ex.what)}</p><ul>${ex.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`
    : `<p>${esc(getPlan().meta.principles.at(-1))}. Rest, or some gentle movement if you'd like it.</p>`;
  return `${head}<div class="session-body" style="padding:12px 16px">${body}</div>`;
}

const dayName = (iso) => (iso === todayIso() ? "today" : DAY_NAMES[dayKeyOf(parseDate(iso))]);

function checkCard({ session: s, key }) {
  const t = getPlan().tracking;
  const id = `${s.id}|${key}`;
  const d = state.drafts[id] ?? {};
  const label = key === "h24" ? "1 day later" : "2 days later";
  const what = { gym_a: "Gym A session", gym_b: "Gym B session", swim: "swim", walk: "walk" }[s.act];
  return `<div class="card checkcard"><b>How are you feeling after ${esc(dayName(s.date))}'s ${what}?</b>
    <p class="muted small">${label} check. Delayed effects matter most, so this helps you learn your limits.</p>
    <p class="q">Pain</p>${scoreChips("ck-pain", t.pain, d.pain, `data-go="ck-pain" data-ck="${id}"`)}
    <p class="q">Energy</p>${scoreChips("ck-energy", t.energy, d.energy, `data-go="ck-energy" data-ck="${id}"`)}
    <input class="in wide" data-cknote="${id}" value="${esc(d.note ?? "")}" placeholder="Anything you noticed? (optional)">
    <div class="row2"><button type="button" class="btn ghost" data-go="ck-skip" data-ck="${id}">Skip</button>
    <button type="button" class="btn" data-go="ck-save" data-ck="${id}">Save</button></div></div>`;
}

async function renderToday() {
  const now = today();
  const iso = isoDate(now);
  const plan = getPlan();
  const pos = position(now, state.start);
  const sessions = await db.all("sessions");
  const day = await getDay(iso);
  const finished = sessions.filter((s) => s.status === "finished");
  const doneToday = finished.filter((s) => s.date === iso);
  const inProgress = sessions.find((s) => s.status === "in_progress");
  const checks = pendingChecks(sessions, iso);
  const crashes = recentCrashes(sessions, iso);
  const crashKey = crashes.map((s) => s.id).sort().join(",");
  const showCrash = crashes.length >= 2 && (await db.getSetting("crashDismissed", "")) !== crashKey;
  const backup = await needsBackupReminder(now);
  state.sug = await suggestion(iso, day.readiness?.level);
  const sub = pos.status === "before"
    ? `Your 12 weeks start in ${pos.daysToStart} day${pos.daysToStart === 1 ? "" : "s"}`
    : pos.status === "after" ? "12 weeks done: time for your review" : `Week ${pos.week} of ${plan.meta.weeks}`;
  const readiness = day.readiness
    ? `<span class="pill ${day.readiness.level}">${plan.readiness.levels[day.readiness.level].label} today</span>` : "";
  $screen.innerHTML = `
    <div class="topline"><span class="muted small">${readiness}</span><button type="button" class="gear" data-go="settings" aria-label="Settings">⚙️</button></div>
    <div class="card hero">${ring(pos.status === "before" ? 0 : pos.week, plan.meta.weeks)}
      <div><h1>Hi ${esc(state.name)}</h1><div class="muted">${esc(fmt(now, { weekday: "long", day: "numeric", month: "long" }))} · ${sub}</div></div></div>
    ${state.checkResult ? `<div class="card ${state.checkResult.crash ? "softwarn" : "softok"}">${state.checkResult.text}</div>` : ""}
    ${showCrash ? `<div class="card softwarn"><b>Recovery has been tough lately</b>
      <p class="small">${crashes.length} sessions in the last two weeks were followed by a noticeable dip. It's okay to ease off: try lighter versions or more rest days for a while.</p>
      <p class="small">${esc(plan.safety.crashes)}</p>
      <button type="button" class="linkbtn" data-go="crash-ok" data-key="${crashKey}">Thanks, got it</button></div>` : ""}
    ${backup ? `<div class="card backup"><b>Time for a backup</b><p class="small muted">${esc(backup)} It keeps your logs safe if anything happens to this phone.</p>
      <button type="button" class="btn" data-go="backup">Back up now</button>${BACKUP_HOW}</div>` : ""}
    ${checks.map(checkCard).join("")}
    ${inProgress ? `<div class="card start-card"><b>You have a ${esc(SHORT[inProgress.act].toLowerCase())} session open</b>
      <button type="button" class="btn" data-go="open" data-id="${inProgress.id}">Carry on</button></div>` : ""}
    ${state.sug ? `<div class="card sug"><b>💡 Ready for a small step?</b><p>${esc(describe(state.sug))}</p>
      <p class="muted small">You've had ${state.sug.count} settled sessions with good recovery. Only if it feels right. Change one thing at a time.</p>
      <div class="row2"><button type="button" class="btn ghost" data-go="sug-no">Not now</button>
      <button type="button" class="btn" data-go="sug-yes">Yes, try it</button></div></div>` : ""}
    <button type="button" class="btn big" data-go="choose">▶ Do a workout</button>
    <button type="button" class="btn ghost" data-go="past">✏️ Log one I've already done</button>
    ${day.rest
      ? `<div class="done-banner">🛋️ Resting today. ${esc(plan.meta.principles.at(-1))}. <button type="button" class="linkbtn" data-go="rest-undo">Undo</button></div>`
      : `<button type="button" class="btn ghost" data-go="rest">🛋️ I'll rest today</button>`}
    ${doneToday.map((s) => `<button type="button" class="hist" data-go="open" data-id="${s.id}"><span class="hicon">${ICONS[s.act]}</span>
      <span class="htxt"><b>${esc(s.title)} ✓</b><span class="muted small">${s.level === "amber" ? "Lighter version · " : ""}tap to view or edit</span></span><span class="chev">›</span></button>`).join("")}
    <h2>This week</h2>
    ${dayStrip(now, new Set(finished.map((s) => s.date)))}
    <p class="muted small" style="margin-top:8px">A gentle guide, not a quota. Any session can be done on any day, and rest is always a good choice.</p>
    <h2>Suggested for ${DAY_NAMES[pos.dayKey]}</h2>
    ${dayNote(pos.dayKey) ? `<p class="muted small">${esc(dayNote(pos.dayKey))}</p>` : ""}
    ${(await Promise.all(suggestedFor(pos.dayKey).map((a) => planCard(a)))).join("")}
    <h2>Eating habits <span class="muted small">(optional)</span></h2>
    <div class="card"><p class="muted small">${esc(plan.nutrition.note)}</p>
      ${plan.nutrition.habits.map((h) => {
        const on = !!day.nutrition?.[h.id];
        return `<button type="button" class="habit ${on ? "on" : ""}" data-go="nut" data-h="${h.id}" aria-pressed="${on}"><span>${on ? "✓" : ""}</span>${esc(h.label)}</button>`;
      }).join("")}</div>`;
  state.checkResult = null;
}

// ------------------------------------------------------------------ do a workout: which → how are you → plan → start
async function renderFlow() {
  const f = state.flow;
  const plan = getPlan();
  $tabs.hidden = true;
  if (f.step === "choose") {
    const iso = todayIso();
    const done = new Set((await db.all("sessions")).filter((s) => s.status === "finished" && s.date === iso).map((s) => s.act));
    const sug = suggestedFor(dayKeyOf(today()));
    $screen.innerHTML = `
      <div class="wk-top" style="background:var(--deep)"><button type="button" class="back" data-go="flow-exit">‹ Today</button>
        <h1>Which session?</h1><p>Any one, any day. Pick whatever suits you today.</p></div>
      ${ACTS.map((act) => {
        const a = activity(act);
        return `<button type="button" class="choice" data-go="pick" data-act="${act}">
          <span class="choice-head" style="background:${colour(act)}"><b>${ICONS[act]} ${esc(a.name)}</b>
            <span>${esc(a.focus)}</span>${sug.includes(act) ? '<span class="badge sug">Suggested today</span>' : ""}
            ${done.has(act) ? '<span class="badge sug">✓ Done today</span>' : ""}</span></button>`;
      }).join("")}
      <button type="button" class="btn ghost" data-go="rest">🛋️ Rest today instead</button>
      <button type="button" class="btn ghost" data-go="past">✏️ Already done it? Log it here</button>`;
    return;
  }
  if (f.step === "past") return renderPast(f);
  const a = activity(f.act);
  const top = (title, sub) => `<div class="wk-top" style="background:${colour(f.act)}"><button type="button" class="back" data-go="flow-back">‹ Back</button>
    <h1>${title}</h1><p>${sub}</p></div>`;
  if (f.step === "ready") {
    const t = plan.tracking;
    const sug = suggestLevel(f.pain, f.energy, state.usual);
    $screen.innerHTML = `${top("How are you right now?", `${ICONS[f.act]} ${esc(a.name)}`)}
      <div class="card">
        <p class="q">Pain right now</p>${scoreChips("r-pain", t.pain, f.pain, 'data-go="r-pain"')}
        <p class="q">Energy right now</p>${scoreChips("r-energy", t.energy, f.energy, 'data-go="r-energy"')}
        ${state.usual ? `<p class="muted small">Your usual day: pain ${state.usual.pain}, energy ${state.usual.energy}.</p>` : ""}
      </div>
      ${sug ? `<div class="light ${sug}"><b>Suggested: ${plan.readiness.levels[sug].label}</b>. ${esc(plan.readiness.levels[sug].meaning)}.
        <br><span class="small">${esc(plan.readiness.levels[sug].action)}</span></div>
        <p class="q">How does today feel to you?</p>
        <div class="levels">${LEVELS.map((l) => `<button type="button" class="lvl ${l} ${l === sug ? "sugd" : ""}" data-go="r-level" data-v="${l}">
          ${plan.readiness.levels[l].label}${l === sug ? "<small>suggested</small>" : ""}</button>`).join("")}</div>
        <p class="muted small">${esc(plan.readiness.override)}</p>`
        : `<p class="muted small">Pick both and I'll suggest green, amber or red. You have the final say.</p>`}`;
    return;
  }
  // preview
  const lv = plan.readiness.levels[f.level];
  if (f.level === "red") {
    $screen.innerHTML = `${top("Rest is the right call today", `${lv.label}: ${esc(lv.meaning)}`)}
      <div class="card softwarn"><p><b>${esc(lv.action)}</b></p>
        <p class="small">Resting during a flare is part of the plan, not a step back. There's nothing to make up later.</p></div>
      <button type="button" class="btn" data-go="rest">🛋️ Rest today</button>
      <button type="button" class="linkbtn" data-go="flow-back" style="display:block;margin:8px auto">Change my answer</button>`;
    return;
  }
  $screen.innerHTML = `${top(f.level === "amber" ? "A lighter session today" : "Today's session", `${lv.label}: ${esc(lv.action)}`)}
    ${f.level === "amber" ? `<div class="light amber small">About half: fewer exercises, 1 set, shorter warm-up. Resting instead is just as good a choice.</div>` : ""}
    ${await planCard(f.act, f.level)}
    <button type="button" class="btn big" data-go="start">▶ Start${f.level === "amber" ? " lighter session" : ""}</button>
    <button type="button" class="btn ghost" data-go="rest">🛋️ Rest instead</button>`;
}

// "Log one I've already done": for a session she did without starting it in the app (today or an earlier day).
// No "before" check: her usual day stands in for it when the 24 h and 48 h checks look for a dip.
function renderPast(f) {
  const pick = (go, val, on, label) => `<button type="button" class="chip ${on ? "on" : ""}" data-go="${go}" data-v="${val}" aria-pressed="${on}">${label}</button>`;
  $screen.innerHTML = `
    <div class="wk-top" style="background:var(--deep)"><button type="button" class="back" data-go="flow-exit">‹ Today</button>
      <h1>Log one you've done</h1><p>Didn't start it in the app? No problem. Add it here.</p></div>
    <div class="card">
      <p class="q">Which session?</p>
      ${ACTS.map((act) => `<button type="button" class="choice pickable ${f.act === act ? "on" : ""}" data-go="p-act" data-act="${act}" aria-pressed="${f.act === act}">
        <span class="choice-head" style="background:${colour(act)}"><b>${ICONS[act]} ${esc(activity(act).name)}${f.act === act ? " ✓" : ""}</b></span></button>`).join("")}
      <p class="q">When?</p>
      <div class="chips pick">${pick("p-when", "today", f.when === "today", "Today")}${pick("p-when", "yesterday", f.when === "yesterday", "Yesterday")}${pick("p-when", "earlier", f.when === "earlier", "Earlier")}</div>
      ${f.when === "earlier" ? `<input id="p-date" class="in wide" type="date" value="${f.date}" max="${todayIso()}" aria-label="Which day" style="margin-top:8px">` : ""}
      <p class="q">Full session or a lighter one?</p>
      <div class="chips pick">${pick("p-level", "green", f.level === "green", "Full")}${pick("p-level", "amber", f.level === "amber", "Lighter version")}</div>
    </div>
    <button type="button" class="btn big" data-go="p-next">Next: add the details ›</button>`;
}

// ------------------------------------------------------------------ routing
const screens = {
  today: renderToday,
  plan: () => renderPlan($screen, true),
  progress: () => renderProgress($screen, state.start),
  history: () => renderHistory($screen),
};

// The one-page picture guide, full screen with zoom.
function openPoster() {
  const el = document.createElement("div");
  el.className = "viewer";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Picture guide");
  el.innerHTML = `<div class="viewer-bar"><b>Picture guide</b><span><button type="button" data-zoom>Zoom</button>
    <button type="button" data-close>Close</button></span></div>
    <div class="viewer-body"><img src="img/guide.jpg" alt="One-page picture guide to the plan"></div>`;
  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) el.remove();
    if (e.target.closest("[data-zoom]")) el.classList.toggle("zoomed");
  });
  document.body.append(el);
}

async function show(tab) {
  state.tab = tab;
  state.flow = null;
  $tabs.hidden = false;
  for (const b of $tabs.querySelectorAll("button")) {
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  await screens[tab]();
  window.scrollTo(0, 0);
}

$tabs.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (b) show(b.dataset.tab);
});

async function takeRest() {
  const iso = todayIso();
  await updateDay(iso, (d) => { d.rest = true; });
  celebrate("Rest day", "Rest is a valid activity. Looking after yourself is part of the plan.");
  return show("today");
}

async function saveCheck(b, skipped) {
  const [id, key] = b.dataset.ck.split("|");
  const s = await db.get("sessions", id);
  if (!s) return show("today");
  const d = state.drafts[b.dataset.ck] ?? {};
  if (!skipped && (d.pain == null || d.energy == null)) { toast("Pick pain and energy, or tap Skip"); return; }
  s.checks = { ...s.checks, [key]: skipped ? { skipped: true, at: todayIso() } : { pain: d.pain, energy: d.energy, note: d.note ?? "", at: todayIso() } };
  await db.put("sessions", s);
  delete state.drafts[b.dataset.ck];
  if (!skipped) {
    state.checkResult = isCrash(baselineOf(s), s.checks[key])
      ? { crash: true, text: `<b>Thanks for checking in.</b><p class="small">That's a noticeable dip compared with before the session. Go gently today. A lighter version or a rest day is a good choice next time.</p>` }
      : { crash: false, text: `<b>Thanks for checking in.</b> <span class="small">That looks like a good recovery.</span>` };
  }
  return show("today");
}

$screen.addEventListener("input", (e) => {
  if (e.target.id === "p-date" && state.flow?.step === "past") state.flow.date = e.target.value;
  const el = e.target.closest("[data-cknote]");
  if (el) state.drafts[el.dataset.cknote] = { ...state.drafts[el.dataset.cknote], note: el.value };
});

$screen.addEventListener("click", async (e) => {
  if (viewActive()) return;
  const b = e.target.closest("[data-go]");
  if (!b) return;
  unlockAudio();
  const go = b.dataset.go;
  const f = state.flow;
  const v = b.dataset.v;
  if (go === "upain" || go === "uenergy") return welcomeChip(b);
  if (go === "guide") return openGuide(b.dataset.ex, b.dataset.act);
  if (go === "poster") return openPoster();
  if (go.startsWith("body-")) {
    if (await progressAction(go, b, state.start)) {
      const y = window.scrollY;
      await renderProgress($screen, state.start);
      window.scrollTo(0, y);
    }
    return;
  }
  if (go === "settings") {
    return settingsView.start(async (changed) => {
      if (changed) {
        state.name = await db.getSetting("name", "");
        state.start = await db.getSetting("startDate", null);
        state.usual = await db.getSetting("usual", null);
        if (!state.start) return renderWelcome();
      }
      show("today");
    });
  }
  if (go === "backup") { await backupNow(); return show("today"); }
  if (go === "crash-ok") { await db.setSetting("crashDismissed", b.dataset.key); return show("today"); }
  if (go === "rest") return takeRest();
  if (go === "rest-undo") { await updateDay(todayIso(), (d) => { d.rest = false; }); return show("today"); }
  if (go === "nut") {
    await updateDay(todayIso(), (d) => { d.nutrition = { ...d.nutrition, [b.dataset.h]: !d.nutrition?.[b.dataset.h] }; });
    return show("today");
  }
  if (go === "ck-pain" || go === "ck-energy") {
    const k = go === "ck-pain" ? "pain" : "energy";
    const d = state.drafts[b.dataset.ck] ?? {};
    state.drafts[b.dataset.ck] = { ...d, [k]: d[k] === Number(v) ? null : Number(v) };
    const y = window.scrollY;
    await renderToday();
    return window.scrollTo(0, y);
  }
  if (go === "ck-save" || go === "ck-skip") return saveCheck(b, go === "ck-skip");
  if (go === "sug-yes") {
    await accept(state.sug, todayIso());
    toast("Updated. You'll see it next time.");
    return show("today");
  }
  if (go === "sug-no") { await snooze(state.sug); toast("No problem. I'll ask again later."); return show("today"); }
  if (go === "open") {
    const s = await db.get("sessions", b.dataset.id);
    if (s) return sessionView.start(s);
  }
  // the "Do a workout" flow
  if (go === "choose") { state.flow = { step: "choose" }; return renderFlow(); }
  if (go === "past") { state.flow = { step: "past", act: null, when: "today", date: todayIso(), level: "green" }; return renderFlow(); }
  if (go === "p-act") { f.act = b.dataset.act; return renderFlow(); }
  if (go === "p-level") { f.level = v; return renderFlow(); }
  if (go === "p-when") {
    f.when = v;
    f.date = isoDate(addDays(today(), { today: 0, yesterday: -1, earlier: -2 }[v]));
    return renderFlow();
  }
  if (go === "p-next") {
    if (!f.act) { toast("Pick which session you did"); return; }
    if (!f.date || f.date > todayIso()) { toast("Pick a day up to today"); return; }
    const s = await newSession({ act: f.act, date: f.date, week: weekOf(f.date), level: f.level, before: null,
      loggedLater: true, baseline: state.usual ? { pain: state.usual.pain, energy: state.usual.energy } : null });
    state.flow = null;
    return sessionView.start(s, { finish: s.kind !== "gym" });
  }
  if (go === "flow-exit") return show("today");
  if (go === "flow-back") {
    state.flow.step = f.step === "preview" ? "ready" : "choose";
    return renderFlow();
  }
  if (go === "pick") {
    const r = (await getDay(todayIso())).readiness;
    state.flow = { step: "ready", act: b.dataset.act, pain: r?.pain ?? null, energy: r?.energy ?? null };
    return renderFlow();
  }
  if (go === "r-pain") { f.pain = Number(v); return renderFlow(); }
  if (go === "r-energy") { f.energy = Number(v); return renderFlow(); }
  if (go === "r-level") {
    f.level = v;
    f.step = "preview";
    const suggested = suggestLevel(f.pain, f.energy, state.usual);
    await updateDay(todayIso(), (d) => { d.readiness = { pain: f.pain, energy: f.energy, suggested, level: v, at: Date.now() }; });
    return renderFlow();
  }
  if (go === "start") {
    const iso = todayIso();
    const s = await newSession({ act: f.act, date: iso, week: weekOf(iso), level: f.level, before: { pain: f.pain, energy: f.energy } });
    state.flow = null;
    return sessionView.start(s);
  }
});

async function init() {
  // Ask the browser to keep this app's data even when the phone is low on space.
  navigator.storage?.persist?.().catch(() => {});
  await loadPlan();
  state.name = await db.getSetting("name", "");
  state.start = await db.getSetting("startDate", null);
  state.usual = await db.getSetting("usual", null);
  if (!state.start) return renderWelcome();
  show("today");
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  // If another app on this web address cleared our offline copy, ask the service worker to rebuild it.
  navigator.serviceWorker.ready.then(async (reg) => {
    const keys = await caches.keys();
    if (!keys.some((k) => k.startsWith("lgym-"))) reg.active?.postMessage("recache");
  }).catch(() => {});
}
init().catch((err) => {
  $screen.innerHTML = `<div class="card"><h1>Something went wrong</h1><p>${esc(err.message)}</p></div>`;
});
