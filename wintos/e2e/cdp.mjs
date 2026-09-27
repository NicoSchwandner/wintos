// Drives a running WintOS dev build (wintos/dev.sh, debug port 9223) for UI checks.
// usage: node cdp.mjs shot <out.png> | eval '<js>' | key <key>
const [, , cmd, arg] = process.argv;
const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("index.html"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const call = (method, params = {}) =>
  new Promise((res) => {
    const my = ++id;
    ws.addEventListener("message", function h(m) {
      const d = JSON.parse(m.data);
      if (d.id === my) { ws.removeEventListener("message", h); res(d.result ?? d.error); }
    });
    ws.send(JSON.stringify({ id: my, method, params }));
  });
await new Promise((r) => ws.addEventListener("open", r));
if (cmd === "shot") {
  const r = await call("Page.captureScreenshot", { format: "png" });
  (await import("fs")).writeFileSync(arg, Buffer.from(r.data, "base64"));
  console.log("saved", arg);
} else if (cmd === "eval") {
  const r = await call("Runtime.evaluate", { expression: arg, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result?.value ?? r));
} else if (cmd === "type") {
  await call("Runtime.evaluate", { expression: `[...document.querySelectorAll(".xterm-helper-textarea")][${Number(process.env.TI||0)}].focus()` });
  await call("Input.insertText", { text: arg });
  for (const type of ["keyDown", "keyUp"]) await call("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: type === "keyDown" ? "\r" : undefined });
  console.log("typed");
} else if (cmd === "raw") {
  await call("Runtime.evaluate", { expression: `[...document.querySelectorAll(".xterm-helper-textarea")][${Number(process.env.TI||0)}].focus()` });
  await call("Input.insertText", { text: JSON.parse('"' + arg + '"') });
  console.log("raw");
} else if (cmd === "key") {
  for (const type of ["keyDown", "keyUp"]) await call("Input.dispatchKeyEvent", { type, key: arg, text: type === "keyDown" && arg.length === 1 ? arg : undefined, windowsVirtualKeyCode: arg === "Enter" ? 13 : arg.toUpperCase().charCodeAt(0) });
  console.log("key", arg);
}
ws.close();
