# Racebook – eigenständige App (PWA), Version 1.3.2

Racebook ist ein Wartungsheft für Motorräder: Wartung und Fälligkeiten, Logbuch, Fahrten, Fahrwerk-Setups, Teilevorrat, Mängel, Fotos und Bedienungsanleitung. Diese Fassung läuft als installierbare Web-App (PWA) im Browser, speichert alles **nur auf dem Gerät** (IndexedDB) und funktioniert nach dem ersten Laden auch ohne Netz.

Die bisherige Racebook-App in Claude bleibt unverändert bestehen (Link, Anbindung, Daten). Diese App ist davon getrennt. Veröffentlichen oder Ersetzen ist ein eigener späterer Schritt.

> **Wichtig zu deinen Daten**
> Racebook speichert alles nur in diesem Browser auf diesem Gerät. Die Daten sind weg, wenn du
> - die Website-Daten von Racebook oder den Browserverlauf **samt Website-Daten** löschst,
> - die App deinstallierst und dabei die gespeicherten Daten mit entfernen lässt,
> - das Gerät wechselst, zurücksetzt oder einen anderen Browser nimmst,
> - die Adresse wechselst, unter der die App läuft (jede Adresse hat ihren eigenen Speicher).
>
> Mach deshalb regelmäßig eine **Sicherung** (Daten & Sicherung → „Sicherung herunterladen“) und bewahre sie außerhalb des Handys auf. Den Stand der letzten Sicherung siehst du jederzeit oben rechts in der Übersicht.

---

## 1. Lokal testen

Voraussetzung: ein beliebiger kleiner Webserver. Direkt per Doppelklick (`file://…`) geht es nicht, weil Module, Service Worker und der Gerätespeicher eine Webadresse brauchen. `localhost` zählt für Browser als sichere Adresse, dort funktioniert alles wie unter HTTPS.

```bash
cd racebook-pwa
python3 -m http.server 8765
```

Dann im Browser `http://localhost:8765/` öffnen.

Auf dem Handy im selben WLAN geht `http://<IP-des-PCs>:8765/` zwar zum Ansehen, aber **nicht** zum Installieren und nicht offline: Außer `localhost` verlangt der Browser dafür HTTPS. Zum Testen auf dem Pixel daher besser gleich eine HTTPS-Adresse nehmen (Abschnitt 2).

## 2. Fest unter HTTPS bereitstellen (statisches Hosting)

Die App besteht nur aus festen Dateien (HTML, CSS, JavaScript, Bilder). Es gibt keinen Server-Code, keine Datenbank im Netz und keine geheimen Schlüssel. Jede statische Hosting-Lösung mit HTTPS reicht. Alle Pfade sind relativ, die App läuft auch in einem Unterordner (z. B. `https://name.github.io/racebook/`).

**Wichtig:** Lege dich auf **eine feste Adresse** fest. Der Gerätespeicher gehört zur Adresse (genauer: zum „Ursprung“ aus Protokoll, Domain und Port). Unter einer anderen Adresse startet die App mit leerer Garage; dann hilft nur Sicherung → Einspielen.

### Variante A: GitHub Pages (kostenlos)
1. Auf github.com ein neues Repository anlegen, z. B. `racebook` (öffentlich oder, mit passendem Tarif, privat).
2. Den **Inhalt** des Ordners `racebook-pwa` hochladen („Add file → Upload files“), sodass `index.html` direkt im Repository liegt. Den Ordner `tests` brauchst du dort nicht.
3. Settings → Pages → „Deploy from a branch“, Branch `main`, Ordner `/ (root)` → Save.
4. Nach ein bis zwei Minuten ist die App unter `https://<dein-name>.github.io/racebook/` erreichbar.

### Variante B: Netlify Drop
1. `https://app.netlify.com/drop` öffnen (kostenloses Konto).
2. Den Ordner `racebook-pwa` (ohne `tests`) ins Fenster ziehen.
3. Netlify zeigt eine Adresse `https://<zufall>.netlify.app`. Unter „Site configuration → Change site name“ einen festen Namen vergeben.

Andere Anbieter (Cloudflare Pages, eigener Webspace mit HTTPS) gehen genauso. Der Server sollte `.webmanifest` als `application/manifest+json` und `.js` als `text/javascript` ausliefern; bei den genannten Anbietern ist das voreingestellt.

## 3. Auf dem Pixel installieren

1. Die HTTPS-Adresse in **Chrome** auf dem Pixel öffnen und einmal vollständig laden lassen.
2. Chrome-Menü (⋮) → **„App installieren“** (bei manchen Versionen „Zum Startbildschirm hinzufügen“ → „Installieren“).
3. Racebook erscheint mit eigenem Symbol im App-Drawer und auf dem Startbildschirm und öffnet ohne Browserleiste. **Schließ danach den Chrome-Tab mit Racebook.** Ist die App zweimal offen, kann ein still gelegter Tab im Hintergrund den Speicher blockieren; Speichern dauert dann ungewöhnlich lange, und Racebook zeigt nach etwa 4 Sekunden einen Hinweis darauf.
4. In Racebook unter **Daten & Sicherung → Speicher** prüfen, ob „Dauerhaft“ auf „Ja“ steht. Wenn nicht: „Dauerhaft speichern“ antippen. Bei installierten Apps gewährt Chrome das meist; dann löscht der Browser die Daten nicht von selbst bei Speicherknappheit.
5. Offline-Test: Flugmodus an, Racebook öffnen. Die Übersicht, Fotos und gespeicherte PDFs müssen erscheinen.

Die Zurück-Geste von Android führt aus einem Motorrad zur Übersicht und von dort aus der App.

## 4. Daten übernehmen

### Aus der Racebook-App in Claude
Die Claude-App speichert in deinem Claude-Konto, die neue App auf dem Gerät. Ein direkter Zugriff ist nicht möglich, deshalb geht es über eine Sicherung:

1. Racebook in Claude öffnen → **Garage → Daten**.
2. „Sicherung speichern (.json)“ antippen. Falls dort „Sicherung kopieren“ steht: antippen, der Text liegt dann in der Zwischenablage.
3. Neue App öffnen → **Daten & Sicherung → Sicherung einspielen** → die `.json`-Datei wählen **oder** den kopierten Text in das Feld einfügen und „Eingefügten Text prüfen“ tippen.
4. Die Vorschau zeigt Motorräder, Anzahl der Einträge und – einzeln benannt – **welche Anhänge nicht übernommen werden können**. Fotos und PDFs, die in der Claude-App hochgeladen wurden, liegen in Claudes Dateispeicher und stecken nicht in der JSON-Sicherung. Lade sie bei Bedarf neu hoch (Fahrzeugdaten → Foto, Handbuch → PDF). Web-Links zu Anleitungen bleiben erhalten.
5. „Alle Daten ersetzen“ tippen. Die App schreibt alles in einem Schritt, liest es danach zurück und vergleicht es mit der Sicherung. Erst dann meldet sie den Erfolg.

Die Daten in Claude bleiben dabei unverändert.

### Aus der bisherigen Einzeldatei-Version im selben Browser
Hast du `racebook-komplett.html` (Version 8) unter **derselben Adresse** im selben Browser benutzt, findet die neue App diese Daten beim Start selbst. Die Übersicht zeigt dann „Daten der bisherigen Version gefunden“. Nach „Prüfen und übernehmen“ siehst du eine Vorschau und bestätigst die Übernahme. Die alten Daten bleiben unverändert liegen. Unter „Daten & Sicherung → Bisherige Version“ kannst du sie entfernen, sobald die Übernahme bestätigt ist und alles stimmt. Unter einer anderen Adresse geht es wie bei Claude über Sicherung und Einspielen.

Eine leere Garage wird nie als erfolgreiche Übernahme gemeldet: Ohne Motorräder bietet die App keine Übernahme an und spielt keine Sicherung ohne Motorräder ein.

## 5. Sicherung und Wiederherstellung

- **Sicherung erstellen:** Daten & Sicherung → „Sicherung herunterladen“. Es entsteht eine ZIP-Datei `racebook-sicherung-JJJJ-MM-TT-HHMM.zip` mit
  - `racebook.json`: alle Einträge (Format `racebook-backup`, Version 4; Version 5, wenn Einträge ohne Motorrad dabei sind, siehe unten; Version 6, wenn ein Zählerwechsel oder eine Tippfehler-Berichtigung gespeichert ist, siehe Abschnitt 9a; Version 8 (ab 1.2.0), wenn Logbuch-Einträge Tätigkeiten oder eine Originaleingabe enthalten, bearbeitet wurden oder ein Motorrad eine eigene Checkliste oder Favoriten hat – 1.1.x lehnt diese mit Hinweis ab; Version 7, wenn bei einem Motorrad mit Zählerwechsel Startwerte oder Montagen ihre Stelle im Tag mitbringen – 1.1.0 lehnt diese mit Hinweis ab, statt sie falsch zuzuordnen), Ab 1.3.0 Version 9 nur, wenn eine persönliche Menübelegung gespeichert ist; sonst bleibt die Version so niedrig wie bisher, damit ältere Fassungen solche Sicherungen weiter lesen.
  - `dateien/…`: alle Fotos und PDFs als echte Dateien, jeweils mit SHA-256-Prüfsumme in `racebook.json`,
  - `LIESMICH.txt`: kurze Erklärung.
- **„Sicherung teilen …“** übergibt die ZIP-Datei an Android (z. B. Google Drive, Mail).
- **Status:** Die App zeigt Zeitpunkt, Dateiname und Größe der letzten Sicherung und wie viele Änderungen seitdem dazugekommen sind. Sie weiß nur, dass die Datei erstellt und übergeben wurde. Ob sie noch in den Downloads oder in der Cloud liegt, kann sie nicht prüfen und behauptet das auch nicht.
- **Erinnerung:** Gibt es Änderungen seit der letzten Sicherung, steht das dezent unter der Übersicht und oben rechts.
- **Einspielen:** Daten & Sicherung → „Sicherung einspielen“ → ZIP- oder JSON-Datei wählen. Geprüft werden Format, Version, Datentypen, Bezüge (z. B. gehört jeder Eintrag zu einem Motorrad?), Vollständigkeit, Größe, Typ und Prüfsumme jeder Datei. Erst danach erscheint die Vorschau.
- **Ersetzen:** Vor dem Ersetzen wird der bisherige Stand als **Sicherheitskopie** im Gerät abgelegt, dann wird alles in **einem** Schritt ersetzt (alles oder nichts). Unter „Sicherheitskopie“ kannst du den alten Stand wiederherstellen; der dann aktuelle Stand wird dabei selbst zur Kopie.
- **Laufende Eingaben:** Wird gerade etwas gespeichert (z. B. ein Schnell-Eintrag), wartet das Einspielen, bis es fertig ist; es landet damit noch im bisherigen Stand und in der Sicherheitskopie. Danach werden offene Eingaben geschlossen, auch in anderen geöffneten Racebook-Fenstern, weil sie zum vorherigen Stand gehören. Was ein anderes Fenster noch für den alten Stand speichern wollte, weist der Speicher ab; das Fenster meldet das und zeigt den neuen Stand. Dasselbe gilt für „Sicherheitskopie wiederherstellen“.
- **Fehler:** Kaputte, unvollständige oder manipulierte Sicherungen und Sicherungen aus einer neueren App-Version werden mit Grund abgelehnt; deine Daten bleiben unverändert.
- **Einträge ohne Motorrad:** Version 1.0.0 konnte in seltenen Fällen (Motorrad in einem Fenster entfernt, während ein anderes noch speicherte) Einträge ohne Motorrad hinterlassen. 1.0.1 verhindert das. Gibt es solche Einträge schon, zeigt „Daten & Sicherung → Einträge ohne Motorrad“ sie an; du kannst sie einem Motorrad zuordnen oder löschen. Bis dahin bleiben sie erhalten und stehen in jeder Sicherung getrennt im Teil `verwaist` (dann Sicherungsversion 5). Sicherungen ohne solche Einträge haben weiter Version 4.

## 6. Aktualisieren

### Für dich als Nutzer
Ist eine neue Version veröffentlicht, lädt die App sie im Hintergrund und zeigt „Eine neue Version von Racebook ist bereit“. „Jetzt aktualisieren“ lädt die App neu. Deine Daten bleiben dabei unverändert; sie liegen getrennt von den App-Dateien. Ändert eine neue Version das Speicherformat, hebt sie den Bestand in einem einzigen Schritt an. Scheitert das, bleibt der alte Bestand vollständig erhalten und die App zeigt einen Hinweis statt einer leeren Garage.

### Für die Veröffentlichung einer neuen Version
1. Dateien ändern.
2. In `sw.js` die Konstante `VERSION` erhöhen (z. B. `racebook-1.1.2`) und in `js/backup.js` `APP_VERSION` anpassen. Ohne neue `VERSION` bekommen installierte Apps die Änderungen nicht.
3. Neue Dateien auf dieselbe Adresse hochladen.
4. Ändert sich das Speicherformat: in `js/db.js` `DB_VERSION` erhöhen und **hinten** an `MIGRATIONS` einen neuen Schritt anhängen. Bestehende Schritte nie ändern oder löschen. Jeder Schritt läuft in derselben Transaktion; bei einem Fehler bricht der Browser alles ab. Aktuell ist `DB_VERSION` 3 (Schritt 3 legt die Bestandskennung an). Noch offene Fenster einer älteren Version werden beim Hochziehen vom Browser getrennt und melden „in einem anderen Fenster aktualisiert“; sie können danach nichts mehr schreiben.
5. Ändert sich das Sicherungsformat: `ZIP_VERSION` in `js/domain.js` erhöhen und ältere Versionen beim Einspielen weiter lesen können. Die höhere Version nur schreiben, wenn die neuen Angaben wirklich vorkommen (so liest eine ältere App-Version Sicherungen ohne sie weiter).

1.1.0 bringt ein neues, neutrales App-Symbol. Bei einer schon installierten App kann das alte Symbol noch eine Weile bleiben, auf dem iPhone auch dauerhaft. Das betrifft nur das Aussehen. Entferne die App deswegen nicht, ohne vorher eine Sicherung zu machen: Mit der App können auch ihre Daten verschwinden.

1.1.0 ändert das Speicherformat nicht (`DB_VERSION` bleibt 3): Logbuch-Einträge bekommen nur bei Bedarf die neuen Felder `meterNew` (Zählerwechsel) und `fix` (Berichtigung). Vorhandene Einträge bleiben Byte für Byte gleich; eine Umwandlung ist nicht nötig.

1.2.0 hebt den Gerätespeicher auf Version 4 (`DB_VERSION` 4). Die gespeicherten Einträge bleiben unverändert; neue Felder (`work`, `orig`, `edited` im Logbuch, `checklist`, `favs` beim Motorrad) entstehen nur bei Bedarf. Noch offene Fenster mit 1.1.x werden dabei vom Speicher getrennt und bitten um „Neu laden“. Haken der Checkliste vom laufenden Tag werden übernommen.

1.1.1 ebenso: Startwerte und Montagen bekommen beim Speichern nur bei Bedarf das Feld `lastC` bzw. `c` (Stelle im Verlauf ihres Tages, siehe Abschnitt 9a). Angaben aus 1.1.0 und älter bleiben unverändert; liegt eine davon auf dem Tag eines Zählerwechsels, fragt die App einmal nach, welcher Zähler gemeint war.

## 7. Aufbau

```
index.html            App-Hülle (alle Ansichten, Dialoge)
manifest.webmanifest  Name, Farben, Symbole für die Installation
sw.js                 Service Worker: App-Dateien offline vorhalten, Aktualisierung
css/app.css           Gestaltung (dunkel/hell, mobil zuerst)
icons/                Logo (einfarbig: emblem-light.svg für dunkle, emblem-dark.svg für helle Flächen) und
                      App-Symbole (SVG-Vektoren, PNG daraus erzeugt, maskierbar), ohne Markenfarbe
js/util.js            Hilfen: Zahlen (strikt, Dezimalkomma), Datum, Farben, Vergleich
js/domain.js          Fachlogik: Prüfregeln, Zählerstand und Fälligkeiten, Texterkennung, Sicherungsprüfung
js/state.js           Zustand der Oberfläche
js/db.js              Speicher: IndexedDB, Migrationen, atomare Schreibvorgänge mit Prüfung von Bestandskennung
                      und Motorrad in derselben Transaktion, Ersetzen mit Sicherheitskopie
js/store.js           Speicheradapter: Ergebnis ok / fail / unclear, Anzeige während des Speicherns, Bestandskennung
js/ops.js             Vorgänge: feste IDs, Wiederholung ohne Duplikat, Formular-Generationen, laufende Abläufe,
                      Dateien freigeben
js/images.js          Fotos: Ausrichtung, Verkleinern, Zuschnitt, Vorschaubild, Prüfsumme
js/cropper.js         Dialog für den Bildausschnitt
js/zip.js             ZIP schreiben und lesen (ohne fremde Bibliothek)
js/backup.js          Sicherung, Einspielen, Übernahme der bisherigen Version
js/work.js            Tätigkeitskatalog, Erkennung im Text, betroffene Wartungsintervalle (ab 1.2.0)
js/drafts.js          Bearbeitungsvorgänge, Rückfrage „Du hast ungespeicherte Änderungen.“ (ab 1.2.0)
js/views/*.js         Ansichten: Übersicht, Motorrad, Mängel, Daten & Sicherung; counter.js: Rückfrage bei Sprüngen,
                      Tippfehler berichtigen (Vorschau), Zählerwechsel
tests/                automatische Tests: nicht im App-ZIP, sondern im Test-ZIP racebook-pwa-tests-1.2.2.zip,
                      das sich in denselben Ordner entpackt (siehe tests/README.md)
```

Keine externen Bibliotheken, keine Schriftarten aus dem Netz, keine Verbindung zu fremden Servern. Die Texterkennung im Schnell-Eintrag läuft auf dem Gerät; eine KI ist in dieser Fassung nicht eingebaut.

## 8. Bedienung in Kürze

- Gestaltung ab 1.1.0: Die Oberfläche ist neutral in Anthrazit, Weiß und Grautönen. Die Markenfarbe erscheint nur beim jeweiligen Motorrad, am Nummernschild und am linken Kartenrand (zum Beispiel KTM orange, Suzuki gelb). Rot, Bernstein und Grün stehen weiter für überfällig, bald fällig und in Ordnung, unabhängig von der Marke.
- **Meine Garage** ist die Übersicht aller Motorräder (Startseite, so überschrieben). Auf der Seite eines Motorrads steht über dem Foto bzw. über dem Inhalt der Knopf **„Meine Garage“** mit Garagen-Symbol; er führt direkt dorthin zurück. Die untere Leiste hat dafür keinen eigenen Reiter.
- Ab 1.3.0 bleibt die Hauptnavigation in allen Bereichen sichtbar: Garage, drei wählbare Favoriten, Mehr. Standard: Lager, Logbuch, Fahrten. Menü anpassen unter Einstellungen. Die Motorradbereiche heißen Fahrzeugdaten, Verbaute Teile, Technische Daten, Wartungsintervalle; Lager ist gemeinsam. Eine vorhandene Technik-Adresse wird auf Fahrzeugdaten umgeleitet.
- **Ab 1.2.0:** „Reihenfolge ändern“ in „Meine Garage“ (Ziehgriff, ▲/▼, Pfeiltasten). Im Logbuch Tätigkeiten aus einem Katalog (häufige Arbeiten, Suche, Favoriten je Motorrad, eigene), getrennt davon die betroffenen Wartungsintervalle; Einträge lassen sich mit Vorschau der Folgen bearbeiten. Checkliste „Vor der Fahrt“ mit „Gabel entlüften“, je Motorrad anpassbar.
- **Ab 1.2.1:** „Bremsflüssigkeit nachgefüllt“, „Benzinsieb gereinigt“ und ähnliche Angaben sind eigene Tätigkeiten, kein Wechsel; ein Wechselintervall bleibt dabei unverändert. Ein noch nicht hinzugefügter eigener Checklisten-Punkt wird beim Speichern mitgenommen (ab 1.2.2 höchstens 40 Punkte; darüber bleibt der Punkt mit Hinweis im Feld). Ab 1.2.2 speichert die Anleitung (Link, PDF, Entfernen) nur auf der Grundlage, die das Formular gezeigt hat; ändert ein anderes Fenster sie inzwischen, bleibt die eigene Eingabe mit Hinweis stehen.
- Bei „Motorrad hinzufügen“ stehen die Marken alphabetisch, „Andere“ am Ende; vorausgewählt ist keine.

## 9. Schnell-Eintrag

Schreib oder diktier unter Status, was du gemacht hast. Vor dem Speichern zeigt eine Vorschau, was erkannt wurde; „Bearbeiten“ öffnet das passende Formular. Die Erkennung läuft auf dem Gerät, ohne Internet und ohne KI.

Ein **Stichwort am Anfang** (auch nach dem Motorradnamen, mit oder ohne Doppelpunkt) legt fest, wo der Eintrag landet:

| Stichwort | Ergebnis | Beispiel |
|---|---|---|
| Mangel, Mängel, Defekt, Problem, Aufgabe, Todo, Offen | offener Mangel; „dringend“/„sofort“ → hoch, „irgendwann“/„kein Stress“ → niedrig | `Mangel: Kette locker` |
| Stand, Zählerstand, Kilometerstand, Betriebsstunden, Tacho | abgelesener Stand (niedriger als berechnet = Korrektur, steht in der Vorschau) | `Stand: 45,5` |
| Gekauft, Eingekauft, Vorrat | Teilevorrat erhöhen, neues Teil anlegen | `Gekauft: 2 Ölfilter, 1 Zündkerze` |
| Kaufen, Bestellen, Einkauf, Einkaufsliste, Besorgen | Teil als knapp markieren bzw. mit 0 Stück anlegen | `Kaufen: Bremsbeläge vorn` |
| Notiz, Info, Merken | Notiz | `Notiz: neue Griffe montiert` |
| Fahrt, Training | Fahrt | `Fahrt: 1,5 h Gotha` |
| Wartung, Service, Erledigt | Wartung | `Wartung: Luftfilter` |

**Ohne Stichwort:** Wörter wie „locker“, „undicht“, „quietscht“, „schwitzt“, „kaputt“, „funktioniert nicht“ ergeben einen Mangel, solange kein Erledigt-Wort wie „gespannt“ oder „getauscht“ dabeisteht. „Kette spannen“ (Grundform, ohne Erledigt-Wort) ist ein offener Punkt und wird ein Mangel, kein erledigter Service. „1,5 Stunden gefahren, Gabel schwitzt“ ergibt eine Fahrt über 1,5 Stunden und einen Mangel; Zahlen mit Komma oder Punkt bleiben dabei ganz. Verneintes („Öl noch nicht gewechselt“) bleibt eine Notiz.

**Verneint oder geplant, auch mit Stichwort:** „Wartung“, „Service“, „Erledigt“, „Fahrt“ und „Training“ bestimmen nur die Art. Steht im Text eine Verneinung („nicht“, „noch nicht“, „kein“) oder etwas Geplantes („morgen“, „bald“, „sollte“, „muss“, „nächste Woche“ …), wird daraus nie eine erledigte Wartung oder Fahrt:

| Eingabe | Ergebnis |
|---|---|
| `Wartung: Öl noch nicht gewechselt` | Notiz mit dem ganzen Text, Hinweis in der Vorschau |
| `Wartung: morgen Öl wechseln` | offener Mangel „Morgen Öl wechseln“, Hinweis in der Vorschau |
| `Fahrt: 2 Stunden, Bremse funktioniert nicht` | Fahrt über 2 Stunden (ein Schadenswort mit „nicht“ ist keine Verneinung) |

Im Zweifel wird also nichts als erledigt eingetragen. War es doch erledigt, über „Bearbeiten“ ändern.

**Teile:** „Gekauft“ und „Kaufen“ ändern einen vorhandenen Posten (gleicher Name, Groß-/Kleinschreibung egal), sonst entsteht ein neuer. „Bearbeiten“ öffnet dann das Teileformular für genau diesen Posten („Teil ändern“); die Anzahl dort ist der Bestand nach dem Speichern. Einkäufe und die Knöpfe + und − zählen um die Anzahl weiter, nicht auf eine feste Zahl: Kaufst du in zwei Fenstern gleichzeitig 2 und 3 Ölfilter dazu, stehen danach 5 mehr im Vorrat.

## 9a. Zählerstände: Rückfrage, Tippfehler, Zählerwechsel (ab 1.1.0)

- **Rückfrage bei Sprüngen:** Liegt ein eingetippter Stand mehr als 20 h bzw. 2.000 km über dem bisherigen, fragt Racebook vor dem Speichern, z. B. „566 h übernehmen? Bisheriger Stand: 54 h. Das sind 512 h mehr.“ – „Eingabe korrigieren“ speichert nichts und setzt den Cursor ins Feld, „Stimmt so“ speichert. Das gilt für alle Stellen, an denen ein Stand eingetippt wird: Schild, Erledigt, Neuer Eintrag, Mangel erledigt, Schnell-Eintrag, Reifen & Kette, Startwerte der Intervalle, alter Zählerstand beim Zählerwechsel. Verglichen wird mit dem Stand an der Stelle des Eintrags; ein rückdatierter Eintrag also mit dem Stand von damals.
- **Tippfehler berichtigen:** Ist ein neu eingetippter Stand niedriger als der aktuelle, bietet Racebook neben „Korrektur speichern“ auch „Tippfehler berichtigen …“ an (am Schild und im Schnell-Eintrag „Stand: …“). Die falsche Ablesung bekommt dann den richtigen Wert: der neue Stand minus allem, was seitdem gefahren wurde (Beispiel: 566 h statt 52 h, seitdem 2 h gefahren, heute 54 h → die Ablesung wird 52 h). Eine zusätzliche Ablesung entsteht nicht; der alte Wert bleibt am Eintrag vermerkt („berichtigt, vorher 566 h“).
- **Vorschau:** Vor dem Übernehmen zeigt ein Fenster die falsche Ablesung mit Datum, alten und neuen Wert, alle betroffenen Einträge mit Datum, altem und vorgeschlagenem Stand, und was sich bei den Fälligkeiten ändert. Wartungen „aus dem Verlauf“ (ohne eingetippten Stand) sind vorausgewählt; abwählen hält ihren alten Wert fest. Eingetippte Stände und Einträge unklarer Herkunft (ältere Daten) werden nie von selbst geändert: dort muss „berichtigen“ oder „so lassen“ gewählt werden, sonst lässt sich nichts übernehmen. Gespeichert wird alles in einem Schritt, und nur, wenn sich die Daten des Motorrads seit der Vorschau nicht geändert haben (auch nicht in einem anderen Fenster); sonst wird die Vorschau neu berechnet.
- **Wartungsstand prüfen:** Liegt die letzte Wartung eines Punkts über dem heutigen Stand (z. B. weil ein Tippfehler schon als Korrektur gespeichert wurde), zeigt Racebook „Wartungsstand prüfen“ statt einer Restlaufzeit. Lässt sich der Widerspruch als Tippfehler berichtigen, steht oben „Prüfen“ und öffnet dieselbe Vorschau.
- **Zählerwechsel:** Fahrzeugdaten → Stundenzähler (bei km-Motorrädern Kilometerzähler) → „Stundenzähler ersetzt“: Datum, letzter Stand des alten Zählers (leer = berechneter Stand) und Anzeige des neuen. Danach trägst du ein, was der neue Zähler anzeigt. Das Schild zeigt die Zähleranzeige, darunter die Gesamtlaufleistung; Fälligkeiten rechnen mit der Gesamtlaufleistung. Beispiel: gesamt 54 h, neuer Zähler 0 h, später Anzeige 3 h → gesamt 57 h; Wartung bei 50 h mit 50-h-Intervall → noch 43 h. Der Wechsel steht im Logbuch und lässt sich dort löschen.
- **Am Tag eines Zählerwechsels (ab 1.1.1):** Startwerte (Wartung → Intervalle verwalten) und Montagen (Reifen & Kette) gelten wie Logbuch-Einträge in der Reihenfolge, in der sie eingetragen wurden. Ein Startwert, der vor dem Wechsel am selben Tag eingetragen wurde, gehört also zum alten Zähler, auch nach weiteren Wechseln. Trägst du einen Wert für einen Tag ein, an dem schon ein Zähler gewechselt wurde, fragt Racebook „Welcher Zähler war gemeint?“ (alter, gegebenenfalls zwischenzeitlicher oder neuer Zähler); nichts ist vorausgewählt. Angaben aus 1.1.0 und älter, bei denen das nicht feststeht, zeigen „Wartungsstand prüfen“ bzw. „Zähler unklar“; oben steht „Angaben zuordnen“ mit derselben Auswahl. Liegt eine Montage über dem heutigen Gesamtstand, steht „Montagestand prüfen“ statt „0 h gelaufen“.
- **Neue Montage oder Berichtigung (ab 1.1.2):** Ein neues Reifenmodell bzw. eine neue Kette ist eine neue Montage, auch wenn Stand und Datum zufällig gleich sind wie bei der alten; am Tag eines Zählerwechsels fragt Racebook dann, welcher Zähler gemeint ist (bei leerem Stand nimmt es die aktuelle Anzeige, ohne zu fragen). Wird nur der Stand derselben Montage oder desselben Startwerts am selben Datum berichtigt, bleibt die bisherige Zuordnung.
- **Auswahl bleibt nur auf ihrem Stand gültig (ab 1.1.2):** Ändern sich die Daten des Motorrads, während „Welcher Zähler war gemeint?“ offen ist (etwa in einem anderen Fenster), berechnet Racebook die Auswahl neu, setzt sie zurück und fragt mit Hinweis erneut. Gespeichert wird nur, wenn der Speicher bestätigt, dass sich seit der Auswahl nichts geändert hat; sonst wird nichts gespeichert und neu gefragt.

## 10. Mehrere Fenster

Racebook darf in mehreren Tabs oder Fenstern desselben Browsers offen sein. Änderungen erscheinen in den anderen ohne Neuladen. Zwei Regeln schützen den Bestand, unabhängig davon, ob die Fenster voneinander erfahren:

- **Bestandskennung:** Jeder gespeicherte Bestand hat eine Kennung, die sich bei jedem Einspielen und Wiederherstellen ändert. Jeder Speichervorgang nennt die Kennung des Bestands, in dem er begonnen wurde. Stimmt sie nicht mehr, schreibt der Speicher nichts (geprüft in derselben Transaktion).
- **Motorrad vorhanden:** Ein Eintrag, der zu einem Motorrad gehört, wird nur gespeichert, wenn es das Motorrad im Speicher gibt (ebenfalls in derselben Transaktion). Ein Motorrad wird mit allen tatsächlich gespeicherten Einträgen entfernt, auch mit solchen, die das Fenster noch nicht kennt.
- **Teilebestand:** Einkäufe und + / − werden in der Transaktion auf den dann gespeicherten Bestand angewendet, jeweils genau einmal (feste Vorgangskennung). Gleichzeitige Änderungen in zwei Fenstern zählen beide; ein wiederholter Speicherversuch zählt nicht doppelt.

- **Grundlage des Entwurfs (ab 1.2.0):** Bearbeiten-Formulare (Technik, Mängel, Logbuch-Einträge, Checkliste, Reihenfolge) schreiben nur die geänderten Felder und nur, wenn diese im Speicher noch dem Stand beim Öffnen entsprechen (geprüft in derselben Transaktion). Sonst wird nichts gespeichert: Racebook zeigt den aktuellen Stand mit den eigenen Änderungen und nennt Konflikte, erst ein erneutes Speichern übernimmt ihn.
- **Ungespeicherte Eingaben (ab 1.2.0):** Innerhalb eines Fensters fragt Racebook vor jedem Wechsel zu einem anderen Motorrad, Bereich oder Formular nach („Speichern“, „Verwerfen“, „Weiter bearbeiten“). Während gespeichert wird, beginnt kein zweiter Vorgang. Ab 1.2.1 ist auch innerhalb eines Bereichs nur ein Formular in Arbeit: Ein weiteres Formular öffnen schließt ein unverändertes offenes; Tippen oder Klicken in ein anderes Formular führt bei geänderten Eingaben zur Rückfrage. Der Link zur Anleitung ist ebenfalls geschützt und wird für das Motorrad gespeichert, zu dem das Formular gehört.

Racebook möglichst nur an einer Stelle offen halten (installierte App oder Browser). Hängt ein Speichervorgang länger als etwa 4 Sekunden, zeigt Racebook einen Hinweis, dass vermutlich ein anderes Fenster den Speicher blockiert.

## 11. Grenzen dieser Fassung

Siehe `Racebook-PWA-Ueberblick.md` (Änderungen, Grenzen, nächste Schritte) und den Testbericht im Test-ZIP (`tests/TESTBERICHT.md`).

## Entwicklung 1.3.0

Gezielte neue Modellprüfungen: `node --test tests/navigation.test.mjs` (Node 18+). Keine Installation von Paketen nötig. Sicherungen mit persönlicher Menübelegung verwenden Format 9; ältere Apps lehnen sie ab. Ohne eigene Menübelegung bleibt die Version so niedrig wie bisher (4–8). Die Datenbank bleibt Version 4, vorhandene Fahrzeug- und Lagerdaten werden nicht umgewandelt. Die PDF-Anleitung wurde nicht geändert. Foto-/Produkterkennung und die erweiterte Teilehistorie sind nicht Bestandteil dieser Navigationsänderung.
