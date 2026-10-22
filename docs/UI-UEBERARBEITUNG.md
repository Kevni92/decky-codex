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

## Korrektur nach weiterem Gerätetest

Die frühere Regel `.dc-native-input [class*="Label"]` traf auch Steams
`DialogInputLabelGroup` und `DialogRequirementLabel`. Damit wurde die gesamte
Eingabe versteckt; nur der separate Platzhalter blieb sichtbar. Der Selektor
adressiert jetzt ausschließlich das einzelne `.DialogLabel`-Element.
Der Testhost bildet diese echten Steam-Wrapper ab und prüft die Sichtbarkeit
und echte Texteingaben statt nur eines vereinfachten Input-Mocks.

Ein eigenes Tastatursymbol und Fokus/A/Touch öffnen über den zum Input-Dokument
gehörenden `WindowStore` eine `CreateVirtualKeyboardRef`. Es werden weder ein
HTML-Element an `ShowVirtualKeyboard` übergeben noch Tasten simuliert. Die
Tastaturzeichen werden über `onTextEntered` gezielt in das aktive lokale Feld
übernommen. Damit ist keine zurückgekehrte OS-Fokussierung nach einer Spielsitzung
nötig. Fertig schließt die Tastatur und sendet keine Chatnachricht. Verdeckte,
entfernte oder deaktivierte Eingabefelder nehmen keine nachlaufenden Zeichen an.
Das Linux-Passwort nutzt ausdrücklich den nativen Input-Typ `password`.

Referenz für den geprüften Steam-Vertrag: SteamTracking/SteamTracking,
`ClientExtracted/steamui/sp.js`, `CreateVirtualKeyboardRef`, `ShowVirtualKeyboard`
und `DispatchKeypress`; ergänzend SteamDeckHomebrew/decky-frontend-lib
`src/components/TextField.ts`. Diese privaten Steam-Schnittstellen können sich
mit Steam-Updates ändern. Bei fehlender Anbindung erscheint ein sichtbarer Fehler.
Kein Tastatur- oder Passworttext wird durch das Plugin protokolliert.

Die Seitenleiste wächst auf 292 CSS-Pixel (260 in schmalen Ansichten). Die
unteren Navigationselemente haben einen eigenen Abstand und lesbare, bei Bedarf
umbrechende Beschriftungen. Einrückung am Klappsymbol und 60 Pixel Fußraum halten
Steams Bedienleiste frei. Ein gemessener Routenversatz wird von der verfügbaren
Höhe abgezogen. Tests umfassen außerdem diesen Versatz und vollständige Labels.
