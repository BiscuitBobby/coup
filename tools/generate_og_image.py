#!/usr/bin/env python3

from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent

# --- Brand palette (mirrors style.css :root) ---------------------------------
GOLD = (212, 175, 55)
GOLD_BRIGHT = (244, 217, 123)
GOLD_DEEP = (156, 122, 34)
PARCHMENT = (233, 220, 192)
BG_CORE = (26, 16, 48)      # #1a1030
BG_MID = (10, 6, 16)        # #0a0610
BG_EDGE = (5, 3, 8)         # #050308

FONTS = "/usr/share/fonts/truetype/noto"
F_TITLE = f"{FONTS}/NotoSerifDisplay-Black.ttf"
F_ITALIC = f"{FONTS}/NotoSerifDisplay-Italic.ttf"
F_SERIF = f"{FONTS}/NotoSerif-Regular.ttf"
F_SERIF_BOLD = f"{FONTS}/NotoSerif-Bold.ttf"


def radial_bg(w, h):
    """Radial gradient: warm purple core fading to near-black edges."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = w * 0.5, h * 0.42
    d = np.sqrt(((xx - cx) / (w * 0.62)) ** 2 + ((yy - cy) / (h * 0.62)) ** 2)
    d = np.clip(d, 0, 1)
    # two-stop blend core->mid (0..0.7) then mid->edge (0.7..1)
    out = np.zeros((h, w, 3), np.float32)
    for i, (a, b, lo, hi) in enumerate(
        [(BG_CORE, BG_MID, 0.0, 0.7), (BG_MID, BG_EDGE, 0.7, 1.0)]
    ):
        mask = (d >= lo) & (d <= hi)
        t = ((d - lo) / (hi - lo))[..., None]
        seg = np.array(a) * (1 - t) + np.array(b) * t
        out[mask] = seg[mask]
    return Image.fromarray(out.astype(np.uint8), "RGB")


def spaced_text(draw, xy, text, font, fill, tracking, anchor_center=True, stroke=0, stroke_fill=None):
    """Draw text with manual letter-spacing; returns total width."""
    widths = []
    for ch in text:
        bb = font.getbbox(ch)
        widths.append(bb[2] - bb[0])
    total = sum(widths) + tracking * (len(text) - 1)
    x, y = xy
    if anchor_center:
        x -= total / 2
    for ch, wd in zip(text, widths):
        bb = font.getbbox(ch)
        draw.text((x - bb[0], y), ch, font=font, fill=fill,
                  stroke_width=stroke, stroke_fill=stroke_fill)
        x += wd + tracking
    return total


def main():
    W, H = 1200, 630
    img = radial_bg(W, H).convert("RGBA")

    # Subtle vignette to deepen the corners.
    vig = Image.new("L", (W, H), 0)
    vd = ImageDraw.Draw(vig)
    vd.ellipse([-W * 0.25, -H * 0.25, W * 1.25, H * 1.25], fill=70)
    vig = vig.filter(ImageFilter.GaussianBlur(120))
    dark = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    img = Image.composite(img, dark, vig)

    draw = ImageDraw.Draw(img)

    # Double gold frame.
    draw.rectangle([26, 26, W - 27, H - 27], outline=GOLD_DEEP, width=2)
    draw.rectangle([34, 34, W - 35, H - 35], outline=GOLD + (90,), width=1)

    # --- Title: COUP with a soft golden glow ---
    f_title = ImageFont.truetype(F_TITLE, 188)
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    spaced_text(gd, (W / 2, 150), "COUP", f_title, GOLD + (255,), tracking=26)
    glow = glow.filter(ImageFilter.GaussianBlur(22))
    img.alpha_composite(glow)
    draw = ImageDraw.Draw(img)
    spaced_text(draw, (W / 2, 150), "COUP", f_title, GOLD_BRIGHT, tracking=26,
                stroke=1, stroke_fill=GOLD_DEEP)

    # --- Tagline (italic) ---
    f_tag = ImageFont.truetype(F_ITALIC, 40)
    tag = "~  a game of deception  ~"
    tb = draw.textbbox((0, 0), tag, font=f_tag)
    draw.text(((W - (tb[2] - tb[0])) / 2, 372), tag, font=f_tag, fill=(184, 155, 102))

    # --- Divider rule ---
    cx = W / 2
    for i in range(120):
        a = int(160 * (1 - abs(i - 60) / 60))
        draw.line([(cx - 120 + i * 2, 440), (cx - 120 + i * 2 + 2, 440)], fill=GOLD + (a,), width=1)

    # --- Small-caps creed ---
    f_creed = ImageFont.truetype(F_SERIF_BOLD, 24)
    spaced_text(draw, (W / 2, 462), "DECEIVE  ·  DEDUCE  ·  DOMINATE", f_creed, PARCHMENT, tracking=6)

    # --- Character chips ---
    f_chip = ImageFont.truetype(F_SERIF, 21)
    chars = "Duke   Assassin   Captain   Ambassador   Contessa"
    cb = draw.textbbox((0, 0), chars, font=f_chip)
    draw.text(((W - (cb[2] - cb[0])) / 2, 540), chars, font=f_chip, fill=GOLD_DEEP)

    out = img.convert("RGB")
    out.save(ROOT / "og-image.png", "PNG", optimize=True)
    print("wrote og-image.png", out.size)

    # --- Icons: render a compact crest "C" card glyph ---
    def make_icon(size):
        s = size * 4  # supersample
        ic = radial_bg(s, s).convert("RGBA")
        d = ImageDraw.Draw(ic)
        pad = s * 0.09
        d.rounded_rectangle([pad, pad, s - pad, s - pad], radius=s * 0.16,
                            outline=GOLD, width=max(2, int(s * 0.03)))
        fc = ImageFont.truetype(F_TITLE, int(s * 0.62))
        bb = d.textbbox((0, 0), "C", font=fc)
        d.text(((s - (bb[2] - bb[0])) / 2 - bb[0], (s - (bb[3] - bb[1])) / 2 - bb[1]),
               "C", font=fc, fill=GOLD_BRIGHT, stroke_width=max(1, int(s * 0.006)),
               stroke_fill=GOLD_DEEP)
        return ic.resize((size, size), Image.LANCZOS)

    make_icon(180).convert("RGB").save(ROOT / "apple-touch-icon.png", "PNG", optimize=True)
    print("wrote apple-touch-icon.png 180x180")
    make_icon(48).save(ROOT / "favicon.png", "PNG", optimize=True)
    print("wrote favicon.png 48x48")
    for sz in (192, 512):  # PWA / manifest installability
        make_icon(sz).save(ROOT / f"icon-{sz}.png", "PNG", optimize=True)
        print(f"wrote icon-{sz}.png {sz}x{sz}")


if __name__ == "__main__":
    main()
