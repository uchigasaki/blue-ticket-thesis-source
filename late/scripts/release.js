#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const release = require("./release-lib.js");
const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const allowed = new Set(["--preview", "--production", "--build", "--check", "--review", "--print-review-template", "--print-followup-digest", "--print-gas-properties", "--print-production-template", "--write-review", "--help"]);

try {
  const reviewIndex = args.indexOf("--review");
  args.forEach((arg, index) => { if (index !== reviewIndex + 1 || reviewIndex < 0) if (!allowed.has(arg)) throw new Error("Unknown argument: " + arg); });
  if (args.includes("--help") || !args.length) {
    console.log("node scripts/release.js --check --preview | --check --production [--review path.json]\nnode scripts/release.js --build --preview | --build --production --review path.json\nnode scripts/release.js --print-review-template | --print-followup-digest | --print-gas-properties | --print-production-template | --write-review");
  } else {
    if (args.includes("--preview") && args.includes("--production")) throw new Error("Choose one release mode.");
    if (reviewIndex >= 0 && (!args[reviewIndex + 1] || args[reviewIndex + 1].startsWith("--"))) throw new Error("--review requires a JSON record path.");
    const options = { mode: args.includes("--production") ? "production" : "preview", review: reviewIndex < 0 ? undefined : JSON.parse(fs.readFileSync(path.resolve(args[reviewIndex + 1]), "utf8")) };
    if (args.includes("--print-followup-digest")) console.log(release.followupInstrumentSha256(release.loadExperiment(root)));
    else if (args.includes("--print-gas-properties")) console.log(JSON.stringify(release.gasScriptProperties(release.loadExperiment(root)), null, 2));
    else if (args.includes("--print-production-template")) {
      console.error("Preparation template only: not research approval or permission to publish. HTTP, production, and email remain disabled.");
      console.log(JSON.stringify(release.productionPropertiesTemplate(root), null, 2));
    }
    else if (args.includes("--print-review-template")) console.log(JSON.stringify(release.analyze(root, options).reviewTemplate, null, 2));
    else if (args.includes("--write-review")) console.log(release.writeReview(root, options).directory);
    else if (args.includes("--build")) {
      if (!args.includes("--preview") && !args.includes("--production")) throw new Error("Build requires an explicit mode.");
      console.log(release.build(root, options).directory);
    } else if (args.includes("--check")) {
      const report = release.analyze(root, options);
      console.log(JSON.stringify({ ready: report.ready, productionReady: report.productionReady, mode: report.mode, appVersion: report.appVersion, errors: report.errors, warnings: report.warnings, contentSha256: report.contentSha256, followupInstrumentSha256: report.followupInstrumentSha256 }, null, 2));
      if (!report.ready) process.exitCode = 1;
    } else throw new Error("Choose --check, --build, --print-review-template, --print-followup-digest, --print-gas-properties, --print-production-template, or --write-review.");
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
