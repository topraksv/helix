import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const sourcePath = resolve(root, "quality/audit.json");
const reportPath = resolve(root, "graphify-out/QUALITY_KANBAN.html");
const allowedStatuses = new Set(["pass", "fail", "manual", "blocked"]);
const expectedCategoryIds = [
  "financial-domain", "data-integrity", "architecture", "code-quality", "type-safety",
  "test-engineering", "web-e2e", "ios-native", "android-native", "browser-matrix",
  "ui-visual", "ux", "accessibility", "performance", "security-privacy", "supabase-db",
  "sync-concurrency", "import-export", "auth-email", "observability", "dependencies",
  "repo-hygiene", "git-ci", "agent-docs", "localization",
];
const expectedDefinitionHash = "11797d76c820cab4798e2132872348200233b72ee0b7f889f1c50c27546410ea";

const audit = JSON.parse(await readFile(sourcePath, "utf8"));

function definitionHash(input) {
  const frozen = input.categories.map((category) => ({
    id: category.id,
    name: category.name,
    controls: category.controls.map((control) => ({
      id: control.id,
      name: control.name,
      critical: control.critical,
      baseline: control.baseline,
      toPass: control.toPass,
    })),
  }));
  return createHash("sha256").update(JSON.stringify(frozen)).digest("hex");
}

function validate(input) {
  const errors = [];
  if (input.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!/^[a-f0-9]{40}$/.test(input.auditedCommit ?? "")) errors.push("auditedCommit must be a full SHA");
  const categoryIds = input.categories?.map((category) => category.id) ?? [];
  if (JSON.stringify(categoryIds) !== JSON.stringify(expectedCategoryIds)) {
    errors.push("the ordered 25-category scope changed");
  }
  const controlIds = new Set();
  for (const category of input.categories ?? []) {
    if (category.controls?.length !== 5) errors.push(`${category.id}: exactly five controls required`);
    for (const control of category.controls ?? []) {
      if (!control.id || controlIds.has(control.id)) errors.push(`${category.id}: duplicate/missing control id ${control.id}`);
      controlIds.add(control.id);
      if (!allowedStatuses.has(control.baseline)) errors.push(`${control.id}: invalid baseline ${control.baseline}`);
      if (!allowedStatuses.has(control.status)) errors.push(`${control.id}: invalid status ${control.status}`);
      if (typeof control.critical !== "boolean") errors.push(`${control.id}: critical must be boolean`);
      if (!Array.isArray(control.evidence) || control.evidence.length === 0) errors.push(`${control.id}: evidence required`);
      if (!Array.isArray(control.toPass)) errors.push(`${control.id}: toPass must be an array`);
      if (control.status === "pass" && control.toPass.length > 0 && control.baseline === "pass") {
        errors.push(`${control.id}: a baseline pass cannot have remediation`);
      }
      if (control.status !== "pass" && control.toPass.length === 0) errors.push(`${control.id}: open control needs acceptance work`);
    }
  }
  if (controlIds.size !== 125) errors.push(`expected 125 controls, found ${controlIds.size}`);
  if (definitionHash(input) !== expectedDefinitionHash) {
    errors.push("frozen baseline definitions changed; add evidence/status, do not rewrite the scoring bar");
  }
  if (input.excludedCategories?.length !== 1 || input.excludedCategories[0]?.id !== "release-readiness") {
    errors.push("release-readiness must remain the single explicit N/A category");
  }
  if (errors.length > 0) throw new Error(`quality audit validation failed:\n- ${errors.join("\n- ")}`);
}

function totals(field) {
  const controls = audit.categories.flatMap((category) => category.controls);
  const passed = controls.filter((control) => control[field] === "pass").length;
  return { passed, total: controls.length, score: (10 * passed) / controls.length };
}

function score(category, field) {
  return 2 * category.controls.filter((control) => control[field] === "pass").length;
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function list(items) {
  return `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
}

function render() {
  const baseline = totals("baseline");
  const current = totals("status");
  const labels = { pass: "Geçti", fail: "Açık", manual: "Manuel", blocked: "Engelli" };
  const order = ["fail", "blocked", "manual", "pass"];
  const nav = audit.categories.map((category) => {
    const currentScore = score(category, "status");
    const baselineScore = score(category, "baseline");
    return `<button class="category" data-category="${esc(category.id)}"><span>${esc(category.name)}</span><strong>${currentScore}/10</strong><small>başlangıç ${baselineScore}/10</small></button>`;
  }).join("");
  const columns = order.map((status) => {
    const cards = audit.categories.flatMap((category) => category.controls
      .filter((control) => control.status === status)
      .map((control) => `<article class="card" data-category="${esc(category.id)}" data-search="${esc(`${category.name} ${control.id} ${control.name} ${control.evidence.join(" ")} ${control.toPass.join(" ")}`.toLocaleLowerCase("tr-TR"))}">
        <div class="badges"><span>${esc(control.id)}</span><span>${control.critical ? "kritik" : "standart"}</span>${control.baseline !== control.status ? `<span class="changed">${esc(control.baseline)} → ${esc(control.status)}</span>` : ""}</div>
        <h3>${esc(control.name)}</h3><p class="category-name">${esc(category.name)}</p>
        <details><summary>Kanıt</summary>${list(control.evidence)}</details>
        ${control.toPass.length > 0 ? `<details open><summary>10/10 için kabul koşulu</summary>${list(control.toPass)}</details>` : ""}
      </article>`).join(""))
      .join("");
    const count = audit.categories.flatMap((category) => category.controls).filter((control) => control.status === status).length;
    return `<section class="column status-${status}"><header><h2>${labels[status]}</h2><span>${count}</span></header><div class="cards">${cards || "<p>Kontrol yok.</p>"}</div></section>`;
  }).join("");
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${esc(audit.title)}</title>
  <style>
  :root{--bg:#f3efe9;--panel:#fffdf9;--ink:#28221e;--muted:#746961;--line:#d1c5ba;--brand:#ad5030;--ok:#2d6c4b;--warn:#946316;--bad:#9b3d38} @media(prefers-color-scheme:dark){:root{--bg:#1b1816;--panel:#29231f;--ink:#f4ede7;--muted:#c0b4ab;--line:#50453e;--brand:#e17a55;--ok:#85c8a6;--warn:#e4b761;--bad:#ef8e87}}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif} button,input{font:inherit}.shell{max-width:1800px;margin:auto;padding:24px}.hero{display:grid;grid-template-columns:1fr auto;gap:24px;padding:24px;background:var(--panel);border:1px solid var(--line);border-top:5px solid var(--brand);border-radius:18px}.hero h1{margin:0;font:700 clamp(28px,4vw,46px)/1.1 ui-serif,Georgia,serif}.hero p{max-width:900px;color:var(--muted)}.score{text-align:right}.score strong{display:block;color:var(--brand);font:700 56px/1 ui-serif,Georgia,serif}.score small,.meta{color:var(--muted)}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:16px 0}.stat{padding:14px;background:var(--panel);border:1px solid var(--line);border-radius:12px}.stat strong{display:block;font-size:24px}.formula{padding:14px 16px;border-left:4px solid var(--brand);background:color-mix(in srgb,var(--brand) 12%,var(--panel));border-radius:10px}.tools{display:flex;gap:10px;margin:16px 0}.tools input{width:min(560px,100%);min-height:44px;padding:10px 12px;color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:10px}.layout{display:grid;grid-template-columns:290px minmax(0,1fr);gap:16px;align-items:start}.categories{position:sticky;top:12px;display:grid;gap:7px;max-height:calc(100vh - 24px);overflow:auto;padding:10px;background:var(--panel);border:1px solid var(--line);border-radius:14px}.category{display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:9px;text-align:left;color:var(--ink);background:transparent;border:1px solid transparent;border-radius:9px;cursor:pointer}.category span{line-height:1.2}.category small{grid-column:1/-1;color:var(--muted)}.category.active,.category:hover{border-color:var(--line);background:color-mix(in srgb,var(--brand) 10%,transparent)}.board-wrap{overflow-x:auto}.board{display:grid;grid-template-columns:repeat(4,minmax(300px,1fr));gap:12px;min-width:1240px}.column{padding:10px;border-radius:14px;background:color-mix(in srgb,var(--line) 28%,transparent)}.column>header{display:flex;justify-content:space-between;align-items:center;padding:2px 4px 9px}.column h2{margin:0;font-size:16px}.cards{display:grid;gap:10px}.card{padding:13px;background:var(--panel);border:1px solid var(--line);border-radius:12px}.card h3{margin:8px 0 3px;font-size:15px;line-height:1.3}.category-name{margin:0 0 10px;color:var(--muted);font-size:12px}.badges{display:flex;flex-wrap:wrap;gap:5px}.badges span{padding:2px 7px;border-radius:999px;background:color-mix(in srgb,var(--line) 45%,transparent);font-size:11px}.badges .changed{color:var(--ok);font-weight:700}.card details{margin-top:8px}.card summary{cursor:pointer;font-weight:650}.card ul{margin:6px 0 0;padding-left:18px}.hidden{display:none!important}.status-pass{border-top:3px solid var(--ok)}.status-fail{border-top:3px solid var(--bad)}.status-manual,.status-blocked{border-top:3px solid var(--warn)}button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid var(--brand);outline-offset:2px}@media(max-width:900px){.shell{padding:12px}.hero{grid-template-columns:1fr}.score{text-align:left}.layout{grid-template-columns:1fr}.categories{position:static;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));max-height:none}}
  </style></head><body><main class="shell"><section class="hero"><div><h1>${esc(audit.title)}</h1><p>${esc(audit.environment)}</p><div class="meta">Baz commit: ${esc(audit.auditedCommit.slice(0, 12))} · ${esc(audit.auditedAt)} · 25 × 5 sabit kontrol</div></div><div class="score"><strong>${current.score.toFixed(2)}</strong><small>başlangıç ${baseline.score.toFixed(2)} / 10</small></div></section>
  <section class="stats"><div class="stat"><strong>${current.passed}/${current.total}</strong><span>geçen kontrol</span></div><div class="stat"><strong>${audit.categories.flatMap((c) => c.controls).filter((c) => c.status === "fail").length}</strong><span>açık kontrol</span></div><div class="stat"><strong>${audit.categories.flatMap((c) => c.controls).filter((c) => c.status === "manual").length}</strong><span>manuel kontrol</span></div><div class="stat"><strong>${audit.categories.flatMap((c) => c.controls).filter((c) => c.status === "blocked").length}</strong><span>engelli kontrol</span></div><div class="stat"><strong>N/A</strong><span>production/store</span></div></section>
  <p class="formula">${esc(audit.methodology.formula)} Yalnız tekrarlanabilir kanıt puan yükseltir.</p><div class="tools"><input id="search" type="search" placeholder="Kontrol, kategori veya kanıt ara…" aria-label="Kontrollerde ara"></div>
  <div class="layout"><nav class="categories"><button class="category active" data-category="all"><span>Tüm kategoriler</span><strong>${current.score.toFixed(2)}</strong><small>${current.passed}/${current.total} kontrol</small></button>${nav}</nav><div class="board-wrap"><div class="board">${columns}</div></div></div></main>
  <script>const cards=[...document.querySelectorAll('.card')],buttons=[...document.querySelectorAll('.category')],search=document.querySelector('#search');let category='all';function apply(){const term=search.value.trim().toLocaleLowerCase('tr-TR');for(const card of cards)card.classList.toggle('hidden',(category!=='all'&&card.dataset.category!==category)||(term&&!card.dataset.search.includes(term)));}for(const button of buttons)button.addEventListener('click',()=>{category=button.dataset.category;for(const item of buttons)item.classList.toggle('active',item===button);apply();});search.addEventListener('input',apply);</script></body></html>`;
}

validate(audit);
const baseline = totals("baseline");
const current = totals("status");
process.stdout.write(`Quality audit: ${current.passed}/${current.total} controls, ${current.score.toFixed(2)}/10 (baseline ${baseline.score.toFixed(2)})\n`);
if (process.argv.includes("--render")) {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, render(), "utf8");
  process.stdout.write(`Rendered ${reportPath}\n`);
}
