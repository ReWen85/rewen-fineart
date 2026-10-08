/* ============================================================
   HIER PFLEGST DU DEINE SEITE
   Neue Bilder: erst mit tools/prepare.py vorbereiten (das Skript gibt
   dir die fertige Zeile aus), dann unten eintragen.
   Reihenfolge = Reihenfolge auf der Seite.
   ============================================================ */

window.SITE = {
  // Dein pictrs-Shop (leer lassen = Shop-Bereich wird ausgeblendet)
  shopUrl: "https://www.pictrs.com/rewen",

  // Kontakt läuft über Instagram (leer lassen = Kontaktbereich wird ausgeblendet)
  instagramUrl: "https://www.instagram.com/rewen_fa/",
};

window.GALLERY = [
  // file:     Dateiname in assets/img ohne Endung
  // w, h:     Maße des Vorschaubilds (gibt prepare.py aus) – damit nichts springt
  // title:    Werktitel
  // place:    Ort / Region (darf vage bleiben – Spots müssen nicht verraten werden)
  // category: "wasserfall", "berge", "seen", ... (ab zwei Kategorien erscheinen Filter)
  //           Panoramen (breiter als 1,6:1) bekommen automatisch die volle Breite.
  //
  // Optional:
  // year:     z. B. "2026"
  // details:  kurze Fakten, z. B. ["Belichtung 2 s", "ND-Filter", "Sonnenaufgang"]
  // shop:     Direktlink zu genau diesem Bild bei pictrs
  // story:    die Geschichte hinter dem Bild. Leerzeile = neuer Absatz.
  //           Beispiel:
  //           story: `Um halb fünf aufgestanden, und natürlich hat es geregnet.
  //
  //           Zwei Stunden später ...`,
  { file: "kaskade",             w: 800,  h: 1200, title: "Kaskade",              place: "Bayerische Voralpen",  category: "wasserfall" },
  { file: "moosvorhang",         w: 800,  h: 1200, title: "Moosvorhang",          place: "Frankreich",            category: "wasserfall" },
  { file: "fels-und-faden",      w: 800,  h: 1200, title: "Fels und Faden",       place: "Alpenraum",            category: "wasserfall" },
  { file: "walchensee-panorama", w: 2600, h: 473,  title: "Walchensee im Winterlicht", place: "Walchensee, Oberbayern", category: "berge" },
  { file: "lichtschacht",        w: 800,  h: 1200, title: "Lichtschacht",         place: "Triberger Wasserfälle, Schwarzwald",            category: "wasserfall" },
  { file: "steinstufen",         w: 800,  h: 1200, title: "Steinstufen",          place: "Alpenraum",            category: "wasserfall" },
  { file: "glut-am-ufer",        w: 800,  h: 1200, title: "Glut am Ufer",         place: "Starnberger See, Oberbayern",           category: "seen" },
  { file: "eibsee-zugspitze",    w: 2600, h: 900,  title: "Eibsee & Zugspitze",   place: "Eibsee, Wetterstein",  category: "berge" },
];

window.CATEGORY_LABELS = {
  wasserfall: "Wasserfälle",
  berge: "Berge",
  seen: "Seen",
};
