// Gentle progression suggestions. The app only suggests; she decides. Based on recovery, never on the calendar.
//
// A "settled" session: a green (full) session, both 24 h and 48 h checks in, no crash.
// Gym (from 16 Nov 2026, the instructor's rule): stay at 4 × 8 and, after 3 settled sessions with every set done,
// suggest the smallest step up in weight on that exercise. One suggestion at a time, none during a flare or after
// a recent crash, and never swim time and gym resistance in the same period.
import * as db from "./db.js";
import { getPlan, parseDate, addDays, isoDate, isTimed } from "./plan.js";
import { sessionCrashed } from "./checks.js";

const PERIOD_DAYS = 14;  // "same period" for the swim-vs-resistance rule

const levelKey = (ex) => `level:${ex}`;

// Current level for an exercise: the plan's dose, and when she last stepped up the weight ("since").
// Older saved levels (reps and sets steps, before 16 Nov 2026) only keep their date: the dose is the plan's now.
export async function levelFor(item) {
  const saved = await db.getSetting(levelKey(item.exercise), null);
  return { sets: item.sets ?? 1, reps: topReps(item.reps), since: saved?.since ?? "", steps: saved?.steps ?? 0 };
}

// Kept for callers: the dose comes from the plan and the day's level (see sessionItems).
export async function withLevels(items) {
  return items;
}

export async function swimTarget() {
  return db.getSetting("swimTarget", { minutes: getPlan().activities.swim.minutes, since: "" });
}

function topReps(reps) {
  const m = String(reps ?? "").match(/(\d+)\D*$/);
  return m ? Number(m[1]) : null;
}

const settled = (s) => s.status === "finished" && s.level === "green" && s.checks?.h24 && s.checks?.h48
  && !s.checks.h24.skipped && !s.checks.h48.skipped && !sessionCrashed(s);

// Weighted exercises only (machines and cables); bodyweight ones stay as they are.
const nextStep = (lv, item) => (item.setting ? { ...lv, steps: lv.steps + 1, change: "resistance" } : null);

export function describe(s) {
  if (s.kind === "swim") return `Swim a little longer: about ${s.to.minutes} min instead of ${s.from.minutes} min.`;
  return `${getPlan().exercises[s.exercise].name}: the last reps have felt easy. Try the smallest step up in weight, still 4 × 8.`;
}

// The single suggestion to show today, or null.
export async function suggestion(todayIso, todayLevel) {
  if (todayLevel === "amber" || todayLevel === "red") return null;
  const sessions = (await db.all("sessions")).filter((s) => s.status === "finished");
  const weekAgo = isoDate(addDays(parseDate(todayIso), -7));
  if (sessions.some((s) => s.date > weekAgo && sessionCrashed(s))) return null;
  const periodAgo = isoDate(addDays(parseDate(todayIso), -PERIOD_DAYS));
  const lastResistance = await db.getSetting("lastResistanceUp", "");
  const swim = await swimTarget();
  const swimRecent = swim.since > periodAgo;
  const resistanceRecent = lastResistance > periodAgo;
  const snoozes = await db.getSetting("snoozes", {});

  // Gym exercises, in session order.
  for (const actId of ["gym_a", "gym_b"]) {
    for (const item of getPlan().activities[actId].items) {
      if (isTimed(item.exercise)) continue;
      const lv = await levelFor(item);
      const count = sessions.filter((s) => s.kind === "gym" && s.date > (lv.since || "") && settled(s)
        && s.items.some((it) => it.exercise === item.exercise && it.status === "done"
          && it.sets.length >= lv.sets && it.sets.every((st) => (st.reps ?? 0) >= lv.reps))).length;
      const need = getPlan().progression.settled_sessions + (snoozes[item.exercise] ?? 0);
      if (count < need) continue;
      const to = nextStep(lv, item);
      if (!to || (to.change === "resistance" && swimRecent)) continue;
      return { kind: "gym", exercise: item.exercise, from: lv, to, count };
    }
  }
  // Swim time.
  const [lo, hi] = String(swim.minutes).split(/\D+/).map(Number);
  const swims = sessions.filter((s) => s.kind === "swim" && s.date > (swim.since || "") && settled(s) && (s.minutes ?? 0) >= lo);
  const need = getPlan().progression.settled_sessions + (snoozes.swim ?? 0);
  if (swims.length >= need && !resistanceRecent) {
    const step = getPlan().progression.swim_step_minutes;
    const to = hi ? `${lo + step}–${hi + step}` : `${lo + step}`;
    return { kind: "swim", exercise: "swim", from: swim, to: { minutes: to }, count: swims.length };
  }
  return null;
}

export async function accept(s, todayIso) {
  if (s.kind === "swim") return db.setSetting("swimTarget", { minutes: s.to.minutes, since: todayIso });
  if (s.to.change === "resistance") await db.setSetting("lastResistanceUp", todayIso);
  const { change, ...lv } = s.to;
  await db.setSetting(levelKey(s.exercise), { ...lv, since: todayIso });
  const snoozes = await db.getSetting("snoozes", {});
  delete snoozes[s.exercise];
  await db.setSetting("snoozes", snoozes);
}

// "Not now": ask again after 3 more settled sessions.
export async function snooze(s) {
  const snoozes = await db.getSetting("snoozes", {});
  snoozes[s.exercise] = s.count;  // need = 3 + count, i.e. 3 more than now
  await db.setSetting("snoozes", snoozes);
}
