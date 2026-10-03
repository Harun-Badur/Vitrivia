"""Run real CPU inference against a user-provided local garment photo."""
import sys
from pathlib import Path
from rembg import new_session, remove
from processor import cutout_png

if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python smoke.py input.jpg cutout.png")
    source, destination = map(Path, sys.argv[1:])
    if source.resolve() == destination.resolve():
        raise SystemExit("Output must not overwrite the original")
    session = new_session("u2netp", providers=["CPUExecutionProvider"])
    result = cutout_png(source.read_bytes(), session, remove)
    destination.write_bytes(result)
    print(f"Transparent PNG written ({len(result)} bytes)")
