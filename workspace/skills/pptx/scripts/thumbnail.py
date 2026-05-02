#!/usr/bin/env python3
import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path


def run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, check=True, text=True, capture_output=True)


def make_with_qlmanage(src: Path, output: Path) -> bool:
    if not shutil.which("qlmanage"):
        return False
    with tempfile.TemporaryDirectory(prefix="pptx-thumb-") as temp_dir:
        run(["qlmanage", "-t", "-s", "2000", "-o", temp_dir, str(src)])
        generated = Path(temp_dir) / f"{src.name}.png"
        if not generated.exists():
            return False
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(generated, output)
        return True


def make_with_libreoffice(src: Path, output: Path) -> bool:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return False

    converter = shutil.which("pdftoppm") or shutil.which("magick")
    if not converter:
        return False

    with tempfile.TemporaryDirectory(prefix="pptx-pdf-") as temp_dir:
        temp_path = Path(temp_dir)
        run([soffice, "--headless", "--convert-to", "pdf", "--outdir", str(temp_path), str(src)])
        pdf = temp_path / f"{src.stem}.pdf"
        if not pdf.exists():
            return False

        output.parent.mkdir(parents=True, exist_ok=True)
        if Path(converter).name == "pdftoppm":
            prefix = temp_path / "slide"
            run(["pdftoppm", "-png", "-f", "1", "-singlefile", str(pdf), str(prefix)])
            generated = temp_path / "slide.png"
            if not generated.exists():
                return False
            shutil.copy2(generated, output)
            return True

        run(["magick", f"{pdf}[0]", str(output)])
        return output.exists()


def default_output(src: Path) -> Path:
    return src.with_suffix(".png")


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate a preview PNG for a PPTX file.")
    parser.add_argument("pptx", help="Source PPTX file")
    parser.add_argument("--output", help="Output PNG path")
    args = parser.parse_args()

    src = Path(args.pptx).expanduser().resolve()
    if not src.is_file():
        raise SystemExit(f"Source PPTX not found: {src}")

    output = Path(args.output).expanduser().resolve() if args.output else default_output(src)

    if make_with_qlmanage(src, output) or make_with_libreoffice(src, output):
        print(output)
        return 0

    raise SystemExit(
        "Could not generate thumbnail. Install `qlmanage` (macOS Quick Look), "
        "`soffice` plus `pdftoppm`, or `ImageMagick`."
    )


if __name__ == "__main__":
    raise SystemExit(main())
