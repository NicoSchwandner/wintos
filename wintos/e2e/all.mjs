// Evaluate JS in every WintOS renderer (one per cached tab), or in the first one with a sidebar.
// usage: node all.mjs '<js>' [first]
const [expr, first] = process.argv.slice(2);
const list = (await (await fetch(`http://127.0.0.1:${process.env.WINTOS_DEBUG_PORT ?? 9224}/json/list`)).json()).filter((t) => t.type === "page" && t.url.includes("index.html"));
const evalIn = async (t, expression) => {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const res = await new Promise((r) => { ws.addEventListener("message", (m) => r(JSON.parse(m.data))); ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } })); });
  ws.close(); return res.result?.result?.value;
};
if (first) {
  for (const t of list) if ((await evalIn(t, 'document.querySelectorAll("[data-tabid]").length')) > 0) { console.log(await evalIn(t, expr)); break; }
} else {
  console.log("renderers:", list.length);
  for (const t of list) console.log(t.id.slice(0, 6), await evalIn(t, expr));
}
