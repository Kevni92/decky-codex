# Kompatibilität und Prüfstatus

Vorschau 0.1.0, 21. Oktober 2026.

| Komponente | Festgelegter Stand |
| --- | --- |
| Zielgerät | Steam Deck LCD/OLED, SteamOS Linux x86_64 |
| Decky | API 1, @decky/api 1.1.3, @decky/ui 4.11.0 |
| Codex | 0.163.0, offizielles natives OpenAI-npm-Paket mit SHA-512-Pin |
| Frontend-Build | Node 22, npm-Lockfile, TypeScript 5.9.3, Rollup 4.53.3 |
| Python | Standardbibliothek; CI Ubuntu 22.04 / Python 3.12, Backend benötigt Python 3.11+ |

Automatisiert: TypeScript, Rollup, Backend-/Sicherheits-Negativtests, reale lokale
PTY und Codex-Initialisierung inklusive Berechtigungsprofil/Toolregistrierung,
Protokollschemaexport, ZIP-Struktur und Integrität.

Noch kein Hardware-Nachweis: konkretes SteamOS-/Steam-/Decky-Release, Controller,
Tastatur/Fokus, Login mit echtem Account, Sandbox-Erzwingung unter SteamOS,
sudo/PAM/Askpass und Root-Kindprozessabbruch, Neuinstallation/Upgrade am Deck.
Diese Ausgabe ist deshalb eine installierbare **Vorschau**, keine hardwareabgenommene 1.0.

Entscheidungen gegenüber dem Zielplan: npm mit eingefrorenem Lockfile statt pnpm;
offizielles vollständiges natives npm-Runtimebundle statt Einzelbinary-Release;
dynamische Codex-Tools statt eines zusätzlichen MCP-Servers; lokale Metadaten-/UI-Kopie
für Verlauf statt ausschließlich aus der Runtime rekonstruierter Darstellung;
ein gemeinsamer Build-/Release-Workflow mit automatisch veröffentlichten Previews.
Diese Änderungen machen erstmals einen direkt herunterladbaren ZIP-Build verfügbar.

Der native Sandbox-Test nutzt Ubuntu 22.04, da Ubuntus 24.04-AppArmor-Vorgaben
den mitgelieferten Bubblewrap-Helfer beim Einrichten des Netzwerk-Namensraums
blockieren können. Die Sandbox-Konfiguration des Plugins bleibt unverändert.

## Verbindungsaufbau: Korrektur nach erstem Gerätetest

Ein Gerät zeigte dauerhaft „Verbindung wird hergestellt …“. Der Bildschirm allein
belegt noch keine konkrete Backend-Ursache. Beim Prüfen wurde ein Startproblem
gefunden: `pty`/`tty` sind in einer eingefrorenen Decky-Python-Umgebung nicht
zwingend enthalten. Das Terminal verwendet jetzt direkt Linux/CPythons
`os.openpty()`, ohne diese optional eingebundenen Module zu importieren.

Backend-Importe finden innerhalb des abgefangenen Starts statt. Import- und
Initialisierungsfehler werden über RPC und das Pluginprotokoll sichtbar;
RPC wartet auf abgeschlossenen Start. Die Oberfläche beendet ausbleibende
Zustandsabfragen nach zehn Sekunden, zeigt einen Fehler und erlaubt erneutes
Verbinden. Mutierende Aktionen werden dabei nicht automatisch wiederholt.

Regressionen: echter Plugin-Einstiegspunkt bei gesperrten `pty`/`tty`-Importen,
Startfehler vor und nach Service-Erzeugung, RPC während des Starts; im Browser
hängender Transport, sichtbare Importfehler und erfolgreiche Wiederverbindung.
Die Behebung auf dem betroffenen Steam Deck muss noch bestätigt werden.
