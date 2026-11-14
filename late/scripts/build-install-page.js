"use strict";
// Local, read-only clipboard source for installing the reviewed GAS files via its editor.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const files = ["Code.gs", "appsscript.json", "Forms.gs", "LiveSmoke.gs"].filter(name => fs.existsSync(path.join(root, "gas", name)));
const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const out = path.join(root, "dist", "gas-install-" + new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
const sections = files.map(name => {
  const source = fs.readFileSync(path.join(root, "gas", name), "utf8");
  const hash = crypto.createHash("sha256").update(source).digest("hex");
  return `<section><h2>${escape(name)}</h2><p>${source.length} characters / SHA-256: ${hash}</p><textarea aria-label="${escape(name)}" readonly spellcheck="false">${escape(source)}</textarea></section>`;
});
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GAS installation sources</title><style>body{font:16px/1.6 sans-serif;margin:24px;max-width:1100px}textarea{width:100%;height:240px;font:13px monospace}p{overflow-wrap:anywhere}</style><h1>後期用GASのインストール用ソース</h1><p>新規の検証用プロジェクトにだけ転記します。メール送信権限は含めません。本番の承認・公開とは別の作業です。</p>${sections.join("")}</html>`;
fs.writeFileSync(path.join(out, "index.html"), html);
console.log(out);
