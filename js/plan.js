// Loads the plan file and works out what's suggested on any given date.
// The weekly schedule is a gentle target: any session can be done on any day, and nothing is ever "owed".
export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const DAY_NAMES = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
export const SHORT = { gym_a: "Gym A", gym_b: "Gym B", swim: "Swim", walk: "Walk", recovery: "Rest" };
export const ICONS = { gym_a: "🏋️", gym_b: "🏋️", swim: "🏊", walk: "🌳", recovery: "🛋️" };
export const colour = (actId) => `var(--${actId})`;

let plan, pictos;

// Typographic dashes for display (" - " and ranges like "5-7"), leaving date fields untouched.
function prettify(v, key = "") {
  if (typeof v === "string") {
    return /date$/.test(key) || /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : v.replaceAll(" - ", " – ").replace(/(\d)-(\d)/g, "$1–$2");
  }
  if (Array.isArray(v)) return v.map((x) => prettify(x, key));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, prettify(x, k)]));
  return v;
}

export async function loadPlan() {
  if (!plan) {
    [plan, pictos] = await Promise.all([
      fetch("data/plan.json").then((r) => r.json()).then(prettify),
      fetch("data/pictos.json").then((r) => r.json()),
    ]);
  }
  return plan;
}

export const getPlan = () => plan;

// Real hex colours for the pictogram arrows (CSS variables don't reach inside the SVG markup).
const ACCENTS = { gym_a: "#13798a", gym_b: "#5a5fb0", swim: "#2a7fbf", walk: "#8a6a45", recovery: "#8c9a9c" };

export function picto(key, actId = "gym_a", cls = "pic") {
  const inner = pictos?.[key];
  if (!inner) return "";
  return `<svg class="${cls}" viewBox="0 0 120 100" aria-hidden="true">${inner.replaceAll("__ACCENT__", ACCENTS[actId] ?? ACCENTS.gym_a)}</svg>`;
}

export function parseDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isoDate(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export const dayKeyOf = (date) => DAY_KEYS[(date.getDay() + 6) % 7];

// Where a date falls in the 12 weeks. Week 1 starts on whatever day she chose.
// Uses whole local days so clock changes don't shift weeks.
export function position(date, startIso) {
  const start = parseDate(startIso);
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((day - start) / 86400000);
  const dayKey = dayKeyOf(day);
  if (days < 0) return { status: "before", daysToStart: -days, week: 1, dayKey };
  const week = Math.floor(days / 7) + 1;
  return { status: week > plan.meta.weeks ? "after" : "during", week, dayKey };
}

// The calendar week (Mon–Sun) containing a date, for the week strip.
export function weekDates(date) {
  const mon = addDays(date, -((date.getDay() + 6) % 7));
  return DAY_KEYS.map((k, i) => ({ key: k, date: addDays(mon, i) }));
}

export const suggestedFor = (dayKey) => plan.schedule.days[dayKey].activity;
export const activity = (actId) => ({ id: actId, ...plan.activities[actId] });

// A session's items for a readiness level. Amber keeps about half: the items marked amber, with shorter times.
export function sessionItems(actId, level = "green") {
  const items = plan.activities[actId].items ?? [];
  if (level !== "amber") return items.map((it) => ({ ...it }));
  return items.filter((it) => it.amber).map((it) => ({ ...it, minutes: it.amber_minutes ?? it.minutes }));
}

export function doseText(it) {
  const side = it.per_side ? " each side" : "";
  if (it.sets && it.reps) return `${it.sets} × ${it.reps}${side}`;
  if (it.minutes) return `${it.minutes} min`;
  return "";
}
