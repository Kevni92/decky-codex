---
name: storage-audit
description: Große Dateien außerhalb von Steam-Spielen als Tabelle prüfen und Aufräumen anbieten.
---

decky_storage_scan liefert belegte Bytes, Dateigröße, Pfade, Scan-ID und Ergebnis-IDs.
Formatiere die Ergebnisse als Markdown-Tabelle mit Namen, Größen und Einordnung
in deiner normalen Chatantwort. Es gibt keinen separaten Datei-Manager und keine
Scan-Schaltfläche. Der Scan schützt bekannte Steam-Bibliotheken und sensible Verzeichnisse. Melde Ausschlüsse, Lücken und Zugriffsfehler klar.
Aus Größe/Endung allein folgt keine Löschbarkeit. Persönliche Dateien nicht vorauswählen.
Nur konkret gewählte IDs mit decky_propose_cleanup vorschlagen. Das Backend verlangt
eine gesonderte Freigabe, prüft erneut und verwendet ausschließlich den Papierkorb.
Ein Papierkorbzugriff setzt den Platz nicht frei. Für tatsächlich benötigten freien
Speicher muss dessen spätere Leerung ausdrücklich gesondert entschieden werden.
