"use strict";

// Isolated fake DOM / timers. This test neither contacts Google nor writes study data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const source = fs.readFileSync(path.join(__dirname, "../connection-check.js"), "utf8");
let assertions = 0;
function check(value, message) { assertions++; assert.ok(value, message); }
const endpoint = "https://script.google.com/macros/s/DIAGNOSTIC_FIXTURE_ONLY/exec";
function harness(options = {}) {
  let click;
  const button = { disabled: false, addEventListener(type, handler) { if (type === "click") click = handler; } };
  const status = { textContent: "initial" };
  const requests = [];
  const timers = new Map();
  let nextTimer = 0;
  const head = {
    appendChild(script) {
      if (options.appendThrows) throw new Error("fixture append failure");
      script.parentNode = this;
      requests.push(script);
    },
    removeChild(script) { script.parentNode = null; }
  };
  const sandbox = {
    URL, Uint8Array, Array, Set, Number, Math, crypto: crypto.webcrypto,
    EXPERIMENT_CONFIG: options.config || { serverEndpoint: endpoint, jsonp: { callbackParameter: "callback", timeoutMs: 45000 } },
    location: { href: "https://fixture.github.io/?store=C&participant_id=PRIVATE_ID&email=private@research.invalid#token=private" },
    localStorage: new Proxy({}, { get() { throw new Error("Diagnostics must not read localStorage"); } }),
    sessionStorage: new Proxy({}, { get() { throw new Error("Diagnostics must not read sessionStorage"); } }),
    fetch() { throw new Error("Diagnostics must not POST or fetch participant data"); },
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    document: {
      getElementById(id) { return id === "connectionCheckButton" ? button : id === "connectionCheckStatus" ? status : null; },
      createElement(tag) { assert.equal(tag, "script"); return {}; }, head
    }
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: "connection-check.js" });
  return { button, status, requests, timers, context, click: () => click(),
    callback(script = requests.at(-1)) { return new URL(script.src).searchParams.get("callback"); },
    respond(payload, script = requests.at(-1)) { context[this.callback(script)](payload); },
    fire(delay) {
      const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, "Expected timer " + delay);
      timers.delete(entry[0]); entry[1].fn();
    }
  };
}

const ready = harness();
check(ready.requests.length === 0, "Diagnostic never sends a request before the user clicks");
ready.click();
const first = ready.requests[0];
const url = new URL(first.src);
check(url.origin === "https://script.google.com" && url.pathname === "/macros/s/DIAGNOSTIC_FIXTURE_ONLY/exec", "The request targets only the configured public GAS deployment");
check([...url.searchParams.keys()].sort().join(",") === "action,callback,schema_version", "The request contains no participant, session, answer, email, token or page URL");
check(url.searchParams.get("action") === "connectivity_probe" && url.searchParams.get("schema_version") === "2", "Diagnostic uses an unsupported, non-writing action");
check(/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(ready.callback()), "Callback is a fresh valid GAS identifier");
check(first.async === true && first.crossOrigin === "anonymous" && first.referrerPolicy === "no-referrer", "JSONP excludes cross-origin Google credentials and page referrer");
check(ready.button.disabled && ready.status.textContent.includes("45秒") && [...ready.timers.values()].some(timer => timer.delay === 45000), "Slow Google responses have a 45-second response window");
ready.click();
check(ready.requests.length === 1, "Repeated clicks do not create overlapping diagnostic requests");
ready.respond({ ok: false, error: "invalid_action", message: "ignored private response" });
check(ready.status.textContent.includes("接続できました") && ready.status.textContent.includes("実験完了の確認ではありません"), "Expected rejection proves reachability without claiming study submission completion");
check(!ready.status.textContent.includes("private") && !ready.button.disabled && first.parentNode === null && typeof ready.context[ready.callback(first)] === "undefined", "Success restores controls and removes script/callback without displaying server details");
ready.click();
check(ready.callback() !== ready.callback(first), "A new check uses a different random callback");
ready.respond({ ok: true, error: "invalid_action" });
check(ready.status.textContent.includes("unexpected_response") && !ready.status.textContent.includes("接続できました"), "Only the expected ok=false invalid_action shape is considered connected");

for (const payload of [null, {}, { ok: false, error: "<img src=x onerror=private>" }, { ok: false, error: "private_token_123" }]) {
  const page = harness(); page.click(); page.respond(payload);
  check(page.status.textContent.includes("unexpected_response") && !page.status.textContent.includes("private") && !page.status.textContent.includes("<img"), "Unknown or malformed responses are displayed as one sanitized static code");
}
const closed = harness(); closed.click(); closed.respond({ ok: false, error: "production_closed", message: "PRIVATE_DETAIL" });
check(closed.status.textContent.includes("production_closed") && !closed.status.textContent.includes("PRIVATE_DETAIL"), "Known public errors are preserved without exposing response messages");

for (const fail of ["timeout", "network_error", "append_failure"]) {
  const page = harness({ appendThrows: fail === "append_failure" }); page.click();
  const script = page.requests[0];
  if (fail === "timeout") page.fire(45000);
  if (fail === "network_error") script.onerror();
  const code = fail === "timeout" ? "timeout" : "network_error";
  check(page.status.textContent.includes("（" + code + "）") && !page.button.disabled, "A " + fail + " restores controls with the appropriate static code");
  if (!script) continue;
  const callback = page.callback(script);
  const failedStatus = page.status.textContent;
  check(typeof page.context[callback] === "function" && script.parentNode === null, "Failed JSONP retains a bounded inert callback for late responses");
  page.context[callback]({ ok: false, error: "invalid_action" });
  check(page.status.textContent === failedStatus, "A late response cannot change the completed diagnostic result");
  page.click();
  check(page.requests.length === 2 && page.callback() !== callback, "Retry after failure starts a separate diagnostic callback");
  page.fire(360000);
  check(typeof page.context[callback] === "undefined", "The inert late callback is removed after the bounded cleanup window");
}

for (const url of [
  "http://script.google.com/macros/s/FIXTURE/exec", "https://script.google.com.evil.invalid/macros/s/FIXTURE/exec",
  "https://user:secret@script.google.com/macros/s/FIXTURE/exec", "https://script.google.com:8443/macros/s/FIXTURE/exec",
  "https://script.google.com/macros/s/FIXTURE/dev", endpoint + "?participant_id=PRIVATE", endpoint + "#private"
]) {
  const page = harness({ config: { serverEndpoint: url, jsonp: { callbackParameter: "callback", timeoutMs: 45000 } } });
  page.click();
  check(page.requests.length === 0 && page.status.textContent.includes("invalid_configuration"), "Untrusted endpoints are rejected before any request");
}
for (const jsonp of [null, {}, { callbackParameter: "private", timeoutMs: 45000 }, { callbackParameter: "callback", timeoutMs: 999 }, { callbackParameter: "callback", timeoutMs: 120001 }, { callbackParameter: "callback", timeoutMs: 45000.5 }]) {
  const page = harness({ config: { serverEndpoint: endpoint, jsonp } }); page.click();
  check(page.requests.length === 0 && page.status.textContent.includes("invalid_configuration"), "Malformed diagnostic configuration fails without network activity");
}
console.log("PASS: " + assertions + " connection diagnostic assertions (fake DOM / timers only)");
