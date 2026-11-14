"""Generate PNG and SVG QR codes for a caller-supplied web address."""

import argparse
from io import BytesIO
import json
from pathlib import Path
from urllib.parse import urlsplit

from PIL import Image, ImageDraw
from reportlab.graphics.barcode.qr import QrCodeWidget


QUIET_ZONE = 4
MODULE_PIXELS = 16
ERROR_CORRECTION = "M"


def web_url(value: str) -> str:
    try:
        parts = urlsplit(value)
        if (parts.scheme not in {"http", "https"} or not parts.hostname
                or parts.username is not None or parts.password is not None
                or any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in value)):
            raise ValueError
        # Accessing port also validates its format and range.
        _ = parts.port
    except ValueError:
        raise argparse.ArgumentTypeError("use an absolute HTTP(S) URL without credentials or whitespace") from None
    return value


def generate(url: str) -> tuple[bytes, bytes, bytes]:
    widget = QrCodeWidget(url, barLevel=ERROR_CORRECTION)
    try:
        widget.qr.make()
    except Exception as exc:
        if str(exc).startswith("code length overflow"):
            raise ValueError("URL exceeds QR code capacity") from None
        raise
    modules = widget.qr.getModuleCount()
    extent = modules + 2 * QUIET_ZONE
    size = extent * MODULE_PIXELS
    image = Image.new("RGB", (size, size), "white")
    draw = ImageDraw.Draw(image)
    rectangles = []
    for row, values in enumerate(widget.qr.modules):
        for column, dark in enumerate(values):
            if dark:
                x, y = column + QUIET_ZONE, row + QUIET_ZONE
                left, top = x * MODULE_PIXELS, y * MODULE_PIXELS
                draw.rectangle((left, top, left + MODULE_PIXELS - 1, top + MODULE_PIXELS - 1), fill="black")
                rectangles.append(f'<rect x="{x}" y="{y}" width="1" height="1"/>')
    png = BytesIO()
    image.save(png, format="PNG")
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {extent} {extent}" '
        f'width="{size}" height="{size}" shape-rendering="crispEdges">'
        '<rect width="100%" height="100%" fill="white"/><g fill="black">'
        + "".join(rectangles) + "</g></svg>\n"
    )
    metadata = {
        "errorCorrection": ERROR_CORRECTION,
        "quietZoneModules": QUIET_ZONE,
        "matrixModules": modules,
        "modulePixels": MODULE_PIXELS,
        "widthPixels": size,
    }
    return png.getvalue(), svg.encode("utf-8"), (json.dumps(metadata, indent=2) + "\n").encode("utf-8")


def write_new(outputs: list[Path], contents: tuple[bytes, bytes, bytes]) -> None:
    created = []
    try:
        for path, payload in zip(outputs, contents):
            with path.open("xb") as output:
                created.append(path)
                output.write(payload)
    except OSError:
        for path in reversed(created):
            path.unlink(missing_ok=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", type=web_url, help="absolute HTTP(S) URL to encode")
    parser.add_argument("--output-prefix", type=Path, required=True, help="output path without a file extension")
    args = parser.parse_args()
    if not args.output_prefix.name:
        parser.error("--output-prefix must include a file name")
    outputs = [args.output_prefix.with_name(args.output_prefix.name + suffix) for suffix in (".png", ".svg", ".json")]
    if any(path.exists() or path.is_symlink() for path in outputs):
        parser.error("refusing to overwrite an existing output")
    try:
        write_new(outputs, generate(args.url))
    except (OSError, ValueError, OverflowError) as exc:
        parser.exit(1, f"Could not generate QR files: {exc}\n")
    for path in outputs:
        print(path)


if __name__ == "__main__":
    main()
