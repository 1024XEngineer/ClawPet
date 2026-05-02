#!/usr/bin/env python3
import argparse
import zipfile
from pathlib import Path


def iter_files(root: Path):
    for path in sorted(root.rglob("*")):
        if path.is_file():
            yield path


def main() -> int:
    parser = argparse.ArgumentParser(description="Pack an unpacked PPTX directory into a PPTX file.")
    parser.add_argument("input_dir", help="Unpacked PPTX directory")
    parser.add_argument("output", help="Output PPTX file")
    args = parser.parse_args()

    src = Path(args.input_dir).expanduser().resolve()
    if not src.is_dir():
        raise SystemExit(f"Input directory not found: {src}")

    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    content_types = src / "[Content_Types].xml"
    if not content_types.exists():
        raise SystemExit(f"Missing [Content_Types].xml in {src}")

    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in iter_files(src):
            zf.write(path, path.relative_to(src).as_posix())

    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
