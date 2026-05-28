"""
Genera los assets visuales de VOLT:
  - assets/icon.png          1024x1024  (ícono App Store / Play Store)
  - assets/adaptive-icon.png 1024x1024  (foreground Android adaptive)
  - assets/splash-icon.png   1024x1024  (logo centrado en el splash)
  - assets/favicon.png         48x48    (web)
"""

from PIL import Image, ImageDraw, ImageFont
import os, math

BLACK  = (10, 10, 10, 255)
YELLOW = (255, 214, 0, 255)
WHITE  = (245, 245, 245, 255)

ASSETS = os.path.join(os.path.dirname(__file__), "assets")

# ─── Helpers ────────────────────────────────────────────────────────────────

def new(size, bg):
    img = Image.new("RGBA", (size, size), bg)
    return img, ImageDraw.Draw(img)

def draw_bolt(draw, cx, cy, h, color):
    """Dibuja un rayo clásico centrado en (cx, cy) de altura h."""
    w = h * 0.52
    # Polígono del rayo (proporciones clásicas)
    pts = [
        (cx + w * 0.18,  cy - h * 0.50),   # top-right
        (cx - w * 0.05,  cy - h * 0.04),   # notch-left
        (cx + w * 0.22,  cy - h * 0.04),   # notch-right
        (cx - w * 0.18,  cy + h * 0.50),   # bottom-left
        (cx + w * 0.05,  cy + h * 0.04),   # notch-right-low
        (cx - w * 0.22,  cy + h * 0.04),   # notch-left-low
    ]
    draw.polygon(pts, fill=color)

def draw_text_volt(draw, cx, cy, font_size, color):
    """Dibuja VOLT centrado horizontalmente en cx, con top en cy."""
    try:
        # Intenta fuentes bold del sistema
        for name in ["arialbd.ttf", "Arial Bold.ttf", "DejaVuSans-Bold.ttf",
                      "LiberationSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]:
            try:
                font = ImageFont.truetype(name, font_size)
                break
            except:
                continue
        else:
            font = ImageFont.load_default()
    except:
        font = ImageFont.load_default()

    text = "VOLT"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    draw.text((cx - tw // 2, cy - bbox[1]), text, fill=color, font=font)
    return th

def rounded_rect(draw, xy, radius, fill):
    x0, y0, x1, y1 = xy
    draw.rounded_rectangle([x0, y0, x1, y1], radius=radius, fill=fill)

# ─── ICON 1024×1024 ─────────────────────────────────────────────────────────

def make_icon(size=1024):
    img, draw = new(size, BLACK)

    # Fondo con esquinas redondeadas (el sistema las recorta, pero ayuda)
    margin = int(size * 0.0)
    rounded_rect(draw, [margin, margin, size-margin, size-margin],
                 radius=int(size * 0.22), fill=BLACK)

    # Rayo centrado, ocupa ~42% de la altura
    bolt_h = int(size * 0.42)
    bolt_cy = int(size * 0.40)   # ligeramente arriba del centro
    draw_bolt(draw, size // 2, bolt_cy, bolt_h, YELLOW)

    # Texto VOLT debajo del rayo
    font_sz = int(size * 0.155)
    text_top = bolt_cy + bolt_h // 2 + int(size * 0.03)
    draw_text_volt(draw, size // 2, text_top, font_sz, WHITE)

    return img

# ─── ADAPTIVE ICON 1024×1024 ────────────────────────────────────────────────
# Android recorta un círculo/squircle del 72% central → diseño sin padding extra

def make_adaptive_icon(size=1024):
    img, draw = new(size, (0, 0, 0, 0))   # transparente para que el sistema ponga el fondo

    # Solo el contenido (el fondo amarillo se define en app.json backgroundColor)
    bolt_h = int(size * 0.50)
    bolt_cy = int(size * 0.42)
    draw_bolt(draw, size // 2, bolt_cy, bolt_h, YELLOW)

    font_sz = int(size * 0.17)
    text_top = bolt_cy + bolt_h // 2 + int(size * 0.025)
    draw_text_volt(draw, size // 2, text_top, font_sz, WHITE)

    return img

# ─── SPLASH ICON 1024×1024 ──────────────────────────────────────────────────
# Expo lo centra sobre backgroundColor #0A0A0A con resizeMode contain

def make_splash(size=1024):
    img, draw = new(size, (0, 0, 0, 0))   # transparente

    bolt_h = int(size * 0.48)
    bolt_cy = int(size * 0.41)
    draw_bolt(draw, size // 2, bolt_cy, bolt_h, YELLOW)

    font_sz = int(size * 0.175)
    text_top = bolt_cy + bolt_h // 2 + int(size * 0.03)
    draw_text_volt(draw, size // 2, text_top, font_sz, WHITE)

    return img

# ─── FAVICON 48×48 ──────────────────────────────────────────────────────────

def make_favicon(size=48):
    img, draw = new(size, BLACK)
    bolt_h = int(size * 0.72)
    draw_bolt(draw, size // 2, size // 2, bolt_h, YELLOW)
    return img

# ─── Main ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    make_icon(1024).save(os.path.join(ASSETS, "icon.png"))
    print("icon.png OK")

    adaptive = make_adaptive_icon(1024)
    adaptive.save(os.path.join(ASSETS, "adaptive-icon.png"))
    print("adaptive-icon.png OK")

    make_splash(1024).save(os.path.join(ASSETS, "splash-icon.png"))
    print("splash-icon.png OK")

    make_favicon(48).save(os.path.join(ASSETS, "favicon.png"))
    print("favicon.png OK")

    print("\nDone. Archivos guardados en assets/")
