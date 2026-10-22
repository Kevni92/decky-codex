# Spracheingabe und Controller-Bedienung

## Entscheidung

Die Spracheingabe ist eine lokale deutsche Diktierfunktion. Sie ersetzt keine
Freigaben und startet keine Modell-Aufgabe automatisch. Aufnahme → Erkennung →
bearbeitbarer Entwurf → ausdrücklich senden. Es wird weder eine kostenpflichtige
OpenAI-Audio-API noch ein undokumentierter ChatGPT-Endpunkt verwendet. Das vorhandene
Codex-App-Server-Protokoll 0.163.0 bietet experimentelle Thread-Realtime-Sitzungen;
diese sind kein stabiler separater Diktier-Endpunkt. Das ChatGPT-Login bleibt für
die eigentlichen Codex-Aufgaben zuständig.

Whisper.cpp 1.9.5 (Commit und SHA-256 festgeschrieben) mit multilingualem
Whisper-base-q5_1-Modell, Sprache `de`, vier CPU-Threads, kein GPU-Zugriff.
Native CLI und rund 57 MiB Modell werden in GitHub Actions gebaut/gebündelt.
Ubuntu 22.04, statische ggml/Whisper-Bibliotheken und statische GCC-Runtimes;
keine Python-Pakete, Node- oder Paketmanagerinstallation auf dem Deck.
`prepare_voice.py` prüft Quellen/Modell, baut die CLI und führt echte lokale
Inferenz mit synthetischem Audio und dem öffentlichen Upstream-Sprachbeispiel aus. Paketbau prüft jede gebündelte Voice-Datei.

## Aufnahme und Lebenszyklus

Python startet ausschließlich auf expliziten UI-Aufruf `pw-record --raw` als
normaler Benutzer. PipeWire wählt das Standard-Eingabegerät. Format: 16 kHz,
mono, PCM16; maximal 30 Sekunden / 960.000 Bytes. Kein Root und kein Shell-Aufruf.
Die Aufnahme liegt begrenzt im RAM; erst für die Erkennung entsteht eine private
WAV-Datei im privaten Datenverzeichnis. Temporäre WAV und Textausgabe werden bei
Erfolg, Abbruch oder Fehler entfernt. Kein Audio wird ins Chatarchiv, Snapshot,
Modell oder Protokoll übernommen. Das Audioverzeichnis ist zusätzlich in Codex’
Dateisystemrechten gesperrt. Erkennungstext wird nur an die anfragende UI
zurückgegeben, dort zum Entwurf ergänzt und erst beim Senden gespeichert.

RPCs: `voice_start`, `voice_status`, `voice_finish`, `voice_cancel`. Zufällige
Aufnahmetoken verhindern, dass alte Views neue Aufnahmen abbrechen. Eine Aufnahme
zur Zeit. Statusabfrage alle 500 ms, Ablauf nach acht Sekunden ohne UI-Kontakt,
automatischer Aufnahmestopp nach 30 Sekunden, Erkennungszeitlimit 90 Sekunden.
Verlassen der Route, Verwerfen und Plugin-Unload räumen Prozesse/Puffer auf.
Fehlende PipeWire-Werkzeuge, Mikrofonfehler und fehlendes/manipuliertes Modell
werden sichtbar gemeldet. Es gibt keine stille Cloud-Ausweichlösung.

## Textfeld und Navigation

Das native Steam-Eingabefeld verwendet seinen eigenen Placeholder. Das vorherige
separate Placeholder-Overlay entfällt. Höhe 44 px, symmetrische Null-Paddings,
explizite Zeilenhöhe; Steam-Label-Margins werden nur innerhalb des Composers
neutralisiert. Native Tastaturreferenz und Passwortmaskierung bleiben erhalten.

Native `Focusable`-Gruppen geben `flow-children` ausdrücklich vor: App horizontal,
Seitenleiste/Verlauf/Chat vertikal, Composer/Aktionszeilen horizontal und
Auswahlraster zweidimensional. So kennt Steams Fokusbaum die tatsächlichen Achsen.

Rechter Stick: Steams `RegisterForControllerAnalogInputMessages`, Aktion
`GAMEPAD_ANALOG_SCROLL` (47), wird direkt zum sichtbaren Transkript bzw. Verlauf
geleitet. Unterstützt aktuellen Callback `(controller, action, pressed, x, y)` und
ältere Batch-Nachrichten. Kein globales Remapping oder Tastatur-Actionset-Wechsel.
Ohne kürzliches natives Scrollsignal gibt es einen Standard-Gamepad-API-Fallback (rechte Y-Achse,
Totzone 0,2, zeitbasierte Geschwindigkeit). Bei Tastatur/Dialogen, versteckter Seite
und nach Route-Unmount wird nicht gescrollt. Abonnements werden abgemeldet.
Der Scroll-Hook respektiert die vorhandene Auto-Follow-Steuerung des Chats.

## Verifikation und verbleibender Gerätetest

Backendtests nutzen synthetisches PCM und echte lokale Kindprozesse ohne Mikrofon:
Aufnahme/Erkennung, WAV-Format, Token, konkurrierender Start, Abbruch,
Verbindungsabbruch, Stille und Prüfsummen. Browserprüfungen rendern das echte Bundle
in einem Steam-Host mit nativer Textfeldstruktur und kontrollierten Steam-Events:
Eingabefeldzentrierung, Navigationsgruppen, beide Scrollrichtungen, Diktierentwurf,
kein automatisches Senden, Verwerfen, sichtbare Fehler und Route-Cleanup.

Ein echtes Steam Deck ist hier nicht angeschlossen. PipeWire-Geräteauswahl,
Mikrofonpegel, Controller-Treiber/Scrollvorzeichen sowie Latenz unter Spielelast
müssen am Gerät geprüft werden. Die Tests simulieren den Steam-Vertrag und ersetzen
diesen Gerätetest nicht. Whisper kann Wörter/Namen falsch erkennen; der Entwurf
bleibt deshalb vor jeder Aktion bearbeitbar.

## Primärquellen

- https://learn.chatgpt.com/docs/app-server
- https://github.com/ggml-org/whisper.cpp/tree/d1be6fde11ac6e0407606b4e42fe72d34add8037
- https://huggingface.co/ggerganov/whisper.cpp (Modell/SHA-256 im Manifest)
- https://docs.pipewire.org/page_man_pw-cat_1.html
- https://github.com/SteamTracking/SteamTracking/blob/master/ClientExtracted/steamui/sp.js
  (von Steam verteiltes UI: Fokusgruppen, Controller-Scrollaktion und Keyboardmanager)
