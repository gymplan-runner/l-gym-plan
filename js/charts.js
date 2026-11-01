// Small inline-SVG charts. One y-axis, thin marks, recessive grid; every chart has a table view.
// Series are told apart by line style as well as colour (solid accent vs dashed grey), never colour alone.
import { esc } from "./ui.js";

// series: [{ name, points: [{ x, y }], dashed? }] — x is a week number.
export function lineChart({ title, unit = "", series, yMin = 0, yMax, note = "" }) {
  const all = series.flatMap((s) => s.points.map((p) => p.y));
  const xs = series.flatMap((s) => s.points.map((p) => p.x));
  const x0 = Math.min(1, ...xs), x1 = Math.max(12, ...xs);
  const top = yMax ?? Math.max(1, ...all) * 1.15;
  const W = 340, H = 170, L = 34, R = 12, T = 12, B = 26;
  const x = (wk) => L + ((wk - x0) / (x1 - x0)) * (W - L - R);
  const y = (v) => T + (1 - (v - yMin) / (top - yMin)) * (H - T - B);
  const ticks = [0, 0.5, 1].map((f) => yMin + f * (top - yMin));
  const grid = ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/>
    <text x="${L - 6}" y="${y(t) + 4}" class="axis" text-anchor="end">${Math.round(t * 10) / 10}</text>`).join("");
  const xt = [x0, Math.round((x0 + x1) / 2), x1].map((w) => `<text x="${x(w)}" y="${H - 6}" class="axis"
    text-anchor="${w === x1 ? "end" : w === x0 ? "start" : "middle"}">Wk ${w}</text>`).join("");
  const lines = series.map((s) => {
    const pts = s.points.filter((p) => p.y != null);
    if (!pts.length) return "";
    const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
    const dots = pts.map((p) => `<circle cx="${x(p.x)}" cy="${y(p.y)}" r="${s.dashed ? 3.5 : 4.5}" class="${s.dashed ? "dot2" : "dot"}">
      <title>${esc(s.name)}, week ${p.x}: ${p.y}${unit}</title></circle>`).join("");
    const lastP = pts[pts.length - 1];
    const label = s.dashed ? "" : `<text x="${Math.min(x(lastP.x) + 7, W - R - 2)}" y="${y(lastP.y) - 8}" class="val"
      text-anchor="${x(lastP.x) > W - 60 ? "end" : "start"}">${lastP.y}${unit}</text>`;
    return `<path d="${d}" class="${s.dashed ? "plan" : "line"}"/>${dots}${label}`;
  }).join("");
  const legend = series.length > 1 ? `<div class="legend">${series.map((s) =>
    `<span><i class="${s.dashed ? "k-plan" : "k-line"}"></i>${esc(s.name)}</span>`).join("")}</div>` : "";
  const weeks = [...new Set(xs)].sort((a, b) => a - b);
  const table = `<details class="tbl"><summary>Show as table</summary><table><tr><th>Week</th>${series.map((s) => `<th>${esc(s.name)}</th>`).join("")}</tr>
    ${weeks.map((w) => `<tr><td>${w}</td>${series.map((s) => `<td>${s.points.find((p) => p.x === w)?.y ?? "–"}</td>`).join("")}</tr>`).join("")}</table></details>`;
  return `<figure class="chart"><figcaption>${esc(title)}</figcaption>${note ? `<p class="muted small">${esc(note)}</p>` : ""}${legend}
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${grid}${xt}${lines}</svg>${table}</figure>`;
}
