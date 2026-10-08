# REWEN Fineart – Website

Statische Website (nur HTML/CSS/JS). Kein Server, keine Datenbank, keine laufenden Kosten.

## Struktur

```
index.html            Startseite (Texte direkt hier ändern)
werk.html             Detailseite pro Werk (werk.html?w=<name>), wird automatisch befüllt
impressum.html        ⚠️ Platzhalter ausfüllen, bevor die Seite online geht
datenschutz.html      ⚠️ Platzhalter ausfüllen
assets/js/gallery.js  ← HIER pflegst du Bilder, Geschichten, Shop-Link und Instagram
assets/img/           Bilder (WebP, ohne EXIF/GPS)
assets/css/style.css  Design
tools/prepare.py      Bilder für die Seite vorbereiten
```

## Neues Bild hinzufügen

```bash
python3 tools/prepare.py ~/Pictures/MeinExport.jpg --name nebelgrat
```

Das Skript ändert weder Farbe noch Zuschnitt – es skaliert nur und entfernt EXIF/GPS.
Es gibt dir die fertige Zeile für `assets/js/gallery.js` aus, z. B.:

```js
{ file: "nebelgrat", w: 800, h: 1200, title: "Nebelgrat", place: "Wetterstein", category: "berge",
  year: "2026", details: ["Sonnenaufgang", "Belichtung 1/250 s"],
  story: `Um halb fünf los, und oben war erstmal alles grau.

Dann, zehn Minuten vor dem Aufgeben, ist der Nebel aufgerissen ...` },
```

- `story` (optional): die Geschichte hinter dem Bild, erscheint auf der Werkseite. Leerzeile = neuer Absatz.
- Sobald es eine zweite Kategorie gibt, erscheinen automatisch Filter-Buttons über der Galerie.
- Exportiere aus Lightroom mit mind. 2400 px an der langen Kante, sRGB.

## Lokal ansehen

```bash
python3 -m http.server 8765
```

Dann http://localhost:8765 öffnen.

## Kostenlos online stellen (GitHub Pages)

1. Kostenloses Konto auf github.com anlegen, neues **öffentliches** Repository `rewen-fineart` erstellen.
2. Diesen Ordner hochladen (per „Add file → Upload files“ oder mit git).
3. Repository → *Settings → Pages* → Source: `Deploy from a branch`, Branch `main`, Ordner `/ (root)`.
4. Nach ~1 Minute läuft die Seite unter `https://<dein-name>.github.io/rewen-fineart/`.

### Eigene Domain verbinden

Die Domain selbst ist das Einzige, was etwas kostet (ca. 5–15 €/Jahr, z. B. bei INWX, Strato, Cloudflare).

1. In GitHub *Settings → Pages → Custom domain* `rewen-fineart.de` eintragen (legt eine `CNAME`-Datei an).
2. Beim Domain-Anbieter DNS-Einträge setzen:
   - `A`-Records für `@`: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `CNAME` für `www` → `<dein-name>.github.io`
3. Nach der DNS-Aktualisierung in GitHub **Enforce HTTPS** anhaken (kostenloses Zertifikat).

**Alternative:** Cloudflare Pages oder Netlify – ebenfalls kostenlos, Ordner einfach per Drag & Drop hochladen.
Dann in `datenschutz.html` den Hoster entsprechend anpassen.
