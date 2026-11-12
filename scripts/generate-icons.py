"""Genera los PNG de la PWA desde contact.svg; requiere rsvg-convert (librsvg)."""

from pathlib import Path
import shutil
import subprocess


def main() -> None:
    renderer = shutil.which("rsvg-convert")
    if renderer is None:
        raise SystemExit("Falta rsvg-convert (librsvg). Solo es necesario para regenerar los iconos.")

    icons = Path(__file__).resolve().parent.parent / "public" / "assets" / "icons"
    source = icons / "contact.svg"
    for size in (48, 72, 96, 128, 144, 152, 180, 192, 256, 384, 512):
        destination = icons / f"contact-{size}x{size}.png"
        subprocess.run(
            [renderer, "--width", str(size), "--height", str(size),
             "--output", str(destination), str(source)],
            check=True,
        )
        print(destination.name)


if __name__ == "__main__":
    main()
