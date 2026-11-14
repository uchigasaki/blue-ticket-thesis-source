"use strict";

// Local fake DOM/JSONP only. No Google requests, saved responses, or real tokens.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const release = require("../scripts/release-lib.js");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "followup-app.js"), "utf8");
const actual = release.loadExperiment(root);
const fakeToken = "c".repeat(64);
const copy = value => JSON.parse(JSON.stringify(value));
const instrumentHash = release.followupInstrumentSha256(actual);
let assertions = 0;
function check(value, message) { assertions++; assert.ok(value, message); }
class Element {
  constructor(id) {
    this.id = id; this.textContent = ""; this.value = ""; this.disabled = false;
    this.dataset = {}; this.attributes = {}; this.listeners = {};
    this.classes = new Set(["followup-form", "forms-panel", "forms-open", "retry"].includes(id) ? ["hidden"] : []);
    this.classList = { add: value => this.classes.add(value), remove: value => this.classes.delete(value),
      contains: value => this.classes.has(value), toggle: (value, enabled) => enabled ? this.classes.add(value) : this.classes.delete(value) };
  }
  set href(value) { this.attributes.href = value; }
  get href() { return this.attributes.href || ""; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  async dispatch(type) { const event = { target: this, prevented: false, preventDefault() { this.prevented = true; } }; await this.listeners[type]?.(event); return event; }
  focus() {}
  remove() {}
  querySelectorAll() { return []; }
  replaceChildren() { throw new Error("Google Forms mode must not render the old Web questionnaire"); }
}
function response(language = "ja") {
  const now = Date.now();
  return {
    ok: true, action: "followup", schema_version: 2, status: "ready", measurement_mode: "forms",
    experiment_id: actual.EXPERIMENT_CONFIG.experimentId, allocation_version: actual.EXPERIMENT_CONFIG.allocationVersion,
    assignment_id: "fixture_assignment_001", session_id: "fixture_session_001", participant_id: "QAAX01", participant_id_normalized: "QAAX01",
    store_id: "A", condition: "original", followup_id: "fixture_followup_001", parent_submission_id: "fixture_submission_001",
    instrument_version: actual.EVALUATION_DATA.instrumentVersion, instrument_hash: instrumentHash,
    due_at: new Date(now - 86400000).toISOString(), expires_at: new Date(now + 30 * 86400000).toISOString(),
    window_ends_at: new Date(now + 7 * 86400000).toISOString(), server_time: new Date(now).toISOString(),
    forms: { measurement_mode: "forms", form_id: "FIXTURE_EDITOR_FORM_ID", language, expires_at: new Date(now + 3600000).toISOString(),
      form_url: "https://docs.google.com/forms/d/e/FIXTURE_PUBLIC_FORM_ID/viewform?usp=pp_url&entry.123=fixture-scoped-proof" }
  };
}
async function harness(options = {}) {
  const elements = Object.fromEntries(["followup-form", "language", "heading", "intro", "submit", "retry", "save-note", "preview-warning", "status", "forms-open", "forms-check", "forms-notice", "forms-panel", "questions"].map(id => [id, new Element(id)]));
  const config = copy(actual.EXPERIMENT_CONFIG);
  config.serverEndpoint = "https://script.google.com/macros/s/FIXTURE_ENDPOINT_ONLY/exec";
  const evaluation = copy(actual.EVALUATION_DATA);
  if (!options.unapproved) { evaluation.readyForProduction = true; evaluation.contentReviewIssues = []; Object.keys(evaluation.researcherApprovals).forEach(key => { evaluation.researcherApprovals[key] = true; }); }
  else { Object.keys(evaluation.researcherApprovals).forEach(key => { evaluation.researcherApprovals[key] = false; }); }
  const requests = [];
  const scripts = [];
  const timeouts = [];
  const posted = [];
  let storageReads = 0;
  const context = vm.createContext({
    URL, URLSearchParams, TextEncoder, Uint8Array, Date, JSON, Object, Array, Set, Promise, console,
    crypto: crypto.webcrypto, setTimeout: (fn, delay) => { timeouts.push(delay); return setTimeout(fn, delay); }, clearTimeout,
    EXPERIMENT_CONFIG: config, EVALUATION_DATA: evaluation,
    location: { hostname: options.local ? "localhost" : "fixture.github.io", search: options.preview ? "?preview=1" : "", hash: options.hash ?? "#token=" + fakeToken },
    sessionStorage: { getItem() { storageReads++; return JSON.stringify({ pending: { token: fakeToken }, completed: true }); }, setItem() { throw new Error("Forms landing must not persist Web responses or form links"); } },
    fetch: (...args) => { posted.push(args); throw new Error("Forms-only follow-up must never POST to the Web survey"); },
    document: { documentElement: { lang: "ja" }, getElementById: id => elements[id], createElement: tag => new Element(tag),
      head: { appendChild(script) {
        scripts.push(script);
        const url = new URL(script.src); requests.push(url);
        const value = options.respond ? options.respond(url, requests.length) : response(url.searchParams.get("language"));
        setTimeout(() => context[url.searchParams.get("callback")](value), 0);
      } }
    }
  });
  context.window = context;
  const settle = async () => {
    for (let i = 0; i < 300; i++) {
      await new Promise(resolve => setTimeout(resolve, 1));
      if (elements.status.textContent && !/確認しています|Checking your participation/.test(elements.status.textContent)) return;
    }
    throw new Error("UI did not settle");
  };
  vm.runInContext(source, context, { filename: "followup-app.js" });
  await settle();
  return { elements, requests, scripts, timeouts, posted, settle, get storageReads() { return storageReads; } };
}
async function main() {
  const ready = await harness();
  check(ready.scripts[0].crossOrigin === "anonymous" && ready.scripts[0].referrerPolicy === "no-referrer", "Follow-up JSONP excludes Google account cookies and referrer");
  check(ready.timeouts.includes(45000), "Follow-up waits for the configured 45-second Google response window");
  check(ready.requests.length === 1 && ready.requests[0].searchParams.get("token") === fakeToken && ready.requests[0].searchParams.get("language") === "ja", "Landing verifies the private token and chosen language with GAS");
  check(ready.elements["forms-open"].href.startsWith("https://docs.google.com/forms/") && !ready.elements["forms-open"].href.includes(fakeToken), "Only the verified prefilled form is linked and the original token is never forwarded");
  check(!ready.elements["forms-panel"].classList.contains("hidden") && ready.elements["followup-form"].classList.contains("hidden"), "Forms landing replaces the Web questionnaire");
  check(ready.storageReads === 0, "Legacy completed/pending Web drafts are not used as evidence of Forms acceptance");
  await ready.elements["followup-form"].dispatch("submit");
  check(ready.posted.length === 0, "Even a forced old-form submit cannot send a Web follow-up");
  check(ready.elements["forms-notice"].textContent.includes("送信完了画面だけでは"), "Google thank-you screen is explicitly distinguished from accepted research data");
  ready.elements.language.value = "en";
  await ready.elements.language.dispatch("change"); await ready.settle();
  check(ready.requests.at(-1).searchParams.get("language") === "en" && ready.elements["forms-open"].textContent.includes("new tab"), "Language change revalidates a language-specific server link");

  for (const status of ["not_due", "expired", "completed"]) {
    const page = await harness({ respond: () => { const value = { ...response(), status }; if (status === "not_due") value.server_time = new Date(Date.parse(value.due_at) - 1000).toISOString(); if (status === "expired") value.server_time = new Date(Date.parse(value.expires_at) + 1000).toISOString(); return value; } });
    check(page.elements["forms-open"].getAttribute("href") === null && page.elements["followup-form"].classList.contains("hidden"), status + " never exposes either questionnaire");
    if (status === "completed") check(page.elements.status.textContent.includes("研究サーバーで回答の受理"), "Only server-confirmed completion is shown as accepted");
  }
  const accepted = await harness({ respond: (_url, count) => ({ ...response(), status: count === 1 ? "ready" : "completed" }) });
  await accepted.elements["forms-check"].dispatch("click"); await accepted.settle();
  check(accepted.requests.length === 2 && accepted.elements["forms-open"].getAttribute("href") === null && accepted.elements.status.textContent.includes("受理を確認"), "Acceptance refresh uses a new server status and removes stale form links");

  const invalid = [
    value => { value.ok = false; }, value => { value.schema_version = 1; }, value => { value.experiment_id = "other"; },
    value => { value.instrument_hash = "a".repeat(64); }, value => { value.measurement_mode = "web"; },
    value => { value.status = "completed"; value.measurement_mode = "web"; },
    value => { value.due_at = new Date(Date.parse(value.server_time) + 3600000).toISOString(); },
    value => { value.server_time = new Date(Date.parse(value.expires_at) + 1000).toISOString(); },
    value => { value.window_ends_at = new Date(Date.parse(value.expires_at) + 1000).toISOString(); },
    value => { value.forms.measurement_mode = "web"; }, value => { value.forms = null; },
    value => { value.forms.language = "en"; }, value => { value.forms.form_id = "bad"; },
    value => { value.forms.expires_at = "invalid"; }, value => { value.forms.expires_at = value.server_time; },
    value => { value.forms.expires_at = new Date(Date.parse(value.expires_at) + 1000).toISOString(); },
    ...["http://docs.google.com/forms/d/e/FIXTURE_FORM_ID/viewform?entry.1=proof", "https://docs.google.com.evil.invalid/forms/d/e/FIXTURE_FORM_ID/viewform?entry.1=proof", "javascript:alert(1)", "https://forms.gle/FIXTURE_FORM_ID", "https://user@docs.google.com/forms/d/e/FIXTURE_FORM_ID/viewform?entry.1=proof", "https://docs.google.com/forms/d/e/FIXTURE_FORM_ID/edit?entry.1=proof", "https://docs.google.com/forms/d/e/FIXTURE_FORM_ID/viewform", "https://docs.google.com/forms/d/e/FIXTURE_FORM_ID/viewform?entry.1=proof#frag", "https://docs.google.com/forms/d/e/FIXTURE_FORM_ID/viewform?entry.1=proof&next=evil", "https://docs.google.com/forms/d/e/FIXTURE_FORM_ID/viewform?entry.1=proof&entry.1=other", "https://docs.google.com/forms/d/e/FIXTURE_FORM_ID/viewform?entry.1=" + fakeToken].map(url => value => { value.forms.form_url = url; })
  ];
  for (let index = 0; index < invalid.length; index++) {
    const page = await harness({ respond: () => { const value = response(); invalid[index](value); return value; } });
    check(page.elements["forms-open"].getAttribute("href") === null && page.elements["forms-panel"].classList.contains("hidden") && page.posted.length === 0, "Untrusted Forms response " + index + " fails closed");
  }
  const alternate = await harness({ respond: () => { const value = response(); value.forms.form_url = "https://docs.google.com/forms/d/FIXTURE_EDITOR_FORM_ID/viewform?entry.1=proof"; return value; } });
  check(Boolean(alternate.elements["forms-open"].href), "Official editor-ID viewform URL is also accepted");
  const unapproved = await harness({ unapproved: true });
  check(unapproved.requests.length === 0 && unapproved.elements["forms-open"].getAttribute("href") === null, "Real unresolved research approvals stop production before network or form links");
  const preview = await harness({ local: true, preview: true, unapproved: true });
  check(preview.requests.length === 0 && preview.posted.length === 0 && !preview.elements["forms-panel"].classList.contains("hidden") && preview.elements["forms-open"].getAttribute("href") === null, "Local preview explains the Forms flow without any live URL or network");
  check(preview.elements["forms-check"].disabled && preview.storageReads === 0, "Preview cannot simulate accepted data using old local drafts");
  for (const hash of ["", "#token=invalid", "#token=" + fakeToken + "&token=" + fakeToken]) {
    const page = await harness({ hash });
    check(page.requests.length === 0 && page.elements["forms-open"].getAttribute("href") === null, "Invalid or ambiguous original token never contacts GAS");
  }
  const html = fs.readFileSync(path.join(root, "followup.html"), "utf8");
  check(/id="forms-open"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*referrerpolicy="no-referrer"/.test(html), "Google link blocks opener access and referrer leakage");
  console.log("PASS: " + assertions + " followup Forms UI assertions (mock DOM/JSONP only)");
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
