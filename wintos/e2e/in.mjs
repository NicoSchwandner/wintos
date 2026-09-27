// Drive one renderer by target-id prefix (from all.mjs).
// usage: node in.mjs <prefix> '<js>' | <prefix> --type '<text>' | <prefix> --shot out.png
const [, , prefix, a, b] = process.argv;
const t = (await (await fetch("http://127.0.0.1:9223/json/list")).json()).find((x) => x.id.startsWith(prefix));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const call = (method, params = {}) => new Promise((res) => { const my = ++id; ws.addEventListener("message", function h(m) { const d = JSON.parse(m.data); if (d.id === my) { ws.removeEventListener("message", h); res(d.result); } }); ws.send(JSON.stringify({ id: my, method, params })); });
if (a === "--type") {
  await call("Runtime.evaluate", { expression: 'document.querySelector(".xterm-helper-textarea").focus()' });
  await call("Input.insertText", { text: b + "\r" });
  console.log("typed");
} else if (a === "--shot") {
  const r = await call("Page.captureScreenshot", { format: "png" });
  (await import("fs")).writeFileSync(b, Buffer.from(r.data, "base64")); console.log("saved");
} else console.log(JSON.stringify((await call("Runtime.evaluate", { expression: a, returnByValue: true, awaitPromise: true })).result?.value));
ws.close();
