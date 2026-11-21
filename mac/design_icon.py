#!/usr/bin/env python3
"""Render the ClipSpike app icon with Pillow.

Design: a 9:16 cream clip card with a chat-bubble tail, a chartreuse
highlighter swipe, a deep-ink play mark, and a coral spark on an
ink-violet squircle. Rendered at 2x and downsampled for clean edges.
"""
from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
S = 2
W = 1024 * S


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vertical_gradient(size, top, bottom):
    img = Image.new("RGB", (1, size[1]))
    px = img.load()
    for y in range(size[1]):
        t = y / max(1, size[1] - 1)
        px[0, y] = lerp(top, bottom, t)
    return img.resize(size, Image.Resampling.BILINEAR)


def radial_glow(size, center, radius, color, strength):
    layer = Image.new("L", size, 0)
    d = ImageDraw.Draw(layer)
    d.ellipse(
        (center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius),
        fill=strength,
    )
    layer = layer.filter(ImageFilter.GaussianBlur(radius * 0.45))
    solid = Image.new("RGBA", size, color + (0,))
    solid.putalpha(layer)
    return solid


def rounded_mask(size, box, radius):
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
    return mask


def paste_masked(base, layer, mask):
    base.alpha_composite(Image.composite(layer, Image.new("RGBA", base.size, (0, 0, 0, 0)), mask))


def star_points(cx, cy, outer, inner, points=4, rotation=-math.pi / 2):
    result = []
    for i in range(points * 2):
        angle = rotation + i * math.pi / points
        r = outer if i % 2 == 0 else inner
        result.append((cx + math.cos(angle) * r, cy + math.sin(angle) * r))
    return result


def main():
    size = (W, W)
    # Background gradient and glow.
    base = vertical_gradient(size, (42, 27, 84), (8, 7, 16)).convert("RGBA")
    base.alpha_composite(radial_glow(size, (W * 0.30, W * 0.18), W * 0.52, (126, 92, 255), 110))
    base.alpha_composite(radial_glow(size, (W * 0.78, W * 0.78), W * 0.48, (62, 224, 196), 42))

    # Subtle grain.
    grain = Image.new("RGBA", size, (0, 0, 0, 0))
    gp = grain.load()
    rng = random.Random(7)
    for _ in range(90000):
        x = rng.randrange(W)
        y = rng.randrange(W)
        v = rng.randrange(0, 20)
        gp[x, y] = (255, 255, 255, v)
    base.alpha_composite(grain)

    # Squircle mask.
    margin = 64 * S
    box = (margin, margin, W - margin, W - margin)
    radius = 210 * S
    squircle = rounded_mask(size, box, radius)
    clipped = Image.new("RGBA", size, (0, 0, 0, 0))
    clipped.alpha_composite(base)
    clipped.putalpha(squircle)

    # Inner rim.
    rim = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(rim)
    d.rounded_rectangle(
        (box[0] + 2 * S, box[1] + 2 * S, box[2] - 2 * S, box[3] - 2 * S),
        radius=radius - 2 * S,
        outline=(255, 255, 255, 30),
        width=2 * S,
    )
    clipped.alpha_composite(rim)

    # Card geometry (before rotation).
    card_w, card_h = 372 * S, 548 * S
    card_x = (W - card_w) // 2
    card_y = 232 * S
    card_box = (card_x, card_y, card_x + card_w, card_y + card_h)
    card_r = 68 * S

    # Card shadow.
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle(
        (card_box[0] + 16 * S, card_box[1] + 30 * S, card_box[2] + 16 * S, card_box[3] + 30 * S),
        radius=card_r,
        fill=(0, 0, 0, 150),
    )
    tail_pts = [
        (card_x + 44 * S, card_y + card_h - 10 * S),
        (card_x + 26 * S, card_y + card_h + 74 * S),
        (card_x + 142 * S, card_y + card_h - 12 * S),
    ]
    sd.polygon(tail_pts, fill=(0, 0, 0, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(34 * S))
    clipped.alpha_composite(shadow)

    # Card layer.
    card = Image.new("RGBA", size, (0, 0, 0, 0))
    cd = ImageDraw.Draw(card)
    # Cream gradient via mask.
    cream = vertical_gradient(size, (255, 249, 238), (232, 214, 190)).convert("RGBA")
    card_mask = Image.new("L", size, 0)
    cm = ImageDraw.Draw(card_mask)
    cm.rounded_rectangle(card_box, radius=card_r, fill=255)
    cm.polygon(tail_pts, fill=255)
    card.alpha_composite(Image.composite(cream, Image.new("RGBA", size, (0, 0, 0, 0)), card_mask))

    # Card inner border.
    cd.rounded_rectangle(card_box, radius=card_r, outline=(255, 255, 255, 160), width=3 * S)

    # Chat lines at the top of the card: minimal, tonal.
    line_color = (43, 28, 70, 44)
    for i, w in enumerate((176, 124, 150)):
        x0 = card_x + 42 * S
        y0 = card_y + 54 * S + i * 26 * S
        cd.rounded_rectangle((x0, y0, x0 + w * S, y0 + 10 * S), radius=5 * S, fill=line_color)

    # Highlighter swipe (underlay + main stroke), behind the play mark.
    under = Image.new("RGBA", size, (0, 0, 0, 0))
    ud = ImageDraw.Draw(under)
    u_start = (card_x + 64 * S, card_y + 414 * S)
    u_end = (card_x + 316 * S, card_y + 246 * S)
    ud.line([u_start, u_end], fill=(255, 106, 122, 64), width=118 * S)
    for p in (u_start, u_end):
        ud.ellipse((p[0] - 59 * S, p[1] - 59 * S, p[0] + 59 * S, p[1] + 59 * S), fill=(255, 106, 122, 64))
    under = under.filter(ImageFilter.GaussianBlur(10 * S))
    card.alpha_composite(under)

    hi = Image.new("RGBA", size, (0, 0, 0, 0))
    hd = ImageDraw.Draw(hi)
    h_start = (card_x + 68 * S, card_y + 392 * S)
    h_end = (card_x + 302 * S, card_y + 252 * S)
    hd.line([h_start, h_end], fill=(214, 255, 92, 238), width=88 * S)
    for p in (h_start, h_end):
        hd.ellipse((p[0] - 44 * S, p[1] - 44 * S, p[0] + 44 * S, p[1] + 44 * S), fill=(214, 255, 92, 238))
    hi = hi.filter(ImageFilter.GaussianBlur(0.6 * S))
    card.alpha_composite(hi)

    # Deep ink play mark.
    play_center = (card_x + 196 * S, card_y + 342 * S)
    pw, ph = 132 * S, 164 * S
    p1 = (play_center[0] - pw * 0.43, play_center[1] - ph / 2)
    p2 = (play_center[0] - pw * 0.43, play_center[1] + ph / 2)
    p3 = (play_center[0] + pw * 0.58, play_center[1])
    # soft drop shadow
    pshadow = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(pshadow).polygon(
        [(p1[0] + 5 * S, p1[1] + 10 * S), (p2[0] + 5 * S, p2[1] + 10 * S), (p3[0] + 5 * S, p3[1] + 10 * S)],
        fill=(0, 0, 0, 55),
    )
    pshadow = pshadow.filter(ImageFilter.GaussianBlur(8 * S))
    card.alpha_composite(pshadow)
    cd.polygon([p1, p2, p3], fill=(18, 13, 31, 255))
    # Fine highlight inside play.
    cd.line([(p1[0] + 10 * S, p1[1] + 18 * S), (p3[0] - 10 * S, p3[1] - 2 * S)], fill=(255, 255, 255, 22), width=2 * S)

    # Small coral sparkle on the card's upper right.
    spark_center = (card_x + card_w - 38 * S, card_y + 72 * S)
    cd.polygon(star_points(spark_center[0], spark_center[1], 34 * S, 8 * S, points=4), fill=(255, 122, 112, 255))

    # Rotate card around its center.
    angle = -8
    card = card.rotate(angle, resample=Image.Resampling.BICUBIC, center=(W // 2, card_y + card_h // 2))
    clipped.alpha_composite(card)

    # Extra sparkle outside card for energy.
    spark2 = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(spark2).polygon(
        star_points(W * 0.755, W * 0.238, 46 * S, 10 * S, points=4),
        fill=(214, 255, 92, 220),
    )
    clipped.alpha_composite(spark2.filter(ImageFilter.GaussianBlur(0.5 * S)))

    # Final downsample.
    final = clipped.resize((1024, 1024), Image.Resampling.LANCZOS)
    final.save(ROOT / "icon.png")
    # A quiet 512 preview for docs/site.
    final.resize((512, 512), Image.Resampling.LANCZOS).save(ROOT / "icon-512.png")
    print("wrote", ROOT / "icon.png")


if __name__ == "__main__":
    main()
