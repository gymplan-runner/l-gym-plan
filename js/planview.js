// Plan tab: the weekly rhythm, Sessions A and B, swim and walk, how readiness and progression work,
// safety, eating habits and the 12-week review. Tapping any exercise opens its guide with a picture.
import { getPlan, activity, sessionItems, doseText, picto, DAY_KEYS, DAY_NAMES, ICONS, colour } from "./plan.js";
import { esc } from "./ui.js";
import { withLevels, swimTarget } from "./progression.js";

const list = (xs) => `<ul class="small">${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;

function row(it, actId) {
  const ex = getPlan().exercises[it.exercise];
  return `<button type="button" class="item linkrow" data-go="guide" data-ex="${it.exercise}" data-act="${actId}">
    <span class="pic-wrap">${picto(it.exercise, actId)}</span>
    <span class="txt"><span class="name">${esc(ex.name)}${it.optional ? ' <span class="tag">optional</span>' : ""}</span>
    <span class="dose">${esc(doseText(it))}</span>${it.note ? `<span class="note">${esc(it.note)}</span>` : ""}</span>
    <span class="chev" aria-hidden="true">›</span></button>`;
}

async function sessionBlock(actId) {
  const a = activity(actId);
  const items = await withLevels(sessionItems(actId), "green");
  return `<div class="session-head" style="background:${colour(actId)}"><h2>${ICONS[actId]} ${esc(a.name)}</h2>
      <p>${esc(a.focus)} · up to ${a.max_minutes} min · ${esc(a.intensity.toLowerCase())}</p></div>
    <div class="session-body">${items.map((it) => row(it, actId)).join("")}</div>`;
}

export async function renderPlan($screen, hasGuide) {
  const plan = getPlan();
  const swim = await swimTarget();
  const days = DAY_KEYS.map((k) => {
    const actId = plan.schedule.days[k].activity, a = activity(actId);
    const target = actId === "swim" ? `${swim.minutes} min` : a.max_minutes ? `up to ${a.max_minutes} min` : a.focus;
    return `<div class="dayrow"><span class="dot" style="background:${actId === "recovery" ? "var(--line)" : colour(actId)}"></span>
      <b>${DAY_NAMES[k]}</b><span>${ICONS[actId]} ${esc(a.name)}</span><span class="muted small">${esc(target)}</span></div>`;
  }).join("");
  const lv = plan.readiness.levels;
  $screen.innerHTML = `<h1>Plan</h1>
    ${hasGuide ? `<button type="button" class="btn ghost" data-go="poster">🖼️ One-page picture guide</button>` : ""}
    <h2>Your week</h2>
    <div class="card">${days}<p class="muted small" style="margin-top:10px">${plan.schedule.rules.map(esc).join(" ")}</p></div>
    <p class="muted small">Tap any exercise for how to do it.</p>
    ${await sessionBlock("gym_a")}
    ${await sessionBlock("gym_b")}
    <div class="session-head" style="background:${colour("swim")}"><h2>${ICONS.swim} Swimming</h2><p>Up to ${plan.schedule.targets.swims_per_week} a week · ${esc(swim.minutes)} min</p></div>
    <div class="session-body">${row({ exercise: "swim", minutes: swim.minutes }, "swim")}</div>
    <div class="session-head" style="background:${colour("walk")}"><h2>${ICONS.walk} Woodland walk</h2><p>Gentle and optional</p></div>
    <div class="session-body">${row({ exercise: "walk" }, "walk")}</div>
    <h2>Green, amber or red</h2>
    <div class="card small">
      ${["green", "amber", "red"].map((k) => `<div class="light ${k}"><b>${lv[k].label}</b>: ${esc(lv[k].meaning)}.<br>${esc(lv[k].action)}</div>`).join("")}
      <p>${esc(plan.readiness.override)}</p></div>
    <h2>Moving forward, gently</h2>
    <div class="card small"><p>Progress is based on how you recover, not on the calendar. The order is:</p>
      <ol>${plan.progression.sequence.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      ${list(plan.progression.rules)}
      <p class="muted">After ${plan.progression.settled_sessions} sessions with good recovery at the same level, the app may suggest one small step. You decide.</p></div>
    <h2>Staying safe</h2>
    <div class="card small"><p><b>Stop if you notice:</b> ${plan.safety.stop_if.map((x) => esc(x.toLowerCase())).join(", ")}.</p>
      <p><b>Avoid for now:</b> ${plan.safety.avoid.map((x) => esc(x.toLowerCase())).join(", ")}.</p>
      ${list(plan.safety.general)}<p>${esc(plan.safety.crashes)}</p></div>
    <h2>Eating habits</h2>
    <div class="card small"><p>${esc(plan.nutrition.note)}</p>${list(plan.nutrition.habits.map((h) => h.label))}</div>
    <h2>Every ${plan.review.every_weeks} weeks</h2>
    <div class="card small"><p>Look back and choose to:</p>${list(plan.review.options)}<p>${esc(plan.review.success)}</p></div>
    <p class="muted small">${esc(plan.meta.disclaimer)}</p>`;
}

export function openGuide(key, actId = "gym_a") {
  const ex = getPlan().exercises[key];
  if (!ex) return;
  const el = document.createElement("div");
  el.className = "sheet";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", ex.name);
  const care = [...(ex.contraindications ?? []), ...(ex.safety ?? [])];
  el.innerHTML = `<div class="sheet-card"><div class="sheet-top"><h2>${esc(ex.name)}</h2><button type="button" class="back dark" data-close>Close</button></div>
    <div class="guide-pic">${picto(key, actId, "pic")}</div>
    <p class="muted small">Faint figure = start, solid = finish.</p>
    <p><b>You need:</b> ${esc(ex.equipment.join(" or "))}</p><p>${esc(ex.what)}</p>
    <ol>${ex.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    ${ex.tips.map((t) => `<p class="tip">✓ ${esc(t)}</p>`).join("")}
    ${ex.modifications?.length ? `<p><b>Easier options</b></p>${list(ex.modifications)}` : ""}
    ${care.length ? `<p><b>Take care</b></p>${list(care)}` : ""}
    <p class="muted small">Machines vary between gyms. Ask an instructor to show you and set it up for you.</p></div>`;
  el.addEventListener("click", (e) => { if (e.target === el || e.target.closest("[data-close]")) el.remove(); });
  document.body.append(el);
}
