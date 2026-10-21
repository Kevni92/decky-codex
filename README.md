# Decky Codex

Ein Codex-Assistent im Gaming-Modus des Steam Decks. **Vorschau 0.1.0**.

## Installation

1. [GitHub Releases](https://github.com/Kevni92/decky-codex/releases) öffnen.
2. Das Release-Asset **Decky Codex.zip** herunterladen. Nicht „Source code (zip)“.
3. In Decky Loader die Entwickleroptionen aktivieren und „Plugin aus ZIP installieren“ wählen.
4. Decky Codex öffnen, **Chat öffnen → Einstellungen → Mit ChatGPT anmelden**.
5. Die offizielle Gerätecode-Adresse am Smartphone oder Deck öffnen und den Code bestätigen.
   Gerätecode-Anmeldung gegebenenfalls vorher im ChatGPT-Konto erlauben.

Die native Linux-x86_64-Codex-Runtime ist enthalten. Node/npm ist auf dem Deck nicht
erforderlich. Du benötigst Decky Loader, Internet und ein für Codex berechtigtes
ChatGPT-Konto. Es gelten dessen Kontingente; keine automatische API-Abrechnung.

## Funktionen

- Gestreamter deutscher Chat mit Markdown, Tabellen und aufklappbaren Aktivitäten.
- Lokaler Verlauf, Titel, neue Chats und echte Codex-Verlaufslöschung.
- Auswahlfragen mit erklärten Optionen; Installer mit fortlaufender Ausgabe und Eingaben.
- Große Dateien untersuchen, bekannte Steam-Bibliotheken/Spieldaten ausschließen und
  ausgewählte Dateien nach Bestätigung in den Papierkorb verschieben.
- Hostbefehle einzeln freigeben. Root-Aufträge zusätzlich mit lokalem Linux-Passwort.
- Mitgelieferte AGENTS.md und sechs auf Steam Deck zugeschnittene Skills.

## Rechte und Daten

Native Codex-Werkzeuge starten lesend mit geschützten Geheimnisverzeichnissen.
Ein ausdrücklich freigegebener Hostbefehl läuft außerhalb dieser Lesesandbox mit
Benutzerrechten; ein Root-Auftrag hat echte Administratorrechte. Das Passwort
bleibt im lokalen Auth-Kanal und wird nicht an das Modell gesendet. Kein `_root`-Flag,
keine dauerhafte Root-Sitzung, keine NOPASSWD-Einrichtung.

Chats und Codex-Anmeldedaten liegen im privaten Decky-Datenverzeichnis. Dateiinhalte
und Ausgaben, die Codex für deine Aufgabe verwendet, können an OpenAI übermittelt
werden. Keine zusätzliche Plugin-Telemetrie. Der Speicher-Scan liest Dateimetadaten,
keine Dokumentinhalte. Der Papierkorb gibt erst nach Leerung Speicher frei.

## Grenzen dieser Vorschau

Build, Backendtests, reale PTY-Steuerung und der echte lokale Codex-Protokollstart
werden automatisiert geprüft. Ein echtes Steam Deck steht in der Entwicklungsumgebung
nicht zur Verfügung: Gaming-Modus, Bildschirmtastatur, Kontozugang und sudo/PAM
müssen deshalb am Gerät geprüft werden. Fehler bitte mit Plugin-/Decky-Version und
bereinigter Fehlermeldung melden; niemals Passwörter oder auth.json anhängen.

Grafische Installer und komplexe Vollbild-Terminalmenüs können manuelle Schritte
erfordern. EmuDeck wird nicht als vollständig unbeaufsichtigt installierbar zugesagt.
Ein Scan kann wegen Zugriffsrechten unvollständig sein. Unvollständig erkannte
Steam-Bibliotheken sperren die integrierte Bereinigung. Gegen absichtliche Manipulation
durch andere Prozesse desselben Benutzers oder Root gibt es keine vollständige Isolation.

## Entwicklung und Veröffentlichung

`npm ci`, `npm run typecheck`, `npm run build`, `npm test`,
`python3 scripts/prepare_runtime.py`, `python3 scripts/smoke.py`,
`python3 scripts/package.py`.

PRs bauen und prüfen die ZIP als Actions-Artefakt. Nach Merge auf `main` veröffentlicht
derselbe Workflow die geprüften Bytes als nummeriertes Preview-Release. Keine persönlichen
Tokens oder ChatGPT-Anmeldedaten in CI. Paketdatei, SHA256SUMS und build.json sind
direkt im Release verfügbar. Das äußere Actions-Artefaktarchiv ist nicht die Plugin-ZIP.

[Technischer Plan](docs/IMPLEMENTIERUNGSPLAN.md) · [Kompatibilität](docs/COMPATIBILITY.md)

## Falls „Verbindung wird hergestellt …“ stehen bleibt

Die aktuelle Release-ZIP erneut installieren und Decky neu starten. Nach spätestens
zehn Sekunden erscheint bei fehlender Backend-Antwort eine Fehlermeldung mit
„Erneut verbinden“. Startfehler werden direkt angezeigt und unter
`~/homebrew/logs/Decky Codex/` protokolliert (bei abweichendem Decky-Verzeichnis
entsprechend dort). Für einen Fehlerbericht genügt zunächst der angezeigte
Fehlertext; keine Anmeldedateien oder Passwörter weitergeben.
