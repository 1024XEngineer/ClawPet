#!/usr/bin/env python3
import argparse
import shutil
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Remove an unpacked PPTX working directory.")
    parser.add_argument("path", help="Directory to remove")
    args = parser.parse_args()

    target = Path(args.path).expanduser().resolve()
    if not target.exists():
        print(f"Nothing to clean: {target}")
        return 0
    if not target.is_dir():
        raise SystemExit(f"Not a directory: {target}")

    shutil.rmtree(target)
    print(f"Removed {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
