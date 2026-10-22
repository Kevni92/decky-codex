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
    const luminance = color => color.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const background = element => {
      const color = rgb(getComputedStyle(element).backgroundColor), alpha = color[3] ?? 1;
      if (alpha === 1) return color;
      const parent = element.parentElement ? background(element.parentElement) : [255, 255, 255];
      return color.slice(0, 3).map((value, index) => value * alpha + parent[index] * (1 - alpha));
    };
    return cells.map(cell => {
      const fg = luminance(rgb(getComputedStyle(cell).color)), bg = luminance(background(cell));
      return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
    });
  });
  assert.ok(tableContrast.every(value => value >= 4.5), "Table cells must have readable contrast");
  assert.equal(await page.locator("textarea").count(), 0);
  assert.equal(await page.getByRole("button", { name: /Große Dateien untersuchen|Scan stoppen|Auswahl in Papierkorb/ }).count(), 0);
  assert.equal(await page.getByRole("combobox").count(), 0);
  assert.equal(await page.getByText("Exakter Werkzeugschritt: 42 Dateien geprüft").count(), 0);
  const sidebar = page.getByRole("complementary", { name: "Chats und Navigation" });
  const sidebarBox = await sidebar.boundingBox();
  assert.ok(sidebarBox.width >= 280);
  const collapseBox = await page.getByRole("button", { name: "Seitenleiste einklappen", exact: true }).boundingBox();
  assert.ok(sidebarBox.x + sidebarBox.width - collapseBox.x - collapseBox.width >= 18);
  const settingsBox = await page.getByRole("button", { name: "Einstellungen", exact: true }).boundingBox();
  const backBox = await page.getByRole("button", { name: "Zurück zu Steam", exact: true }).boundingBox();
  assert.ok(backBox.y - settingsBox.y - settingsBox.height >= 9);
  for (const text of ["Neuer Chat", "Einstellungen", "Zurück zu Steam"]) {
    const label = page.getByRole("button", { name: text, exact: true }).locator(".dc-truncate");
    assert.ok(await label.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  }
  assert.equal(await sidebar.getAttribute("flow-children"), "column");
  assert.equal(await page.locator(".dc-sidebar-bottom").getAttribute("flow-children"), "column");
  assert.equal(await page.locator(".dc-app").getAttribute("flow-children"), "row");
  const newChat = page.getByRole("button", { name: "Neuer Chat", exact: true });
  await newChat.focus(); await newChat.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), "Alle Chats");
  await page.getByRole("button", { name: "Einstellungen", exact: true }).focus();
  await page.getByRole("button", { name: "Einstellungen", exact: true }).press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), "Zurück zu Steam");
  // Scroll messages must reach the transcript even while a sidebar button owns focus.
  const original = await page.evaluate(() => window.__test.state.chat.messages[1].text);
  await page.evaluate(() => { window.__test.state.chat.messages[1].text += "\n\n" + "Langer Antworttext.\n\n".repeat(70); window.__test.publish(); });
  await page.waitForTimeout(100);
  await page.locator(".dc-transcript").evaluate(el => { el.scrollTop = 300; });
  await page.evaluate(() => window.__test.analog(0, 47, 1, 0, 1));
  assert.ok(await page.locator(".dc-transcript").evaluate(el => el.scrollTop < 300));
  const scrollBefore = await page.locator(".dc-transcript").evaluate(el => el.scrollTop);
  await page.evaluate(() => window.__test.analog(0, 47, 1, 0, -1));
  assert.ok((await page.locator(".dc-transcript").evaluate(el => el.scrollTop)) > scrollBefore);
  await page.evaluate(text => { window.__test.state.chat.messages[1].text = text; window.__test.publish(); }, original);
  await page.waitForTimeout(100);
  await page.screenshot({ path: "out/ui-chat.png" });
  await page.getByRole("button", { name: /Aktivitäten – technische Details/ }).click();
  await page.getByText("Exakter Werkzeugschritt: 42 Dateien geprüft").waitFor();
  await page.getByRole("button", { name: /Aktivitäten – technische Details/ }).click();
  const input = page.getByRole("textbox", { name: "Nachricht an Codex", exact: true });
  assert.equal(await input.getAttribute("data-native-steam-field"), "true");
  const aligned = await input.evaluate(el => {
    const box = el.getBoundingClientRect(), composer = el.closest(".dc-composer").getBoundingClientRect();
    return Math.abs(box.y + box.height / 2 - composer.y - composer.height / 2) < 1 && getComputedStyle(el).paddingTop === "0px" && getComputedStyle(el).paddingBottom === "0px";
  });
  assert.equal(aligned, true, "Native input/caret must be centered without asymmetric Steam padding");
  assert.equal(await input.getAttribute("placeholder"), "Frag Codex etwas …");
  await input.click();
  assert.equal(await input.isVisible(), true);
  assert.equal(await page.evaluate(() => window.__test.keyboardOpen), true);
  await page.evaluate(() => window.__test.keyboardProps.onTextEntered("Installiere Programm X"));
  assert.equal(await input.inputValue(), "Installiere Programm X");
  await input.evaluate(el => el.setSelectionRange(el.value.length - 1, el.value.length));
  await page.evaluate(() => window.__test.keyboardProps.onTextEntered("Y"));
  assert.equal(await input.inputValue(), "Installiere Programm Y");
  await page.evaluate(() => { window.__test.keyboardProps.onTextEntered("Backspace"); window.__test.keyboardProps.onTextEntered("X"); window.__test.keyboardProps.onTextEntered("😀"); window.__test.keyboardProps.onTextEntered("Backspace"); });
  assert.equal(await input.inputValue(), "Installiere Programm X");
  await page.evaluate(() => window.__test.keyboardProps.onEnterKeyPress());
  assert.equal(await page.evaluate(() => window.__test.keyboardOpen), false);
  await page.getByRole("button", { name: "Tastatur öffnen: Nachricht an Codex", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__test.keyboardOpen), true);
  await page.evaluate(() => window.__test.keyboardProps.onEnterKeyPress());
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
  // Return pops the native backstack, rather than pushing another chat route.
  await page.getByRole("button", { name: "Zurück zum Chat", exact: true }).click();
  await page.getByRole("heading", { name: "Speicherübersicht" }).waitFor();
  assert.equal(await page.evaluate(() => window.__test.path), "/decky-codex");
  assert.equal(await input.inputValue(), "Installiere Programm X");
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click();
  await page.getByRole("heading", { name: "Einstellungen", exact: true }).waitFor();
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
  await password.click();
  await page.evaluate(() => window.__test.keyboardProps.onTextEntered("not-a-real-password"));
  assert.equal(await password.inputValue(), "not-a-real-password");
  await page.getByRole("button", { name: "Authentifizieren", exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.stringify(window.__test.state).includes("not-a-real-password")), false);
  await page.evaluate(() => window.__test.keyboardProps.onTextEntered("late-callback-must-not-leak"));
  assert.equal(await input.inputValue(), "");
  await page.getByRole("button", { name: "Neuer Chat", exact: true }).click();
  await page.getByRole("heading", { name: "Wobei kann ich dir helfen?", exact: true }).waitFor();
  await page.screenshot({ path: "out/ui-empty.png" });
  // Steam Deck 720p layout: no document overflow; composer stays in view.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => { document.getElementById("root").style.marginTop = "48px"; });
  await page.waitForTimeout(100);
  await page.getByRole("button", { name: "Seitenleiste einklappen", exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 1280 && document.documentElement.scrollHeight <= 720), true);
  const composerBox = await input.boundingBox();
  assert.ok(composerBox.y >= 40 && composerBox.y + composerBox.height <= 720 - 28);
  await page.getByRole("button", { name: "Seitenleiste öffnen", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => { document.getElementById("root").style.marginTop = "0"; });
  // A native keyboard failure is visible and can be retried without losing text.
  await page.evaluate(() => { window.__test.keyboardUnavailable = true; });
  await page.getByRole("button", { name: "Tastatur öffnen: Nachricht an Codex", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Test: Steam keyboard unavailable" }).waitFor();
  await page.evaluate(() => { window.__test.keyboardUnavailable = false; });
  await page.getByRole("button", { name: "Tastatur öffnen: Nachricht an Codex", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__test.keyboardOpen), true);
  await page.evaluate(() => window.__test.keyboardProps.onEnterKeyPress());
  // Dictation is explicit, editable and never automatically sends a request.
  const sendsBeforeVoice = await page.evaluate(() => window.__test.calls.filter(c => c.method === "send").length);
  await page.getByRole("button", { name: "Spracheingabe starten", exact: true }).click();
  await page.getByRole("button", { name: "Aufnahme beenden", exact: true }).waitFor();
  await page.screenshot({ path: "out/ui-voice.png" });
  assert.equal(await input.isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Nachricht senden", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Aufnahme beenden", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('input[aria-label="Nachricht an Codex"]').value === "Installiere bitte Programm X");
  assert.equal(await input.isEnabled(), true);
  assert.equal(await page.evaluate(() => window.__test.calls.filter(c => c.method === "send").length), sendsBeforeVoice);
  await page.getByRole("button", { name: "Spracheingabe starten", exact: true }).click();
  await page.getByRole("button", { name: "Aufnahme beenden", exact: true }).waitFor();
  await page.getByRole("button", { name: "Verwerfen", exact: true }).click();
  await page.getByRole("button", { name: "Spracheingabe starten", exact: true }).waitFor();
  assert.equal(await input.inputValue(), "Installiere bitte Programm X");
  await page.evaluate(() => { window.__test.voiceFailure = true; });
  await page.getByRole("button", { name: "Spracheingabe starten", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Test: Mikrofon fehlt" }).waitFor();
  await page.evaluate(() => { window.__test.voiceFailure = false; });
  await page.getByRole("button", { name: "Spracheingabe starten", exact: true }).click();
  await page.getByRole("button", { name: "Aufnahme beenden", exact: true }).waitFor();
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click();
  await page.waitForFunction(() => window.__test.voiceState === "idle");
  await page.getByRole("button", { name: "Zurück zum Chat", exact: true }).click();
  assert.equal(await input.inputValue(), "Installiere bitte Programm X");
  // Leaving the chat after returning from settings must not reopen settings.
  await page.getByRole("button", { name: "Zurück zu Steam", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__test.closed), true);
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
  console.log("Rendered compiled plugin: actual Steam input wrappers, owning-window keyboard invocation and text callbacks, masked password, sidebar spacing, viewport offsets, settings and chat flows passed");
} finally { await browser.close(); server.close(); }
