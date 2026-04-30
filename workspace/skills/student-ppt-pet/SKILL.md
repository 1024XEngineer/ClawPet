---
name: student-ppt-pet
description: Use this skill when the user asks to create, generate, restyle, or revise a student or academic presentation, including 做PPT、期末汇报、开题答辩、课程展示、研究汇报, or when the user asks to modify one specific page of an existing PPT.
---

# Student PPT Pet

This skill generates real `.pptx` files for student and academic presentation tasks.

## Scope

Use this skill for:

- creating a brand-new PPT deck
- modifying one page of an existing generated deck
- switching the overall deck style while keeping the content

Do not define chat persona, speaking style, or emotional roleplay here.
The host system may already provide a persona package. Follow the currently active persona automatically.

## Portability Rules

Keep this skill portable across different machines and workspaces.

- Never hardcode absolute paths such as `F:\...` or `/Users/...`.
- Assume the current working directory is the workspace root.
- Keep all generated files inside the workspace.
- Use relative paths only.
- Do not assume a specific username, drive letter, or project root.
- Do not assume a specific external config file outside this skill.

Use these canonical workspace-relative paths:

- plan file: `ppt-plan.json`
- state file: `state.json`
- main output: `generated/student-ppt-pet/My_Academic_Presentation.pptx`
- modified output: `generated/student-ppt-pet/My_Academic_Presentation_modified.pptx`
- templates directory: `skills/student-ppt-pet/assets/templates`

## Engine Resolution

This skill supports multiple execution environments. Resolve the engine in this order and use the first available option.

1. Windows packaged engine:
   - `skills\student-ppt-pet\runtime\ppt_engine\ppt_engine.exe`
2. POSIX packaged engine:
   - `skills/student-ppt-pet/runtime/ppt_engine/ppt_engine`
3. Python fallback:
   - `python skills/student-ppt-pet/scripts/generate.py`

Rules:

- Prefer the packaged runtime when it exists.
- Use the Python fallback only when no packaged engine is available.
- When using the Python fallback, keep the same arguments and output paths as the packaged engine.
- Do not assume every teammate has Python installed.
- If neither a packaged engine nor Python is available, tell the user the runtime is missing instead of inventing a workaround.

## Template System

The engine supports both deck-level templates and slide-level variants.

### Available templates

- `academic-multi`
  - clean academic blue style
  - best for research progress, defense, and formal coursework decks
- `campus-sunrise`
  - warmer campus/report style
  - best for class showcase, course summary, and softer student-facing decks

### Available layout variants

- `title`
  - `hero-band`
  - `center-spotlight`
- `agenda`
  - `grid-cards`
  - `stacked-list`
- `content`
  - `sidebar-focus`
  - `split-panel`
- `process`
  - `step-cards`
  - `timeline-ribbon`
- `results`
  - `metrics-chart`
  - `insight-grid`
- `summary`
  - `takeaway-panel`
  - `closing-quote`

## Style Mapping

When the user asks to change style, map the request to canonical `template_key`, `layout`, and `variant`.

Examples:

- `换成更学术一点`
  - prefer `template_key=academic-multi`
- `换成暖一点的校园风`
  - prefer `template_key=campus-sunrise`
- `把这一页换成时间轴`
  - prefer `layout=process`, `variant=timeline-ribbon`
- `把结果页换成卡片分析页`
  - prefer `layout=results`, `variant=insight-grid`
- `把普通内容页换成左右分栏`
  - prefer `layout=content`, `variant=split-panel`

If the user only wants a visual change, preserve the original title and content whenever possible and only replace style-related fields.

## Routing

Choose exactly one path:

1. New deck flow
2. Single-page modification loop
3. Deck restyle flow

## New Deck Flow

### Step 1: Gather requirements

Ask for these three inputs in one message:

- target audience
- presentation duration
- core topic or objective

Wait for the user's reply.

### Step 2: Generate outline

Generate a professional outline. A normal academic deck usually includes:

- cover
- background / problem definition
- method / implementation path
- results / evidence / findings
- conclusion / reflection / next step

Show the outline as a readable list, then ask for confirmation.
Wait for the user's reply.

### Step 3: Write JSON plan

Create `ppt-plan.json`.

The JSON must contain:

- `title`
- `author`
- `template_key`
- `slides`

Each slide should usually include:

- `slide_number`
- `type`
- `layout`
- `variant`
- `title`
- `content`

Result-heavy slides may also include:

- `metrics`
- `chart`

The JSON must be valid and parseable.

### Step 4: Execute generation

Run the resolved engine from the workspace root using relative paths only.

Command shape:

```text
ENGINE_CMD --action create --plan_file ppt-plan.json --template_key TEMPLATE_KEY --state state.json --output generated/student-ppt-pet/My_Academic_Presentation.pptx
```

Replace:

- `ENGINE_CMD` with the resolved engine command
- `TEMPLATE_KEY` with the chosen template, defaulting to `academic-multi`

After success:

- tell the user where the PPT file was generated
- mention that `state.json` was updated for future edits and restyling

## Single-Page Modification Loop

Use this only when the user wants to change one specific page of an existing deck.

### Step M1: Detect target page

- Detect the page index from the user's message.
- If missing or ambiguous, ask a short follow-up question and stop.
- If `state.json` does not exist yet, tell the user to generate the deck first.
- If the user says something vague like `把第 3 页改一下`, stay in this flow and ask what should change on that page.

### Step M2: Read current slide state

- Read `state.json`.
- Extract the old slide data from `plan.slides[page_index - 1]`.
- Use the old slide JSON plus the user's request to plan the revision.

### Step M3: Produce one replacement slide JSON

Generate only one replacement slide JSON object.
Do not regenerate the full deck JSON.

The replacement slide JSON usually contains:

- `type`
- `layout`
- `variant`
- `title`
- `content`

If the user only asks for style changes, it is valid to output only:

- `layout`
- `variant`

Add `metrics` and `chart` only when needed.

Keep the JSON compact enough to pass as one command argument.

Treat `state.json` as the source of truth for modify/restyle.
Do not assume manual edits made directly inside an exported `.pptx` file can be preserved by this engine.

Preferred compact examples:

- `{layout:process,variant:timeline-ribbon}`
- `{layout:results,variant:insight-grid}`
- `{layout:content,variant:split-panel,title:第3页修订版,content:[要点一,要点二,要点三]}`

### Step M4: Execute modify

Run the resolved engine from the workspace root.

Command shape:

```text
ENGINE_CMD --action modify --template_key TEMPLATE_KEY --page_index N --new_data "{layout:process,variant:timeline-ribbon}" --state state.json --output generated/student-ppt-pet/My_Academic_Presentation_modified.pptx
```

Replace:

- `ENGINE_CMD` with the resolved engine command
- `TEMPLATE_KEY` with one exact known template key such as `academic-multi` or `campus-sunrise`
- `N` with the actual 1-based page index
- `--new_data` with the actual compact slide JSON

After success:

- tell the user the modified PPT path
- mention that `state.json` was updated in place
- explicitly state which `template_key`, `layout`, and `variant` were applied

## Deck Restyle Flow

Use this when the user wants to keep the content but switch the overall deck style.

Examples:

- `整套换成暖一点的模板`
- `整个 PPT 换成更学术的蓝色风格`

Rules:

1. Read `state.json`.
2. Determine the current `template_key`.
3. Treat `state.json` as the source of truth. Restyle rebuilds from stored plan data and does not read an existing exported `.pptx` file back in.
4. If the target `template_key` is the same as the current one:
   - tell the user it is already using that template
   - explain that the visual style will not change
   - do not call `restyle`
   - mention the other available templates
5. If the target `template_key` is different:
   - keep the existing slide content structure
   - run:

```text
ENGINE_CMD --action restyle --template_key TEMPLATE_KEY --state state.json --output generated/student-ppt-pet/My_Academic_Presentation_modified.pptx
```

After success, tell the user:

- previous template
- target template
- output file path

If a specific page also needs a different layout, do the deck restyle first and then run the single-page modification loop for that page.

## Constraints

- Keep the workflow step-by-step.
- Do not combine outline generation, file generation, and later revision steps in one reply.
- For single-page edits, reason about only one page at a time.
- Keep the generated JSON and PPT content professional and concise.
