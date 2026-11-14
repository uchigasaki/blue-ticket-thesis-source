"use strict";
// LOCAL private installation artifact only. No Google calls, property writes,
// participant data, mail or publication. Both full content snapshots retained.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto");
const release = require("./release-lib");
const root = path.resolve(__dirname, "..");
const names = ["--old-content", "--old-bundle", "--old-review", "--review", "--operating", "--form-ja", "--form-en"];
const args = process.argv.slice(2), options = {};
for (let index = 0; index < args.length; index += 2) {
  if (!names.includes(args[index]) || !args[index + 1] || options[args[index]]) throw new Error("Every explicit snapshot argument must be unique.");
  options[args[index]] = args[index + 1];
}
if (names.some(name => !options[name])) throw new Error("Usage: --old-content review-content.json --old-bundle old-ProductionBundle.gs --old-review old-adoption.json --review current-adoption.json --operating private-operating.json --form-ja ID --form-en ID");
const loadJson = name => JSON.parse(fs.readFileSync(path.resolve(options[name]), "utf8"));
function formsData(source) {
  const match = source.match(/^var BTS_GOOGLE_FORMS_DRAFT_DATA_ = (.+);\r?$/m);
  if (!match) throw new Error("Full generated Forms-data snapshot is missing.");
  const data = JSON.parse(match[1]), unsigned = { ...data }; delete unsigned.digest;
  if (release.sha256(release.canonicalJson(unsigned)) !== data.digest) throw new Error("Forms-data snapshot digest mismatch.");
  return data;
}
const review = loadJson("--review"), oldReview = loadJson("--old-review"), operating = loadJson("--operating");
const report = release.analyze(root, { mode: "production", review });
if (!report.ready) throw new Error(report.errors.join("\n"));
const config = JSON.parse(release.productionPropertiesTemplate(root).BTS_PRODUCTION_CONFIG);
for (const key of ["spreadsheetId", "opensAt", "enrollmentOpensAt", "enrollmentClosesAt", "completionClosesAt", "closesAt", "maxAssignments", "maxDailyAssignments"]) {
  if (!Object.hasOwn(operating, key)) throw new Error("Missing unchanged operating value: " + key);
  config[key] = operating[key];
}
const oldReviewContent = loadJson("--old-content");
const oldBundle = fs.readFileSync(path.resolve(options["--old-bundle"]), "utf8");
const preservedFormsData = formsData(oldBundle);
const formsMarker = "// === Source module: Forms.gs ===\n", nextMarker = "\n// === Source module: FormsResponseCore.gs ===\n";
const formsStart = oldBundle.indexOf(formsMarker), formsEnd = oldBundle.indexOf(nextMarker, formsStart);
if (formsStart < 0 || formsEnd < 0) throw new Error("Exact previous Forms module is missing from the supplied private bundle.");
const preservedFormsSource = oldBundle.slice(formsStart + formsMarker.length, formsEnd);
const request = {
  schemaVersion: 1, reason: "researcher_adopted_post_images", revisionId: "2026-10-post-pov-v1",
  formsDatasetPolicy: "preserve_existing_followup_dataset",
  adoptionReceivedAt: review.reviewedAt, spreadsheetId: config.spreadsheetId, formIds: { ja: options["--form-ja"], en: options["--form-en"] },
  oldContentHash: release.sha256(release.canonicalJson(oldReviewContent)), newContentHash: report.contentSha256,
  oldReviewContent, newReviewContent: release.reviewContent(report.context, report.manifest, root),
  oldFormsData: preservedFormsData, newFormsData: preservedFormsData, oldReview, newReview: review
};
const sandbox = {
  BTS_GOOGLE_FORMS_DRAFT_DATA_: request.newFormsData,
  isPlainObject_: value => !!value && typeof value === "object" && !Array.isArray(value),
  asDate_: value => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date : null; },
  sha256Hex_: release.sha256, canonicalFollowupValue_: value => JSON.parse(release.canonicalJson(value)),
  Utilities: { DigestAlgorithm: { SHA_256: "SHA_256" }, base64Decode: value => Buffer.from(value, "base64"),
    computeDigest: (_algorithm, value) => Array.from(crypto.createHash("sha256").update(typeof value === "string" ? value : Buffer.from(value)).digest()) }
};
vm.createContext(sandbox);
for (const name of ["FormsProduction.gs", "ProductionRevision.gs"]) vm.runInContext(fs.readFileSync(path.join(root, "gas", name), "utf8"), sandbox, { filename: name });
sandbox.btsPrSnapshots_(request, new Date());
const input = { config, review, contactEmail: operating.contactEmail, testEmail: operating.testEmail, automatedEmail: operating.automatedEmail };
const modules = ["Code.gs", "Production.gs", "Forms.gs", "FormsResponseCore.gs", "FormsProduction.gs", "ProductionEmail.gs", "ProductionSetup.gs", "ProductionLaunch.gs", "ProductionRevision.gs"];
// Production retains the exact previous follow-up dataset. Current Web-only
// post PNGs remain in Pages; no unused photo/base64 is copied into Apps Script.
const embeddedRequest = { ...request, oldFormsData: null, newFormsData: null };
const moduleSource = name => name === "Forms.gs" ? preservedFormsSource : fs.readFileSync(path.join(root, "gas", name), "utf8");
const bundle = "/** PRIVATE owner-run live post-image revision. Loading changes nothing. Never publish to Pages. */\n" +
  "var BTS_PRODUCTION_OPERATING_ = " + JSON.stringify(input) + ";\n" +
  "var BTS_PRODUCTION_POST_IMAGE_REVISION_ = " + JSON.stringify(embeddedRequest) + ";\n" +
  modules.map(name => "\n// === Source module: " + name + " ===\n" + moduleSource(name)).join("\n") +
  "\nBTS_PRODUCTION_POST_IMAGE_REVISION_.oldFormsData = BTS_GOOGLE_FORMS_DRAFT_DATA_;\nBTS_PRODUCTION_POST_IMAGE_REVISION_.newFormsData = BTS_GOOGLE_FORMS_DRAFT_DATA_;\n";
new vm.Script(bundle, { filename: "ProductionBundle.gs" });
const out = path.join(root, "dist", "production-post-images-" + new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: false });
fs.writeFileSync(path.join(out, "ProductionBundle.gs"), bundle);
fs.writeFileSync(path.join(out, "post-image-revision.private.json"), JSON.stringify(request, null, 2));
fs.writeFileSync(path.join(out, "source-manifest.json"), JSON.stringify(modules.map(name => ({ name, sha256: release.sha256(moduleSource(name)), origin: name === "Forms.gs" ? "exact_previous_production_followup_dataset" : "current_local_source" })), null, 2));
const escape = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
fs.writeFileSync(path.join(out, "index.html"), '<!doctype html><html lang="ja"><meta charset="utf-8"><title>本番事後画像の更新</title><h1>非公開の本番事後画像更新ソース</h1><p>先に最新コードを既存URLへ再デプロイし、その後 applyBtsProductionPostImageRevision を所有者が実行します。転記だけで画像更新・受付変更・メール送信は実行されません。</p><textarea aria-label="ProductionBundle.gs" readonly style="width:95%;height:320px">' + escape(bundle) + "</textarea></html>");
console.log(JSON.stringify({ directory: out, characters: bundle.length, sha256: release.sha256(bundle),
  oldContentHash: request.oldContentHash, newContentHash: request.newContentHash, oldFormsDigest: request.oldFormsData.digest,
  newFormsDigest: request.newFormsData.digest, mode: "private_owner_live_image_revision", formsChanged: 0, answerRowsChanged: 0 }, null, 2));
