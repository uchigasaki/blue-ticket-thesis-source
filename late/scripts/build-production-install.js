"use strict";
// Creates only a LOCAL UI clipboard source. Never deploys, approves or sends.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { productionPropertiesTemplate, sha256 } = require("./release-lib");
const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--planned-app-url" || !/^https:\/\/[A-Za-z0-9.-]+\/(?:[A-Za-z0-9_.-]+\/)*$/.test(args[1])) throw new Error("Usage: node scripts/build-production-install.js --planned-app-url https://approved-host/project/");
const properties = productionPropertiesTemplate(root);
properties.BTS_PUBLIC_APP_URL = args[1];
const config = JSON.parse(properties.BTS_PRODUCTION_CONFIG);
config.publicAppUrl = args[1];
properties.BTS_PRODUCTION_CONFIG = JSON.stringify(config);
const sourceFiles = ["Code.gs", "Production.gs", "Forms.gs", "FormsResponseCore.gs", "FormsProduction.gs", "ProductionEmail.gs", "ProductionSetup.gs"];
const provenance = sourceFiles.map(name => ({ name, sha256: sha256(fs.readFileSync(path.join(root, "gas", name))) }));
const bundle = "/** Generated closed-only production installation. No credentials or real approvals. */\nvar BTS_PRODUCTION_BUILD_ = " + JSON.stringify(properties, null, 2) + ";\n\n" +
  sourceFiles.map(name => "\n// === Source module: " + name + " ===\n" + fs.readFileSync(path.join(root, "gas", name), "utf8")).join("\n");
new vm.Script(bundle, { filename: "ProductionBundle.gs" });
const manifest = fs.readFileSync(path.join(root, "gas", "appsscript.production.json"), "utf8");
const escape = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const out = path.join(root, "dist", "production-install-" + new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
for (const [name, value] of [["ProductionBundle.gs", bundle], ["appsscript.json", manifest], ["source-manifest.json", JSON.stringify(provenance, null, 2)]]) fs.writeFileSync(path.join(out, name), value);
fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><html lang="ja"><meta charset="utf-8"><title>本番用・停止状態のインストールソース</title><style>body{font:16px/1.6 sans-serif;margin:24px}textarea{width:95%;height:240px;font:13px monospace}p{overflow-wrap:anywhere}</style><h1>本番用の準備（受付・メール停止）</h1><p>新規の本番専用プロジェクトにだけ転記します。公開URLは予定値であり、サイトの公開済み表示ではありません。研究レビューは空欄・全falseのままです。新manifestの権限は所有者が確認・承認してください。</p>${[["ProductionBundle.gs", bundle], ["appsscript.json", manifest]].map(([name, source]) => `<h2>${name}</h2><p>${source.length} characters / SHA-256: ${sha256(source)}</p><textarea aria-label="${name}" readonly spellcheck="false">${escape(source)}</textarea>`).join("")}</html>`);
console.log(JSON.stringify({ directory: out, bundleCharacters: bundle.length, bundleSha256: sha256(bundle), mode: "closed_preparation_only" }, null, 2));
