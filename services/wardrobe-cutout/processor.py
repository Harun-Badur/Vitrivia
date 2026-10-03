"""CPU-only wardrobe background removal. Originals are never overwritten."""
from io import BytesIO
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 40_000_000
MAX_IMAGE_BYTES = 12 * 1024 * 1024


def cutout_png(data: bytes, session, remove) -> bytes:
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise ValueError("Invalid image size")
    with Image.open(BytesIO(data)) as source:
        source.load()
        image = ImageOps.exif_transpose(source).convert("RGB")
    image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
    output = remove(image, session=session).convert("RGBA")
    low, high = output.getchannel("A").getextrema()
    if low == 255 or high == 0:
        raise ValueError("No usable foreground mask")
    result = BytesIO()
    # Strip source EXIF, GPS and other photo metadata from the exported cutout.
    clean = Image.frombytes("RGBA", output.size, output.tobytes())
    clean.save(result, format="PNG")
    value = result.getvalue()
    if len(value) > MAX_IMAGE_BYTES:
        raise ValueError("Cutout too large")
    return value
