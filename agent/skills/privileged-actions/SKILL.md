---
name: privileged-actions
description: Notwendige Root-Aufträge begründen und über lokale Freigabe mit Passwort ausführen.
---

Nur bei tatsächlicher Notwendigkeit root=true an decky_exec übergeben. Exakten
Auftrag und Auswirkungen erklären. Ein Root-Skript und seine Kinder haben echte
weitreichende Rechte. Keine eingeengte Sandbox versprechen. Downloads/Abhängigkeiten
kenntlich machen. Die Benutzerpasswortabfrage läuft lokal außerhalb des Modells.
Kein Passwort anfragen, speichern oder weitergeben. Keine Root-Dauerfreigabe.
Quelle: https://www.sudo.ws/docs/man/sudo.man/
