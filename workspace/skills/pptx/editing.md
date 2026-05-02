# Editing Existing PPTX Files

PowerPoint files are ZIP archives that contain Open XML parts.

Use this path when the user wants small or surgical edits while preserving the original look and structure.

## Recommended Flow

1. Unpack the `.pptx` archive.
2. Inspect the relevant XML parts under `ppt/`.
3. Make the smallest possible edit.
4. Repack into a new `.pptx`.
5. Validate by opening or generating a preview.

## High-Value Locations

- `ppt/slides/slide*.xml`: slide body content
- `ppt/notesSlides/`: speaker notes
- `ppt/presentation.xml`: slide order and global deck structure
- `ppt/_rels/` and `ppt/slides/_rels/`: relationships for linked assets
- `ppt/media/`: embedded images and media

## Good Uses For XML Editing

- Fixing typo-level text changes
- Updating notes
- Swapping or replacing media assets
- Duplicating or reordering slides carefully
- Repairing relationship issues in a broken deck

## Things To Be Careful About

- Relationship ids must stay consistent.
- Slide duplication requires both XML parts and relationship entries.
- Some formatting is split across theme, master, and layout parts.
- Repacking with the wrong ZIP layout can make Office reject the file.

## Practical Advice

- Preserve filenames and directory layout exactly.
- Prefer cloning an existing slide instead of constructing XML from scratch.
- If a change grows beyond a few XML parts, consider rebuilding the deck with `pptxgenjs` instead.
