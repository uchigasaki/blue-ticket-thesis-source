"use strict";
// LOCAL private artifact only. Does not call Google or enable any flags.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const release = require("./release-lib");
const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!["--operating", "--review"].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error("Usage: --operating private.json --review adoption.json");
  options[args[i]] = args[i + 1];
}
if (!options["--operating"] || !options["--review"]) throw new Error("Both explicit private records are required.");
const operating = JSON.parse(fs.readFileSync(path.resolve(options["--operating"]), "utf8"));
const review = JSON.parse(fs.readFileSync(path.resolve(options["--review"]), "utf8"));
const report = release.analyze(root, {mode: "production", review});
if (!report.ready) throw new Error(report.errors.join("\n"));
const config = JSON.parse(release.productionPropertiesTemplate(root).BTS_PRODUCTION_CONFIG);
for (const key of ["spreadsheetId", "opensAt", "enrollmentOpensAt", "enrollmentClosesAt", "completionClosesAt", "closesAt", "maxAssignments", "maxDailyAssignments"]) {
  if (!Object.hasOwn(operating, key)) throw new Error("Missing explicit operating value: " + key);
  config[key] = operating[key];
}
if (operating.contactEmail !== report.context.EXPERIMENT_CONFIG.studyInformation.contactEmail) throw new Error("Public contact mismatch");
const input = {config, review, contactEmail: operating.contactEmail, testEmail: operating.testEmail, automatedEmail: operating.automatedEmail};
const modules = ["Code.gs", "Production.gs", "Forms.gs", "FormsResponseCore.gs", "FormsProduction.gs", "ProductionEmail.gs", "ProductionSetup.gs", "ProductionLaunch.gs"];
const bundle = "/** PRIVATE owner-run production launch. Loading never enables anything. Never publish to Pages. */\nvar BTS_PRODUCTION_OPERATING_ = " + JSON.stringify(input) + ";\n" +
  modules.map(name => "\n// === Source module: " + name + " ===\n" + fs.readFileSync(path.join(root, "gas", name), "utf8")).join("\n");
new vm.Script(bundle, {filename: "ProductionBundle.gs"});
const sandbox = {isPlainObject_: v => !!v && typeof v === "object" && !Array.isArray(v), asDate_: v => {const d = new Date(v); return Number.isFinite(d.getTime()) ? d : null;}};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "gas/Production.gs"), "utf8"), sandbox);
sandbox.btsProductionValidateScheduleReview_(config, review, new Date());
if (!sandbox.btsProductionCapacityValid_(config.maxAssignments, 10000) || !sandbox.btsProductionCapacityValid_(config.maxDailyAssignments, 1000)) throw new Error("Invalid capacity");
const out = path.join(root, "dist", "production-launch-" + new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, {recursive: false});
fs.writeFileSync(path.join(out, "ProductionBundle.gs"), bundle);
fs.writeFileSync(path.join(out, "source-manifest.json"), JSON.stringify(modules.map(name => ({name, sha256: release.sha256(fs.readFileSync(path.join(root, "gas", name)))})), null, 2));
const escape = v => String(v).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
fs.writeFileSync(path.join(out, "index.html"), '<!doctype html><html lang="ja"><meta charset="utf-8"><title>本番の確定運用設定</title><h1>非公開の本番設定ソース</h1><p>転記だけでは受付・メールは有効になりません。先に最新コードを再デプロイし、所有者用の各関数を明示実行します。</p><textarea aria-label="ProductionBundle.gs" readonly style="width:95%;height:320px">' + escape(bundle) + '</textarea></html>');
console.log(JSON.stringify({directory: out, characters: bundle.length, sha256: release.sha256(bundle), mode: "private_explicit_owner_operations", contentHash: config.contentHash}, null, 2));
