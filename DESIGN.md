---
name: BrickFill
description: Evidence-first catalog enrichment on Databricks, a review app that reads as part of the Databricks workspace it runs in.
colors:
  action-blue: "#2272b4"
  action-blue-foreground: "#ffffff"
  action-blue-deep: "#0e538b"
  blue-wash: "#edf3f9"
  sidebar-selected: "#e4ecf4"
  slate-ink: "#11171c"
  slate-secondary: "#5f7281"
  white: "#ffffff"
  cool-gray-surface: "#f6f7f9"
  cool-border: "#d1d9e1"
  field-outline: "#7a8c9b"
  success: "#277c43"
  success-soft: "#e9f6ec"
  warning: "#8a5100"
  warning-soft: "#fff4d6"
  info-violet: "#5b4fb8"
  info-violet-soft: "#f1effb"
  danger: "#c82d4c"
  danger-soft: "#fcebee"
  brick: "oklch(0.553 0.174 38.4)"
typography:
  page-title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: "1.75rem"
    letterSpacing: "-0.025em"
  dialog-title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  metric:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: "2rem"
    fontFeature: "tnum"
  panel-title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  reading:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.75rem"
  table-head:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.4
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  wordmark:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.025em"
rounded:
  tag: "4px"
  control: "6px"
  panel: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  3xl: "32px"
  control: "32px"
  touch: "44px"
  sidebar: "240px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.action-blue-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.action-blue-deep}"
    textColor: "{colors.action-blue-foreground}"
  button-outline:
    backgroundColor: "{colors.white}"
    textColor: "{colors.slate-ink}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
    height: "32px"
  button-outline-hover:
    backgroundColor: "{colors.blue-wash}"
    textColor: "{colors.action-blue-deep}"
  button-icon:
    backgroundColor: "{colors.white}"
    textColor: "{colors.slate-ink}"
    rounded: "{rounded.control}"
    size: "32px"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.slate-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "4px 12px"
    height: "32px"
  sidebar-item:
    textColor: "{colors.slate-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "32px"
  sidebar-item-active:
    backgroundColor: "{colors.sidebar-selected}"
    textColor: "{colors.action-blue-deep}"
  panel:
    backgroundColor: "{colors.white}"
    textColor: "{colors.slate-ink}"
    rounded: "{rounded.panel}"
    padding: "24px"
  table-header:
    backgroundColor: "{colors.cool-gray-surface}"
    textColor: "{colors.slate-secondary}"
    typography: "{typography.table-head}"
    height: "36px"
  tag-neutral:
    backgroundColor: "{colors.white}"
    textColor: "{colors.slate-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "2px 8px"
  tag-quiet:
    backgroundColor: "{colors.cool-gray-surface}"
    textColor: "{colors.slate-ink}"
    rounded: "{rounded.tag}"
    padding: "2px 8px"
  tag-info:
    backgroundColor: "{colors.info-violet-soft}"
    textColor: "{colors.info-violet}"
    rounded: "{rounded.tag}"
    padding: "2px 8px"
  tag-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    rounded: "{rounded.tag}"
    padding: "2px 8px"
  tag-warning:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning}"
    rounded: "{rounded.tag}"
    padding: "2px 8px"
  tag-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    rounded: "{rounded.tag}"
    padding: "2px 8px"
---

# Design System: BrickFill

## Overview

**Creative North Star: "Native to the Workspace"**

BrickFill is the Databricks workspace product UI, played straight. The curator opens the app from the workspace and
finds no seam: the left sidebar, the gray table headers, the 4px status tags, the underline tabs and the one blue
button act like the rest of Databricks. Attention goes to the values and their proof. The next decision is always the
blue button.

The system is Databricks AppKit UI (shadcn components on Tailwind v4), themed through its CSS variables in
`app/brickfill/client/src/index.css`. An unlayered convention layer keyed on each component's `data-slot` applies the
workspace conventions to the AppKit components themselves:
- borders instead of card shadows;
- rectangular tags;
- 32px controls;
- gray table headers;
- underline tabs.

New screens inherit all of this by using the AppKit components and do not restyle them locally. The world is cool and
exact: white surfaces, a cool gray secondary surface, near-black slate text, 1px cool-gray borders, and workspace
density. The one warm note is the brick fill of the BrickFill mark.

It replaces an earlier warm workbench world (cream paper, terracotta action color, soft pill badges, top navigation).
None of those devices carry over.

**Key Characteristics:**
- White and cool gray surfaces, slate text, 1px cool borders; flat panels with no shadow at rest.
- Databricks action blue for the primary action, the current place, links, selection and focus, and nothing else.
- Status tags are 4px rectangles: a soft tone surface, same-hue text, an icon and a label.
- The system sans at workspace density: 14px controls and tables, 32px controls with a mouse, 44px on touch.
- A fixed 240px left sidebar on desktop; a top bar with a sheet on phones.
- Light and dark themes with their own values (dark is Databricks' navy-slate, not an inversion), and an optional
  customer accent that replaces only the blue.

## Colors

A cool, near-monochrome workspace palette with one action blue, four status tones and a single warm brand note.

### Primary
- **Action Blue** (`action-blue`): the Databricks primary. It is used for the filled primary button ("Open review
  queue", "Save settings", "Next to review"), the active tab's underline, links, focus rings, native checkboxes, the
  caret and text selection (at 22%). In dark it is `#4299e0` with near-black text.
- **Deep Action Blue** (`action-blue-deep`): the hover and press step of the primary button, and the text color on the
  blue washes. In dark it is the lighter `#8acaff`.
- **Blue Wash** (`blue-wash`): the hover surface of outline and ghost controls and of selected rows.
- **Sidebar Selected** (`sidebar-selected`): the surface of the current sidebar item, under Deep Action Blue text.
- **Customer accent:** `BRAND_ACCENT_COLOR` (applied by `lib/branding.ts`) replaces the primary, the ring, the
  sidebar primary and ring, and chart-1. It picks white or slate text by contrast and derives its own hover step
  (the accent mixed 78% with black or white). It never touches the status tones or the brick.

### Neutral
- **Slate Ink** (`slate-ink`): all text and headings; also the dark theme's page background.
- **Slate Secondary** (`slate-secondary`): descriptions, metadata, help text, table header text, inactive tabs and
  placeholders.
- **White** (`white`): the page, panels, popovers and fields.
- **Cool Gray Surface** (`cool-gray-surface`): the sidebar, the mobile top bar, table header rows, quiet tags and
  inset panels.
- **Cool Border** (`cool-border`): every decorative 1px line (panel edges, row dividers, the tab baseline, the sidebar
  edge, the dividers of the summary panel).
- **Field Outline** (`field-outline`): the border of inputs, selects and textareas. It is at least 3:1 against white
  and the gray surface (WCAG 1.4.11), unlike the decorative Cool Border.

### Status tones
Each tone is a soft surface carrying text of the same hue, always with an icon and a word.
- **Success Green** (`success`, `success-soft`): approved, official source, complete capture.
- **Warning Amber** (`warning`, `warning-soft`): review required, incomplete capture, validation warnings.
- **Info Violet** (`info-violet`, `info-violet-soft`): enriched, human edit. It is violet rather than blue so that no
  status is ever drawn in the action color.
- **Danger Red** (`danger`, `danger-soft`): rejected, missing reference, errors, and the destructive confirm button.
- **Quiet** (Cool Gray Surface, Slate Ink) is for in-progress states (in review). **Neutral** (outline only) is for
  pending.

### Tertiary
- **Brick** (`brick`, `--brand-fill`): the filled courses of the BrickFill mark, and nowhere else. In dark it is
  `oklch(0.681 0.178 40.6)`.

### Named Rules
**The One Blue Rule.** Blue means "act here", "you are here" or "go there": the primary action, the current tab and
sidebar item, links, focus and selection. Nothing that only describes a state is blue. One filled blue button per
area.

**The Never Color Alone Rule.** Every status carries an icon and a label next to its tone:
- CircleDashed for pending;
- Sparkles for enriched;
- TriangleAlert for review required;
- Eye for in review;
- CircleCheck for approved;
- CircleX for rejected.

A grayscale screenshot must still be readable.

**The One Warm Note Rule.** The mark's brick is the only warm brand color on the page. The sanctioned exceptions are
amber as the warning tone and in charts, and Firecrawl's own orange inside the "How it works" dialog as partner
credit.

**The Twin Dark Rule.** The dark palette is written twice in `index.css`, once for a `.dark` class and once for
`prefers-color-scheme: dark`. `theme.test.ts` fails if the two differ, so change both together.

## Typography

**Display Font:** the system sans (`ui-sans-serif, system-ui, sans-serif`), Tailwind's default stack.
**Body Font:** the same system sans.

**Character:** the workspace's own voice: one native sans at product density, with weight and the gray secondary
color doing the hierarchy. AppKit's base gives real heading elements -0.025em tracking (the kit default), which the
build keeps.

### Hierarchy
- **Page title** (600, 1.375rem / 1.75rem): one h1 per page, at the start of the title row, followed by a one-line
  description in body Slate Secondary. On the product page the h1 is the product's generated title.
- **Dialog title** (600, 1.25rem): titles of dialogs and of the evidence audit sheet. Section headings inside the "How
  it works" dialog use 1.125rem.
- **Metric** (600, 1.5rem, tabular numerals): the figures of the summary panel and the product's quality and
  coverage.
- **Panel title** (600, 1rem, line-height 1): panel headings ("Short description", "Key Features"), exposed to
  assistive technology as level-2 headings. Small in-panel headings ("Next step", rule groups) use 14px semibold.
- **Body** (400, 0.875rem): controls, tables, sidebar items, descriptions. Fields are 14px with a mouse and keep 16px
  on touch so iOS does not zoom into them.
- **Reading** (400, 1rem / 1.75rem): generated content paragraphs only.
- **Table head** (600, 0.8125rem, Slate Secondary): column headers on the gray header row.
- **Label** (400, 0.75rem, Slate Secondary): metadata, field help, the labels of label/value pairs, stacked-table
  cell labels and sidebar credits.
- **Wordmark** (800, 1.125rem, -0.025em): "BrickFill" next to the mark, in the text color.

### Named Rules
**The Inherited Line Rule.** Paragraphs inherit the line height of their context. AppKit's 1.75rem prose line height
is reset in `@layer base` so table rows and lists stay single-height; reading text sets its own (1.75rem).

**The Tabular Figures Rule.** Percentages, counts, page numbers and step numbers use tabular numerals.

## Layout

- **Shell:** a two-column grid from 768px up:
  - a fixed 240px left sidebar on the Cool Gray Surface, with a right border and contents that stick to the
    viewport. It holds the mark and wordmark, optional co-branding, then Overview / Catalog / Settings, and at the
    bottom "How it works", the language select and the credits.
  - the content column holds the page, centered in a 1280px maximum (`max-w-7xl`). It pads 16px × 24px, or
    32px × 28px from 768px up.
- **Phones (below 768px):** a sticky 56px top bar on the gray surface (menu button, mark, language) and a 288px
  left sheet with the same sidebar contents.
- **Title row:** every page opens with the title and description on the left, and the page's actions right-aligned
  on the same row (they wrap below on phones). Sections of a page stack 24px apart.
- **Rhythm:**
  - panels pad 24px (summary figures 16px, or 20px from 640px up);
  - a panel's heading sits 12px from its content;
  - a field's label, control and help are 6px apart;
  - toolbar controls sit 8px apart.
- **Density:** 32px controls and 14px text with a mouse. With a coarse pointer, every button, trigger, tab, field,
  select item and sidebar item grows to 44px. Small custom controls keep their size and grow an invisible 12px hit
  area.
- **Breakpoints (Tailwind defaults):**
  - **768px:** sidebar versus top bar and sheet. The catalog filters collapse behind a "Filters" toggle below it.
  - **1024px:** the catalog table becomes a divided list, and action tables become labeled stacked blocks
    (`.stack-table`), so actions never hide behind a horizontal scroll.
  - **1280px:** the overview's summary panel shows four figures in one row (two by two below).

## Elevation & Depth

Flat and bordered. Panels, tables and tags sit in the page and are separated by a 1px Cool Border or a step to the
gray surface. Shadows exist only on layers that float above the page. The convention layer strips AppKit's rest
shadows from cards, buttons, inputs, textareas and select triggers.

### Shadow Vocabulary
- **Floating** (`box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)`): popovers, select
  menus, dropdowns.
- **Overlay** (`box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`): dialogs and sheets,
  over a dimmed backdrop.

### Named Rules
**The Border, Not Shadow Rule.** Anything that sits in the page is separated by a border or a tone step, never a
shadow. A shadow means "this floats".

## Shapes

- **Corners:** small and scaled to the object, as in the workspace:
  - status and identifier tags are 4px rectangles (`tag`);
  - buttons, fields, select triggers and sidebar items are 6px (`control`, the base `--radius`);
  - panels, the summary panel, dialogs, inset tiles and evidence images are 8px (`panel`).
- The contract's 4px controls landed at 6px, AppKit's `rounded-md` over the 6px base radius; the build wins.
- Full circles appear only for small round objects: numbered pipeline steps in the "How it works" dialog and the
  icon-only info trigger.
- **Borders:** always 1px, except the active tab's 2px blue underline. Nothing has a colored side stripe.
- **The mark:** three rounded brick courses (3px corners in a 64px grid), with the empty courses at 18% of the text
  color and the filled ones in Brick.

## Components

### Buttons
Workspace buttons: one blue fill per area, and outlines everywhere else.
- **Shape:** 6px corners, 32px tall (icon buttons 32px square), 14px medium text, a 16px icon with an 8px gap.
- **Primary:** an Action Blue fill with white text. On hover it steps to Deep Action Blue rather than fading, and in
  dark it lightens instead. A primary link (the overview's "Open review queue") uses the same treatment.
- **Outline:** white with a Cool Border and Slate Ink text. On hover it takes the Blue Wash with Deep Action Blue text.
- **Ghost:** no chrome until the Blue Wash hover. It is used for "Back to the catalog" and in-row actions.
- **Destructive:** a Danger Red fill, used only to confirm a deletion inside an alert dialog.
- **Focus:** the border takes the ring color plus a 3px Action Blue ring at 50%. Custom items use a 2px ring.
  Disabled controls drop to 50% opacity.
- **Refresh:** every page has one refresh control on its title row: an outline icon button with a RefreshCw icon that
  spins while it reloads and is disabled while busy. A short status line ("Updated …") may sit beside it in 12px Slate
  Secondary.

### Chips (status tags)
- **Style:** a 4px rectangle with 2px × 8px padding, 12px medium text and a 12px icon. Tone tags have no border and
  use the soft surface with same-hue text. Identifier tags (GTIN, ID, category, content language) are outline
  rectangles in Slate Ink.
- **Mapping:**
  - PENDING is neutral;
  - ENRICHED is info violet;
  - REVIEW_REQUIRED is warning;
  - IN_REVIEW is quiet;
  - APPROVED is success;
  - REJECTED is danger.
- **Placement:** the enrichment status is always shown. A second review-decision tag appears only for IN_REVIEW,
  APPROVED or REJECTED.

### Cards / Containers (panels)
- **Corner Style:** 8px.
- **Background:** white on the white page.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px Cool Border.
- **Internal Padding:** 24px, with the heading 12px from the content. A panel holding a table or list drops its
  padding so rows run edge to edge. Inset groups inside a panel are 8px tiles with a border or the gray surface at
  50%, never another card.
- **Summary panel:** the overview's four figures live in one bordered panel, split by 1px dividers (a 1px gap over the
  border color) rather than in four cards. Each figure has a 14px medium Slate Secondary label with a 16px icon (the
  icon takes the tone of the status it counts), the 24px metric, and a 12px line saying what it means.

### Tables
- **Header row:** the gray surface, 36px tall, 13px semibold Slate Secondary.
- **Rows:** divided by Cool Border.
- **Product name:** the product name is the row link. The whole row is its hit area, and the name turns blue and
  underlined on hover. There is no arrow column.
- **Numbers:** numeric columns (quality, coverage) are right-aligned with tabular numerals. A product that was never
  enriched shows "—", not "0%".
- **Small screens:** below 1024px the catalog becomes a divided list. Action tables become stacked blocks with each
  cell labeled by its header.

### Inputs / Fields
- **Style:** white (in dark, a faint wash of the field color), a 1px Field Outline, 6px corners, 32px tall, 14px text,
  Slate Secondary placeholder. A search field has a leading 16px icon inset 12px.
- **Focus:** the border turns Action Blue with a 3px blue ring at 50%.
- **Error / Disabled:** an invalid field takes a danger border and ring, with the message next to it. Disabled fields
  sit at 50% opacity.
- **Toolbar:** catalog filters are a single wrapping row: the search field first, then the select triggers, then the
  actions.

### Navigation
- **Sidebar items:** 32px rows with a 16px icon and 14px label, 6px corners and 10px side padding. Inactive items are
  Slate Ink, with Sidebar Selected at 60% on hover. The current page is Sidebar Selected with Deep Action Blue
  semibold text.
- **Tabs:** an underline row on a 1px baseline, 20px between triggers. Inactive tabs are Slate Secondary and turn
  Slate Ink on hover. The active tab is Slate Ink semibold with a 2px Action Blue underline. Tabs stay on one line
  and scroll sideways. On phones the right edge fades out (over 40px) so the hidden tabs read as "scroll for more".
- **Skip link:** "Skip to content" slides in on the first Tab, as a 6px primary-blue button.

### Evidence audit sheet (signature)
A side sheet that puts the AI value, the curated value and each source side by side. Each source shows its host, a
source-tier tag, a capture tag, the screenshot crop in an 8px bordered frame, and the excerpt. Anything new that
shows a value should be able to show its proof the same way.

### "How it works" dialog
A wide dialog with four numbered pipeline stages. The steps are selectable 8px outline tiles; the selected one takes
the ring. Firecrawl steps and the Firecrawl band carry the partner's own orange as credit, the one sanctioned
non-system hue.

## Do's and Don'ts

### Do:
- **Do** use the AppKit components and let the `data-slot` convention layer in `index.css` set their workspace look.
  Change the layer, not individual screens.
- **Do** keep Action Blue for the primary action, the current place, links, focus and selection, with one filled blue
  button per area.
- **Do** draw statuses as 4px tone tags with an icon and a label.
- **Do** put the page title, a one-line description and the page's actions (including the one RefreshButton) on the
  title row.
- **Do** right-align numeric columns, use tabular numerals, and show "—" for a value that was never measured.
- **Do** separate panels with a 1px Cool Border, give fields the 3:1 Field Outline, and keep shadows for floating
  layers.
- **Do** keep 32px controls for a mouse and 44px targets for touch, and turn action tables into labeled stacked
  blocks below 1024px.
- **Do** change `.dark` and the `prefers-color-scheme: dark` block together.

### Don't:
- **Don't** draw a status in Action Blue, or add a status hue outside the four tones.
- **Don't** use pills for status or identifier tags; tags are 4px rectangles.
- **Don't** add shadows to panels, buttons or fields, nest cards, or add colored side or top stripes.
- **Don't** use segmented-track tabs or wrap the tab row.
- **Don't** introduce warm surfaces or a warm accent; the brick of the mark stays the only warm brand note.
- **Don't** add an arrow or "open" column to a table whose row is already a link.
- **Don't** add glows, gradients or gradient text to sell the AI. Show the evidence instead.
