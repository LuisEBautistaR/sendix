"""
Draws the Sendix logo: the "strata" timing bar (the app's signature) ending in
a send arrow, wrapped in JSON braces, on a dark stone tile. Writes
build/icon.png (1024 px), build/icon.ico (16-256 px) and docs/logo.svg.

Run: python -I build/logo.py [preview-dir]
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
S = 1024
TILE = "#333231"
STRATA = ["#6f675f", "#a99d8e", "#c3b8aa", "#e4e1dd"]
ARROW = "#9db091"
BRACES = "#a99d8e"

# Geometry on a 1024 grid (shared by the PNG and the SVG).
RADIUS = 228
BAR_Y, BAR_H, BAR_R = 442, 140, 18
SEGMENTS = [(268, 67), (348, 78), (439, 90), (541, 102)]  # x, width
ARROW_PTS = [(655, 358), (756, 512), (655, 666)]
BRACE_W = 52
# Left brace as (command, points); the right one is its mirror image.
BRACE_L = [("M", (286, 236)), ("Q", (196, 236), (196, 320)), ("L", (196, 432)), ("Q", (196, 512), (126, 512)),
           ("Q", (196, 512), (196, 592)), ("L", (196, 704)), ("Q", (196, 788), (286, 788))]
BRACE_R = [(c, *[(S - x, y) for x, y in pts]) for c, *pts in BRACE_L]


def flatten(path, steps=32):
    pts = []
    for c, *p in path:
        if c in ("M", "L"):
            pts.append(p[0])
        else:  # quadratic curve from the last point
            p0, p1, p2 = pts[-1], p[0], p[1]
            for i in range(1, steps + 1):
                t = i / steps
                pts.append(tuple((1 - t) ** 2 * p0[k] + 2 * (1 - t) * t * p1[k] + t * t * p2[k] for k in (0, 1)))
    return pts


def draw(size: int) -> Image.Image:
    k = 4  # supersample, then shrink for smooth edges
    big = S * k
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, big - 1, big - 1], radius=RADIUS * k, fill=TILE)
    for (x, w), color in zip(SEGMENTS, STRATA):
        d.rounded_rectangle([x * k, BAR_Y * k, (x + w) * k, (BAR_Y + BAR_H) * k], radius=BAR_R * k, fill=color)
    d.polygon([(x * k, y * k) for x, y in ARROW_PTS], fill=ARROW)
    # Braces: a round brush stamped along each path (PIL's thick-line joints leave spikes on curves).
    half = BRACE_W * k / 2
    for path in (BRACE_L, BRACE_R):
        pts = [(x * k, y * k) for x, y in flatten(path)]
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            n = max(1, int(math.dist((ax, ay), (bx, by)) / (half / 6)))
            for i in range(n + 1):
                px, py = ax + (bx - ax) * i / n, ay + (by - ay) * i / n
                d.ellipse([px - half, py - half, px + half, py + half], fill=BRACES)
    return img.resize((size, size), Image.LANCZOS)


def svg() -> str:
    rects = "".join(
        f'<rect x="{x}" y="{BAR_Y}" width="{w}" height="{BAR_H}" rx="{BAR_R}" fill="{c}"/>'
        for (x, w), c in zip(SEGMENTS, STRATA)
    )
    pts = " ".join(f"{x},{y}" for x, y in ARROW_PTS)
    braces = "".join(
        '<path d="' + " ".join(c + " ".join(f"{x:g} {y:g}" for x, y in p) for c, *p in path) + '"/>'
        for path in (BRACE_L, BRACE_R)
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" role="img" aria-label="Sendix">'
        f'<rect width="{S}" height="{S}" rx="{RADIUS}" fill="{TILE}"/>{rects}<polygon points="{pts}" fill="{ARROW}"/>'
        f'<g fill="none" stroke="{BRACES}" stroke-width="{BRACE_W}" stroke-linecap="round" stroke-linejoin="round">'
        f"{braces}</g></svg>\n"
    )


if __name__ == "__main__":
    if len(sys.argv) > 1:  # preview only
        out = Path(sys.argv[1])
        out.mkdir(parents=True, exist_ok=True)
        draw(1024).save(out / "icon.png")
        for s in (16, 32, 48):
            draw(s).resize((s * 8, s * 8), Image.NEAREST).save(out / f"icon-{s}.png")
        print("preview ok")
    else:
        (ROOT / "build").mkdir(exist_ok=True)
        draw(1024).save(ROOT / "build" / "icon.png")
        draw(256).save(ROOT / "build" / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
        (ROOT / "docs" / "logo.svg").write_text(svg(), encoding="utf-8")
        print("ok")
