"""Regenerates public/og-image.png (1200x630). Run: python3 scripts/generate-og-image.py"""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1200, 630
img = Image.new("RGB", (W, H))
px = img.load()
for y in range(H):
    for x in range(W):
        t = (x / W + y / H) / 2
        px[x, y] = (int(14 + 70 * t), int(14 + 20 * t), int(16 + 110 * t))
d = ImageDraw.Draw(img)

def font(size, bold=True):
    for p in ["/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

d.rounded_rectangle((80, 120, 200, 240), 28, fill=(145, 70, 255))
d.polygon([(118, 150), (118, 210), (170, 180)], fill="white")
d.text((80, 290), "ClipSpike", font=font(120), fill="white")
d.text((84, 440), "Live Twitch highlights, ranked by chat and views", font=font(40), fill=(220, 210, 255))
d.text((84, 530), "clipspike.com/app", font=font(30), fill=(170, 160, 210))
img.save(os.path.join(os.path.dirname(__file__), "..", "public", "og-image.png"), optimize=True)
