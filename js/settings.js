// Settings: name, start date, usual day, backup / spreadsheet export / restore, install help, delete everything.
import * as db from "./db.js";
import { getPlan, isoDate } from "./plan.js";
import { esc, toast, fmt } from "./ui.js";
import { scoreChips } from "./session.js";

const APP_ID = "l-gym-plan";

// Share sheet on iPhone ("Save to Files"); falls back to a normal download elsewhere.
async function saveFiles(files) {
  if (navigator.canShare?.({ files })) {
    try { await navigator.share({ files }); return true; } catch (e) { if (e.name === "AbortError") return false; }
  }
  for (const f of files) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  return true;
}

const stamp = () => isoDate(new Date());

// Where the backup file goes on iPhone: shown under every "Back up now" button.
export const BACKUP_HOW = `<ol class="small muted backup-how"><li>In the panel that opens, scroll down and tap <b>Save to Files</b>.</li>
  <li>Choose <b>iCloud Drive</b> (a folder such as "Gym backups" keeps it tidy), then tap <b>Save</b>.</li>
  <li>Or tap <b>Mail</b> or <b>Messages</b> and send it to yourself. That works too.</li></ol>
  <p class="small muted">You never need to open the file. To get your logs back, use <b>Restore from a backup file</b> in Settings.</p>`;

export async function backupNow() {
  const data = await db.exportAll();
  const file = new File([JSON.stringify(data, null, 1)], `${APP_ID}-backup-${stamp()}.json`, { type: "application/json" });
  if (await saveFiles([file])) {
    await db.setSetting("lastBackup", new Date().toISOString());
    toast("Backup saved");
    return true;
  }
  return false;
}

// ---- spreadsheet export
function csv(rows) {
  const cell = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\n");
}

export async function exportCsv() {
  const ex = getPlan().exercises;
  const sessions = (await db.all("sessions")).filter((s) => s.status === "finished").sort((a, b) => (a.date < b.date ? -1 : 1));
  const summary = [["date", "week", "type", "readiness", "minutes", "pain_before", "energy_before", "pain_after", "energy_after",
    "pain_24h", "energy_24h", "pain_48h", "energy_48h", "note"]];
  const sets = [["date", "type", "exercise", "set", "reps", "kg", "setting", "minutes", "status", "note"]];
  for (const s of sessions) {
    const c = s.checks ?? {};
    summary.push([s.date, s.week, s.title, s.level, s.kind === "gym" ? s.durationMin : s.minutes, s.before?.pain, s.before?.energy,
      s.after?.pain, s.after?.energy, c.h24?.pain, c.h24?.energy, c.h48?.pain, c.h48?.energy, s.note]);
    for (const it of s.items ?? []) {
      const name = ex[it.exercise]?.name ?? it.exercise;
      const status = it.lighter && it.status === "skipped" ? "left out (lighter day)" : it.status;
      if (!it.sets.length) sets.push([s.date, s.title, name, "", "", "", "", it.minutes, status, it.note]);
      it.sets.forEach((st, j) => sets.push([s.date, s.title, name, j + 1, st.reps, it.kg, it.setting, "", st.done ? status : "not done", it.note]));
    }
  }
  const days = [["date", "pain", "energy", "readiness", "rested", ...getPlan().nutrition.habits.map((h) => h.id)]];
  for (const d of (await db.all("days")).sort((a, b) => (a.date < b.date ? -1 : 1))) {
    days.push([d.date, d.readiness?.pain, d.readiness?.energy, d.readiness?.level, d.rest ? "yes" : "",
      ...getPlan().nutrition.habits.map((h) => (d.nutrition?.[h.id] ? "yes" : ""))]);
  }
  const d = stamp();
  const files = [["sessions", summary], ["exercises", sets], ["days", days]]
    .map(([n, rows]) => new File([`﻿${csv(rows)}`], `${n}-${d}.csv`, { type: "text/csv" }));
  if (await saveFiles(files)) toast("Spreadsheet files exported");
}

// ---- restore
export function readBackup(file) {
  return file.text().then((t) => {
    let data;
    try { data = JSON.parse(t); } catch { throw new Error("That file isn't a backup from this app."); }
    if (data?.app !== APP_ID || typeof data.kv !== "object") throw new Error("That file isn't a backup from this app.");
    for (const n of db.STORES.slice(1)) if (data[n] != null && !Array.isArray(data[n])) throw new Error("The backup file looks damaged.");
    return data;
  });
}

export async function needsBackupReminder(now = new Date()) {
  const last = await db.getSetting("lastBackup", null);
  const logged = (await db.all("sessions")).length;
  if (!logged) return null;
  if (!last) return "You haven't saved a backup yet.";
  const days = Math.floor((now - new Date(last)) / 86400000);
  return days >= getPlan().app.backup_reminder_days ? `Your last backup was ${days} days ago.` : null;
}

// ------------------------------------------------------------------ view
export function createSettingsView({ $screen, $tabs }) {
  let on = false, onDone, pending = null, usual = null;

  async function start(done) {
    on = true;
    onDone = done;
    usual = await db.getSetting("usual", null);
    $tabs.hidden = true;
    render();
  }

  function stop(changed) {
    on = false;
    pending = null;
    $tabs.hidden = false;
    onDone(changed);
  }

  async function render() {
    const t = getPlan().tracking;
    const name = await db.getSetting("name", "");
    const start = await db.getSetting("startDate", "");
    const last = await db.getSetting("lastBackup", null);
    const counts = Object.fromEntries(await Promise.all(db.STORES.slice(1).map(async (n) => [n, (await db.all(n)).length])));
    const restorePreview = pending
      ? `<div class="notice"><b>Backup from ${fmt(new Date(pending.exported), { day: "numeric", month: "long", year: "numeric" })}</b><br>
          ${pending.sessions?.length ?? 0} sessions · ${pending.days?.length ?? 0} days
          <p class="small">Restoring <b>replaces everything</b> on this phone (${counts.sessions} sessions, ${counts.days} days) with this backup.</p>
          <div class="row2"><button type="button" class="btn ghost" data-sact="restore-cancel">Cancel</button>
          <button type="button" class="btn" data-sact="restore-confirm">Restore</button></div></div>` : "";
    $screen.innerHTML = `
      <div class="wk-top" style="background:var(--deep)"><button type="button" class="back" data-sact="exit">‹ Today</button><h1>Settings</h1></div>
      <div class="card"><h2 style="margin-top:0">Your data</h2>
        <p class="small muted">Everything you log stays on this phone. Save a backup now and then, so a lost phone (or deleting the app icon) doesn't lose it.</p>
        <p><b>Last backup:</b> ${last ? fmt(new Date(last), { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "never"}</p>
        <button type="button" class="btn" data-sact="backup">Back up now</button>
        ${BACKUP_HOW}
        <button type="button" class="btn ghost" data-sact="csv">Export for spreadsheets (CSV)</button>
        <label class="btn ghost filebtn">Restore from a backup file<input type="file" accept="application/json,.json" data-sact="file" hidden></label>
        ${restorePreview}
      </div>
      <div class="card"><h2 style="margin-top:0">You</h2>
        <label class="mini">Name<input class="in wide" id="s-name" value="${esc(name)}" maxlength="30"></label>
        <label class="mini">Your 12 weeks start on<input class="in wide" type="date" id="s-start" value="${start}"></label>
        <p class="q">Your usual pain on an ordinary day</p>${scoreChips("upain", t.pain, usual?.pain, "data-sact=upain")}
        <p class="q">Your usual energy on an ordinary day</p>${scoreChips("uenergy", t.energy, usual?.energy, "data-sact=uenergy")}
        <p class="muted small">Used to suggest green, amber or red. You always have the final say.</p>
        <button type="button" class="btn" data-sact="save">Save</button>
      </div>
      <div class="card"><h2 style="margin-top:0">Install on your iPhone</h2>
        <ol class="small"><li>Open the app's web address in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (a square with an arrow).</li>
        <li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li><li>Open it from the new icon. It works offline after the first time.</li></ol>
        <p class="small muted">This is a web app, not an App Store app. Deleting the icon also deletes its data, so back up first.</p>
      </div>
      <div class="card"><h2 style="margin-top:0">Not medical advice</h2>
        <p class="small">${esc(getPlan().meta.disclaimer)} ${esc(getPlan().safety.crashes)}</p>
      </div>
      <button type="button" class="linkbtn" data-sact="wipe" style="display:block;margin:4px auto 40px;color:var(--red)">Delete all my data on this phone</button>`;
  }

  $screen.addEventListener("click", async (e) => {
    if (!on) return;
    const b = e.target.closest("[data-sact]");
    if (!b || b.tagName === "INPUT") return;
    switch (b.dataset.sact) {
      case "exit": return stop(false);
      case "backup": await backupNow(); break;
      case "csv": await exportCsv(); break;
      case "upain": usual = { ...usual, pain: Number(b.dataset.v) }; break;
      case "uenergy": usual = { ...usual, energy: Number(b.dataset.v) }; break;
      case "save": {
        const n = document.getElementById("s-name").value.trim();
        const s = document.getElementById("s-start").value;
        if (!s) { toast("Pick a start date"); return; }
        await db.setSetting("name", n);
        await db.setSetting("startDate", s);
        if (usual?.pain != null && usual?.energy != null) await db.setSetting("usual", usual);
        toast("Saved");
        return stop(true);
      }
      case "restore-cancel": pending = null; break;
      case "restore-confirm":
        try {
          await db.importAll(pending);
          toast("Backup restored");
          return stop(true);
        } catch {
          toast("Restore failed. Nothing was changed.", "bad");
        }
        break;
      case "wipe":
        if (!confirm("Delete ALL your logs and settings on this phone?")) return;
        if (!confirm("Are you sure? Without a backup this can't be undone.")) return;
        await db.clearAll();
        location.reload();
        return;
      default: return;
    }
    render();
  });

  $screen.addEventListener("change", async (e) => {
    if (!on || e.target.dataset.sact !== "file" || !e.target.files[0]) return;
    try { pending = await readBackup(e.target.files[0]); } catch (err) { toast(err.message, "bad"); pending = null; }
    e.target.value = "";
    render();
  });

  return { start, active: () => on };
}
