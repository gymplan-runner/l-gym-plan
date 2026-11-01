// Readiness (green / amber / red), the 24 h and 48 h recovery checks, and crash detection.
import * as db from "./db.js";
import { getPlan, parseDate, addDays, isoDate } from "./plan.js";

export const dayId = (iso) => `day-${iso}`;

export async function getDay(iso) {
  return (await db.get("days", dayId(iso))) ?? { id: dayId(iso), date: iso };
}

export async function updateDay(iso, fn) {
  const d = await getDay(iso);
  fn(d);
  await db.put("days", d);
  return d;
}

// Suggest a colour by comparing today's scores with her usual day. She always confirms.
export function suggestLevel(pain, energy, usual) {
  if (pain == null || energy == null || !usual) return null;
  const t = getPlan().readiness.thresholds;
  const up = pain - usual.pain, down = usual.energy - energy;
  if (up >= t.red.pain_above_usual || down >= t.red.energy_below_usual) return "red";
  if (up >= t.amber.pain_above_usual || down >= t.amber.energy_below_usual) return "amber";
  return "green";
}

// A check is a crash when it's clearly worse than before the session (pain up 2+, or energy down 2+).
export function isCrash(before, check) {
  if (!before || !check || check.skipped) return false;
  const c = getPlan().tracking.crash;
  return (check.pain != null && before.pain != null && check.pain - before.pain >= c.pain_up)
    || (check.energy != null && before.energy != null && before.energy - check.energy >= c.energy_down);
}

export const sessionCrashed = (s) => isCrash(s.before, s.checks?.h24) || isCrash(s.before, s.checks?.h48);

// Checks are offered for a couple of days, then quietly lapse. Nothing is ever "overdue".
// 24 h: the day after (and the day after that). 48 h: two days after (and the day after that).
const WINDOWS = { h24: [1, 2], h48: [2, 3] };

export function pendingChecks(sessions, todayIso) {
  const out = [];
  for (const s of sessions) {
    if (s.status !== "finished") continue;
    for (const [key, [from, to]] of Object.entries(WINDOWS)) {
      if (s.checks?.[key]) continue;
      const open = isoDate(addDays(parseDate(s.date), from)), close = isoDate(addDays(parseDate(s.date), to));
      if (todayIso >= open && todayIso <= close) out.push({ session: s, key });
    }
  }
  return out.sort((a, b) => (a.session.date < b.session.date ? -1 : 1));
}

// Crashes in the last 14 days (by session date), for the gentle safety banner.
export function recentCrashes(sessions, todayIso, days = 14) {
  const since = isoDate(addDays(parseDate(todayIso), -days));
  return sessions.filter((s) => s.status === "finished" && s.date > since && sessionCrashed(s));
}
