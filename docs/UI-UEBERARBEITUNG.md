# Chat und Bedienung nach dem ersten Gerätetest

## Festgelegte Oberfläche

Der Chat folgt der ruhigen, dunklen Gestaltung von ChatGPT: eine abgesetzte Seitenleiste,
zentrierte Nachrichten, zurückhaltende Assistentenbeiträge und rechte Benutzerblasen.
Die Eingabe bleibt unter dem scrollbaren Gespräch erreichbar. Der Bildschirm hat nur
Gespräch, Navigation und situationsabhängige Rückfragen. Der Startzustand enthält keine
festen Beispielaktionen.

Konto, Modellwahl und Informationen zu Freigaben liegen auf der eigenen Route
`/decky-codex/settings`, mit anderem Seitenaufbau und Rückkehr zum Chat. Der Chatentwurf
bleibt beim Wechsel erhalten. Die Modellwahl gilt für die laufende Plugin-Sitzung.
Chatverwaltung einschließlich Umbenennen/Löschen liegt unter „Alle Chats“.

## Steam-Tastatur

Die rohe HTML-textarea wird durch das native Steam/Decky-TextField ersetzt. Dieses
übernimmt Steams Gamepad- und Bildschirmtastatur-Anbindung, auch bei der lokalen
Passworteingabe. Keine erfundenen SteamClient-Aufrufe oder Tastensimulationen.
Die Standard-Eingabe ist einzeilig. Aktivierung mit A oder Touch, Senden ausdrücklich
per Pfeil bzw. Strg + Enter; Enter zum Bestätigen der Steam-Tastatur sendet nicht.
Fokuszustände sind sichtbar, Bedienelemente mindestens 44 Pixel groß.

## Aufgaben statt eingebauter Beispielprogramme

Die Suche nach großen Dateien war ein Anwendungsbeispiel. Die festen Schaltflächen
„Große Dateien untersuchen“, „Scan stoppen“ und die eigene auswählbare Ergebnistabelle
entfallen. Der Assistent kann weiterhin `decky_storage_scan` einsetzen. Er stellt dessen
Metadaten als Markdown-Tabelle in seiner Antwort dar. Erklärte Rückfragen und eine
separate konkrete Freigabe schützen Aufräumvorschläge. Die sicheren Scan- und
Papierkorbwerkzeuge bleiben erhalten; direkte Scan-/Aufräum-RPCs der alten UI entfallen.

Aktivitäten und laufende Prozessausgaben stehen eingeklappt im Chat. Auswahlfragen
und Freigaben sind sichtbar über der Eingabe. Trifft eine Frage während der
Einstellungsansicht ein, führt ein Hinweis zurück zur Entscheidung im Chat.

## Prüfung und Grenzen

TypeScript, Rollup und die Backendtests bleiben verbindlich. Der Browsertest nutzt
das echte gebaute Plugin mit einem simulierten Decky-Host. Er prüft getrennte Seiten,
Entwurferhalt, Modellweitergabe, fehlende Beispiel-Schaltflächen, tabellarisches Markdown,
Details, Entscheidungen, Passwortisolation, fehlgeschlagenes Senden und Wiederverbindung.
Screenshots dokumentieren Chat, leeren Chat und Einstellungen in 1280 × 800.
Ein weiterer Layouttest prüft 1280 × 720 und eingeklappte Navigation.

Die simulierte TextField-Komponente prüft den Eingabevertrag, keine echte Steam-Tastatur.
Controller, Steam-Styles und Bildschirmtastatur müssen weiterhin auf dem Steam Deck
abgenommen werden. Die vorherigen Gerätecode- und Backend-Startkorrekturen bleiben bestehen.
