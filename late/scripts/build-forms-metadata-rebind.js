"use strict";
// LOCAL build only. No Google requests, approvals, publication or property writes.
// Preserve old signed snapshots; the owner-run GAS function independently validates
// every difference and requires private, unused, closed resources before rebinding.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const release = require("./release-lib");
const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const names = ["--old-review", "--old-bundle", "--review", "--spreadsheet", "--form-ja", "--form-en"];
const options = {};
for (let index = 0; index < args.length; index += 2) {
  if (!names.includes(args[index]) || !args[index + 1] || options[args[index]]) throw new Error("Explicit unique old/new snapshot and target arguments required.");
  options[args[index]] = args[index + 1];
}
if (names.some(name => !options[name])) throw new Error("Usage: --old-review file.json --old-bundle file.gs --review adoption.json --spreadsheet ID --form-ja ID --form-en ID");
function formsData(source) {
  const match = source.match(/^var BTS_GOOGLE_FORMS_DRAFT_DATA_ = (.+);\r?$/m);
  if (!match) throw new Error("Complete generated Forms data missing.");
  const data = JSON.parse(match[1]);
  const unsigned = {...data}; delete unsigned.digest;
  if (release.sha256(release.canonicalJson(unsigned)) !== data.digest) throw new Error("Forms snapshot digest mismatch.");
  return data;
}
const oldReviewContent = JSON.parse(fs.readFileSync(path.resolve(options["--old-review"]), "utf8"));
const review = JSON.parse(fs.readFileSync(path.resolve(options["--review"]), "utf8"));
const report = release.analyze(root, {mode: "production", review});
if (!report.ready) throw new Error(report.errors.join("\n"));
const newReviewContent = release.reviewContent(report.context, report.manifest, root);
const artifact = {
  schemaVersion: 1, reason: "researcher_adoption_metadata_only", adoptionReceivedAt: review.reviewedAt,
  spreadsheetId: options["--spreadsheet"], formIds: {ja: options["--form-ja"], en: options["--form-en"]},
  oldContentHash: release.sha256(release.canonicalJson(oldReviewContent)), newContentHash: report.contentSha256,
  oldReviewContent, newReviewContent,
  oldFormsData: formsData(fs.readFileSync(path.resolve(options["--old-bundle"]), "utf8")),
  newFormsData: formsData(fs.readFileSync(path.join(root, "gas/Forms.gs"), "utf8"))
};
const modules = ["Code.gs", "Production.gs", "Forms.gs", "FormsResponseCore.gs", "FormsProduction.gs", "ProductionEmail.gs", "ProductionSetup.gs"];
const bundle = "/** PRIVATE CLOSED-ONLY metadata migration. Never publish this source to Pages. */\n" +
  "var BTS_PRODUCTION_BUILD_ = " + JSON.stringify(release.productionPropertiesTemplate(root)) + ";\n" +
  "var BTS_FORMS_METADATA_REBIND_ = " + JSON.stringify(artifact) + ";\n" +
  modules.map(name => "\n// === Source module: " + name + " ===\n" + fs.readFileSync(path.join(root, "gas", name), "utf8")).join("\n");
new vm.Script(bundle, {filename: "ProductionBundle.gs"});
// Reuse the exact GAS metadata validator locally. No mocked acceptance of material changes.
const sandbox = {
  BTS_GOOGLE_FORMS_DRAFT_DATA_: artifact.newFormsData,
  isPlainObject_: value => !!value && typeof value === "object" && !Array.isArray(value),
  asDate_: value => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date : null; },
  sha256Hex_: release.sha256, canonicalFollowupValue_: value => JSON.parse(release.canonicalJson(value))
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "gas/FormsProduction.gs"), "utf8"), sandbox);
sandbox.btsFpRebindSnapshots_(artifact, new Date());
const out = path.join(root, "dist", "forms-rebind-" + new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, {recursive: false});
fs.writeFileSync(path.join(out, "ProductionBundle.gs"), bundle);
fs.writeFileSync(path.join(out, "metadata-rebind.private.json"), JSON.stringify(artifact, null, 2));
const escape = value => String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
fs.writeFileSync(path.join(out, "index.html"), '<!doctype html><html lang="ja"><meta charset="utf-8"><title>閉鎖Formsの採用記録反映</title><h1>非公開・回答0件の既存Formsだけを対象にする</h1><p>コード転記だけで公開・受付・メールを有効化しません。対象IDと旧新内容を厳格に照合します。</p><textarea aria-label="ProductionBundle.gs" readonly style="width:95%;height:320px">' + escape(bundle) + '</textarea></html>');
console.log(JSON.stringify({directory: out, characters: bundle.length, sha256: release.sha256(bundle), oldContentHash: artifact.oldContentHash, newContentHash: artifact.newContentHash, oldFormsDigest: artifact.oldFormsData.digest, newFormsDigest: artifact.newFormsData.digest, mode: "private_closed_only"}, null, 2));
