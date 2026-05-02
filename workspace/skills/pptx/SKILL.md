---
name: pptx
description: Use this skill when the user asks to create, edit, review, or repair PowerPoint `.pptx` presentations. It supports both generating decks from scratch and making surgical changes to existing files.
---

# PPTX

Use this skill when the task is specifically about PowerPoint `.pptx` files.

This workspace install is adapted from Anthropic's `pptx` skill so it works locally inside GoClaw without requiring a global install.

## When To Use It

- Creating a new presentation from scratch
- Editing slide text, notes, order, or structure
- Reviewing an existing deck and proposing changes
- Repairing or inspecting a broken `.pptx`
- Generating helper artifacts such as thumbnails or unpacked XML

## Core Principles

- Prefer `pptxgenjs` when building a deck from scratch or doing broad layout changes.
- Prefer unpacking the `.pptx` archive when you need precise edits to an existing presentation.
- Always keep generated files inside the workspace.
- After structural edits, create a preview image when possible so the result can be checked quickly.

## Workflow

### 1. Understand The Goal

Clarify whether the user wants one of these:

- Create a new deck
- Modify an existing deck
- Review and comment on a deck
- Repair a broken deck

### 2. Choose An Editing Path

#### Path A: Build Or Rebuild With `pptxgenjs`

Use this when:

- The user wants a new presentation
- The deck needs large-scale layout changes
- You do not need pixel-perfect preservation of the original file

Reference: `pptxgenjs.md`

#### Path B: Edit The Existing PPTX Package

Use this when:

- The user wants targeted edits to an existing `.pptx`
- The current layout should remain mostly intact
- You need to preserve theme, animations, notes, or embedded assets as much as possible

Reference: `editing.md`

### 3. Validate

After edits:

1. Confirm the `.pptx` opens.
2. Generate a thumbnail preview if the environment supports it:

```bash
python workspace/skills/pptx/scripts/thumbnail.py path/to/deck.pptx
```

3. If you unpacked the file for editing, remove temp folders when done:

```bash
python workspace/skills/pptx/scripts/clean.py path/to/unpacked-dir
```

## Helper Commands

Unpack a presentation:

```bash
python workspace/skills/pptx/scripts/office/unpack.py path/to/deck.pptx
```

Pack an unpacked folder back into a `.pptx`:

```bash
python workspace/skills/pptx/scripts/office/pack.py path/to/unpacked-dir path/to/output.pptx
```

Clone an existing slide as a starting point for a new slide:

```bash
python workspace/skills/pptx/scripts/add_slide.py path/to/deck.pptx --source-index 1 --output path/to/output.pptx
```

## Constraints

- Do not overwrite the user's source file unless they explicitly ask for in-place edits.
- Keep intermediate files in the workspace.
- Prefer reversible changes and save edited output as a new file when possible.
- If preview generation is unavailable on the current machine, explain that clearly instead of pretending validation succeeded.
