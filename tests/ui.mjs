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
    if (req.url.split("?")[0] === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end('<html><head><meta charset="utf-8"></head><body style="margin:0"><div id="root"></div><script>window.process={env:{NODE_ENV:"production"}}</script><script src="/out/ui-host.js"></script></body></html>'); return; }
    const path = resolve(root, "." + req.url);
    if (!path.startsWith(root + "/")) throw Error("path");
    res.setHeader("Content-Type", "text/javascript; charset=utf-8"); res.end(await readFile(path));
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
  await page.waitForTimeout(500);
  console.log("Initial rendered DOM:", (await page.locator("body").innerText()).slice(0, 2500));
  await page.getByRole("heading", { name: "Speicherübersicht" }).waitFor();
  assert.equal(await page.getByRole("table").count(), 1);
  assert.equal(await page.locator("img").count(), 0);
  const tableContrast = await page.locator("td, th").evaluateAll(cells => {
    const rgb = color => color.match(/[\d.]+/g).map(Number);
    const luminance = color => rgb(color).slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    return cells.map(cell => {
      let element = cell;
      while (element.parentElement && rgb(getComputedStyle(element).backgroundColor)[3] === 0) element = element.parentElement;
      const fg = luminance(getComputedStyle(cell).color), bg = luminance(getComputedStyle(element).backgroundColor);
      return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
    });
  });
  assert.ok(tableContrast.every(value => value >= 4.5), "Table cells must have readable contrast");
  assert.equal(await page.locator("textarea").count(), 0);
  assert.equal(await page.getByRole("button", { name: /Große Dateien untersuchen|Scan stoppen|Auswahl in Papierkorb/ }).count(), 0);
  assert.equal(await page.getByRole("combobox").count(), 0);
  assert.equal(await page.getByText("Exakter Werkzeugschritt: 42 Dateien geprüft").count(), 0);
  await page.screenshot({ path: "out/ui-chat.png" });
  await page.getByRole("button", { name: /Aktivitäten – technische Details/ }).click();
  await page.getByText("Exakter Werkzeugschritt: 42 Dateien geprüft").waitFor();
  await page.getByRole("button", { name: /Aktivitäten – technische Details/ }).click();
  const input = page.getByRole("textbox", { name: "Nachricht an Codex", exact: true });
  assert.equal(await input.getAttribute("data-native-steam-field"), "true");
  await input.click();
  await input.fill("Installiere Programm X");
  await input.press("Enter");
  assert.equal(await page.evaluate(() => window.__test.keyboardActivations > 0), true);
  assert.equal(await page.evaluate(() => window.__test.calls.some(c => c.method === "send")), false);
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click();
  await page.getByRole("heading", { name: "Einstellungen", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__test.path), "/decky-codex/settings");
  assert.equal(await page.getByRole("textbox", { name: "Nachricht an Codex", exact: true }).count(), 0);
  assert.equal(await page.getByRole("heading", { name: "Speicherübersicht" }).count(), 0);
  assert.equal(await page.getByRole("complementary", { name: "Chats und Navigation" }).count(), 0);
  await page.getByRole("combobox", { name: "Modell", exact: true }).selectOption("other");
  await page.screenshot({ path: "out/ui-settings.png" });
  // A request arriving while settings are open remains discoverable.
  await page.evaluate(() => window.__test.request("question"));
  await page.getByRole("button", { name: "Entscheidung öffnen", exact: true }).click();
  await page.getByRole("heading", { name: "X oder Y?" }).waitFor();
  assert.equal(await input.inputValue(), "Installiere Programm X");
  await page.getByRole("button", { name: /Lokale Installation/ }).click();
  assert.equal(await page.evaluate(() => window.__test.calls.filter(c => c.method === "resolve").at(-1).params.choice), "x");
  // Draft recovery and one explicit send through the native control.
  await page.evaluate(() => { window.__test.failSend = true; });
  await page.getByRole("button", { name: "Nachricht senden", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Senden fehlgeschlagen" }).waitFor();
  assert.equal(await input.inputValue(), "Installiere Programm X");
  await page.evaluate(() => { window.__test.failSend = false; });
  await input.press("Control+Enter");
  await page.getByText("Installiere Programm X", { exact: true }).waitFor();
  assert.equal(await input.inputValue(), "");
  assert.equal(await page.evaluate(() => window.__test.calls.filter(c => c.method === "send").at(-1).params.model), "other");
  assert.equal(await page.evaluate(() => window.__test.calls.some(c => ["scan", "cleanup", "cancel_scan"].includes(c.method))), false);
  await page.evaluate(() => window.__test.request("password"));
  const password = page.getByLabel("Linux-Benutzerpasswort", { exact: true });
  assert.equal(await password.getAttribute("type"), "password");
  await password.fill("not-a-real-password");
  await page.getByRole("button", { name: "Authentifizieren", exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.stringify(window.__test.state).includes("not-a-real-password")), false);
  await page.getByRole("button", { name: "Neuer Chat", exact: true }).click();
  await page.getByRole("heading", { name: "Wobei kann ich dir helfen?", exact: true }).waitFor();
  await page.screenshot({ path: "out/ui-empty.png" });
  // Steam Deck 720p layout: no document overflow; composer stays in view.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Seitenleiste einklappen", exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 1280 && document.documentElement.scrollHeight <= 720), true);
  const composerBox = await input.boundingBox();
  assert.ok(composerBox.y >= 40 && composerBox.y + composerBox.height <= 720 - 28);
  await page.getByRole("button", { name: "Seitenleiste öffnen", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.deepEqual(errors, []);
  // A dead Decky backend must stop showing the indefinite connection screen.
  await page.goto(`http://127.0.0.1:${server.address().port}/?transport=hang`);
  await page.getByRole("status").filter({ hasText: "Verbindung wird hergestellt" }).waitFor();
  await page.getByRole("alert").filter({ hasText: "Das Backend antwortet nicht" }).waitFor({ timeout: 13000 });
  assert.equal(await page.evaluate(() => window.__test.calls.length), 1);
  await page.evaluate(() => { window.__test.transport = null; });
  await page.getByRole("button", { name: "Erneut verbinden", exact: true }).click();
  await page.getByRole("heading", { name: "Speicherübersicht" }).waitFor();
  await page.goto(`http://127.0.0.1:${server.address().port}/?transport=reject`);
  await page.getByRole("alert").filter({ hasText: "example_missing_module" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Erneut verbinden", exact: true }).isEnabled(), true);
  await page.evaluate(() => { window.__test.transport = null; });
  await page.getByRole("button", { name: "Erneut verbinden", exact: true }).click();
  await page.getByRole("heading", { name: "Speicherübersicht" }).waitFor();
  assert.deepEqual(errors, []);
  console.log("Backend startup: stalled transport times out, import errors are visible, reconnect recovers without mutation");
  await page.screenshot({ path: "out/ui-preview.png", fullPage: true });
  console.log("Rendered compiled plugin: chat layout, native Steam input contract, separate settings route, draft recovery, model selection, choices, password isolation and viewport layout passed");
} finally { await browser.close(); server.close(); }
