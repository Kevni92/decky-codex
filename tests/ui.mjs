import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = resolve(".");
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/") { res.setHeader("Content-Type", "text/html"); res.end('<html><body style="margin:0"><div id="root"></div><script>window.process={env:{NODE_ENV:"production"}}</script><script src="/out/ui-host.js"></script></body></html>'); return; }
    const path = resolve(root, "." + req.url);
    if (!path.startsWith(root + "/")) throw Error("path");
    res.setHeader("Content-Type", "text/javascript"); res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const packagedChromium = require("@sparticuz/chromium");
const browser = await chromium.launch({ headless: true, args: packagedChromium.args,
  executablePath: process.env.CHROMIUM_PATH || await packagedChromium.executablePath() });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error("Browser error:", error.message); });
  page.on("console", message => { if (message.type() === "error") console.error("Browser console:", message.text()); });
  page.on("requestfailed", request => console.error("Failed request:", request.url(), request.failure()));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("heading", { name: "Speicherübersicht" }).waitFor();
  assert.equal(await page.getByRole("table").count(), 2);
  assert.equal(await page.locator("img").count(), 0);
  await page.getByRole("button", { name: /Aktivitäten – technische Details/ }).click();
  await page.getByText("Exakter Werkzeugschritt: 42 Dateien geprüft").waitFor();
  await page.getByRole("button", { name: "☐", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__test.calls.filter(c => c.method === "cleanup").length), 0);
  await page.getByRole("button", { name: "Auswahl in Papierkorb …" }).click();
  await page.getByRole("heading", { name: "Auswahl in den Papierkorb verschieben?" }).waitFor();
  await page.getByRole("button", { name: "Abbrechen / Ablehnen" }).click();
  await page.evaluate(() => window.__test.request("question"));
  await page.getByRole("button", { name: "Lokale Installation", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__test.calls.filter(c => c.method === "resolve").at(-1).params.choice), "x");
  await page.evaluate(() => window.__test.request("password"));
  const password = page.getByLabel("Linux-Benutzerpasswort", { exact: true });
  assert.equal(await password.getAttribute("type"), "password");
  await password.fill("not-a-real-password");
  await page.getByRole("button", { name: "Authentifizieren", exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.stringify(window.__test.state).includes("not-a-real-password")), false);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: "out/ui-preview.png", fullPage: true });
  console.log("Rendered compiled plugin: tables, HTML safety, activity panel, choices, cleanup confirmation and masked password passed");
} finally { await browser.close(); server.close(); }
