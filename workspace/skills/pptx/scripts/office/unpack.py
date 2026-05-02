#!/usr/bin/env python3
import argparse
import shutil
import zipfile
from pathlib import Path


def default_output(src: Path) -> Path:
    return src.parent / f"{src.stem}_unpacked"


def main() -> int:
    parser = argparse.ArgumentParser(description="Unpack a PPTX file into a working directory.")
    parser.add_argument("pptx", help="Source PPTX file")
    parser.add_argument("--output", help="Destination directory")
    parser.add_argument("--force", action="store_true", help="Replace existing output directory")
    args = parser.parse_args()

    src = Path(args.pptx).expanduser().resolve()
    if not src.is_file():
        raise SystemExit(f"Source PPTX not found: {src}")

    output = Path(args.output).expanduser().resolve() if args.output else default_output(src)
    if output.exists():
        if not args.force:
            raise SystemExit(f"Output already exists: {output}. Use --force to replace it.")
        shutil.rmtree(output)
    output.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(src, "r") as zf:
        zf.extractall(output)

    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
