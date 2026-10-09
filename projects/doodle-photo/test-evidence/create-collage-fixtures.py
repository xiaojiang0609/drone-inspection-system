from pathlib import Path
from PIL import Image, ImageDraw
import struct
import zlib
root = Path(__file__).parent / "collage-fixtures"
root.mkdir(exist_ok=True)
for i, color in enumerate(["#e4864b", "#6c9b71", "#507ea5"]):
    image = Image.new("RGBA", (180, 120), "#f2eadc")
    draw = ImageDraw.Draw(image)
    draw.ellipse((35, 20, 145, 105), fill=color)
    image.save(root / f"source-{i+1}.png")
cutout = Image.new("RGBA", (110, 85))
ImageDraw.Draw(cutout).ellipse((2, 2, 108, 83), fill="#e4864b")
cutout.save(root / "cutout.png")
photo = Image.new("RGB", (360, 240), "#d6bd9b")
ImageDraw.Draw(photo).rectangle((0, 0, 180, 240), fill="#547468")
exif = Image.Exif()
exif[274] = 6
photo.save(root / "exif-6.jpg", exif=exif)
print(root.resolve())

# Deterministic technical cases: no external photos or image services.
hole = Image.new("RGBA", (160, 120))
draw = ImageDraw.Draw(hole)
draw.rectangle((20, 20, 105, 100), fill="#e4864b")
draw.rectangle((40, 40, 85, 80), fill=(0, 0, 0, 0))
draw.rectangle((130, 45, 150, 65), fill="#6c9b71")
hole.save(root / "hole-fragments.png")
for name, size in [("landscape.png", (1200, 80)), ("portrait.png", (80, 1200))]:
    Image.new("RGB", size, "#507ea5").save(root / name)
frames = [Image.new("RGBA", (30, 20), color) for color in ["red", "blue"]]
frames[0].save(root / "animated.png", save_all=True, append_images=frames[1:], duration=100, loop=0)
frames[0].save(root / "animated.webp", save_all=True, append_images=frames[1:], duration=100, loop=0)
frames[0].convert("RGB").save(root / "static.webp")
(root / "corrupt.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"damaged image header\x00")
# A valid container header exceeds the pixel budget; validation must reject
# before attempting the intentionally tiny payload's decode/allocation.
large_header = bytearray((root / "source-1.png").read_bytes())
large_header[16:24] = struct.pack(">II", 6500, 6500)
large_header[29:33] = struct.pack(">I", zlib.crc32(large_header[12:29]))
(root / "over-pixels.png").write_bytes(large_header)
