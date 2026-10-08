#!/usr/bin/env python3
"""Bereitet Fotos für die Website vor.

- verkleinert auf Web-Größe (groß + Vorschaubild)
- Farbe, Tonwerte und Zuschnitt bleiben exakt wie exportiert
- entfernt ALLE Metadaten (EXIF, GPS, Kameradaten) – Farbprofil bleibt erhalten
- speichert als WebP

Aufruf:
    python3 tools/prepare.py <bild.jpg> [weitere ...] [--name slug]
    python3 tools/prepare.py <bild.jpg> --hero

--name   Dateiname ohne Endung (nur bei einem einzelnen Bild)
--hero   erzeugt das Startbild hinter dem Logo (assets/img/hero.webp).
         NUR hier wird das Bild bewusst in Schwarz-Weiß umgewandelt,
         damit das Logo zur Geltung kommt. Galeriebilder bleiben immer original.

Panoramen (Seitenverhältnis > 2:1) werden größer gespeichert, damit sie in voller
Breite scharf bleiben.

Ergebnis landet in assets/img/<name>.webp und assets/img/<name>-thumb.webp.
Am Ende wird die passende Zeile für assets/js/gallery.js ausgegeben.
"""
import argparse
import re
import sys
from pathlib import Path

from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = None  # große Panoramen erlauben

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "img"
FULL_EDGE = 2400
THUMB_EDGE = 1200
PANO_FULL_EDGE = 5000
PANO_THUMB_EDGE = 2600


def slugify(text: str) -> str:
    text = text.lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        text = text.replace(a, b)
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def to_bw(img: Image.Image) -> Image.Image:
    """Nur für das Startbild: Schwarz-Weiß mit Rotfilter-Look und sanfter S-Kurve."""
    mono = img.convert("RGB").convert("L", (0.55, 0.35, 0.10, 0))
    mono = ImageOps.autocontrast(mono, cutoff=0.5)
    lut = []
    for i in range(256):
        x = i / 255
        y = x * x * (3 - 2 * x)
        lut.append(round(255 * (0.55 * y + 0.45 * x)))
    return mono.point(lut).convert("RGB")


def save(img: Image.Image, icc, edge: int, path: Path, quality: int) -> Image.Image:
    im = img.copy()
    im.thumbnail((edge, edge), Image.LANCZOS)  # nur skalieren, nie beschneiden
    extra = {"icc_profile": icc} if icc else {}
    im.save(path, "WEBP", quality=quality, method=6, **extra)  # ohne exif= -> keine Metadaten
    print(f"  {path.relative_to(ROOT)}  {im.width}x{im.height}")
    return im


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--name")
    ap.add_argument("--hero", action="store_true")
    args = ap.parse_args()
    if args.hero:
        img = ImageOps.exif_transpose(Image.open(args.files[0]))
        save(to_bw(img), None, FULL_EDGE, OUT / "hero.webp", 84)
        return
    if args.name and len(args.files) > 1:
        sys.exit("--name geht nur bei einem einzelnen Bild")

    OUT.mkdir(parents=True, exist_ok=True)
    for f in args.files:
        src = Path(f)
        name = args.name or slugify(src.stem)
        print(src.name)
        img = Image.open(src)
        icc = img.info.get("icc_profile")
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        pano = img.width / img.height > 2
        save(img, icc, PANO_FULL_EDGE if pano else FULL_EDGE, OUT / f"{name}.webp", 88)
        t = save(img, icc, PANO_THUMB_EDGE if pano else THUMB_EDGE, OUT / f"{name}-thumb.webp", 82)
        print(f'  -> gallery.js: {{ file: "{name}", w: {t.width}, h: {t.height}, title: "", place: "", category: "" }},')


if __name__ == "__main__":
    main()
