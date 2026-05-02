#!/usr/bin/env python3
import argparse
import shutil
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

from office.pack import main as pack_main  # type: ignore
from office.unpack import main as unpack_main  # type: ignore


NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}


def next_numeric_suffix(paths: list[Path], prefix: str, suffix: str) -> int:
    nums: list[int] = []
    for path in paths:
        name = path.name
        if name.startswith(prefix) and name.endswith(suffix):
            middle = name[len(prefix) : -len(suffix)]
            if middle.isdigit():
                nums.append(int(middle))
    return (max(nums) + 1) if nums else 1


def clone_slide(workdir: Path, source_index: int) -> None:
    slides_dir = workdir / "ppt" / "slides"
    rels_dir = slides_dir / "_rels"
    presentation_xml = workdir / "ppt" / "presentation.xml"
    presentation_rels = workdir / "ppt" / "_rels" / "presentation.xml.rels"

    slides = sorted(slides_dir.glob("slide*.xml"))
    if source_index < 1 or source_index > len(slides):
        raise SystemExit(f"source slide index out of range: {source_index}")

    source_slide = slides[source_index - 1]
    source_rel = rels_dir / f"{source_slide.name}.rels"

    next_index = next_numeric_suffix(slides, "slide", ".xml")
    new_slide = slides_dir / f"slide{next_index}.xml"
    new_rel = rels_dir / f"{new_slide.name}.rels"

    shutil.copy2(source_slide, new_slide)
    if source_rel.exists():
        shutil.copy2(source_rel, new_rel)

    pres_tree = ET.parse(presentation_xml)
    pres_root = pres_tree.getroot()
    sld_id_lst = pres_root.find("p:sldIdLst", NS)
    if sld_id_lst is None:
        raise SystemExit("presentation.xml missing p:sldIdLst")

    existing_ids = [int(node.attrib["id"]) for node in sld_id_lst.findall("p:sldId", NS)]
    new_id = max(existing_ids) + 1 if existing_ids else 256

    rel_tree = ET.parse(presentation_rels)
    rel_root = rel_tree.getroot()
    existing_rids = []
    for rel in rel_root.findall("rel:Relationship", NS):
        rid = rel.attrib.get("Id", "")
        if rid.startswith("rId") and rid[3:].isdigit():
            existing_rids.append(int(rid[3:]))
    new_rid = f"rId{(max(existing_rids) + 1) if existing_rids else 1}"

    ET.SubElement(
        rel_root,
        "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship",
        {
            "Id": new_rid,
            "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
            "Target": f"slides/{new_slide.name}",
        },
    )

    ET.SubElement(
        sld_id_lst,
        "{http://schemas.openxmlformats.org/presentationml/2006/main}sldId",
        {
            "id": str(new_id),
            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id": new_rid,
        },
    )

    pres_tree.write(presentation_xml, encoding="utf-8", xml_declaration=True)
    rel_tree.write(presentation_rels, encoding="utf-8", xml_declaration=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Clone an existing slide in a PPTX file.")
    parser.add_argument("pptx", help="Source PPTX file")
    parser.add_argument("--source-index", type=int, default=1, help="1-based slide index to clone")
    parser.add_argument("--output", required=True, help="Output PPTX file")
    args = parser.parse_args()

    src = Path(args.pptx).expanduser().resolve()
    if not src.is_file():
        raise SystemExit(f"Source PPTX not found: {src}")

    output = Path(args.output).expanduser().resolve()
    with tempfile.TemporaryDirectory(prefix="pptx-clone-") as temp_dir:
        workdir = Path(temp_dir) / "deck"
        unpack_cmd = ["", str(src), "--output", str(workdir)]
        pack_cmd = ["", str(workdir), str(output)]

        import sys

        old_argv = sys.argv[:]
        try:
            sys.argv = unpack_cmd
            unpack_main()
            clone_slide(workdir, args.source_index)
            sys.argv = pack_cmd
            pack_main()
        finally:
            sys.argv = old_argv

    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
