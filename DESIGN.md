---
name: BrickFill
description: Evidence-first catalog enrichment on Databricks, a calm review workbench for catalog curators.
colors:
  kiln: "oklch(0.553 0.174 38.4)"
  kiln-foreground: "oklch(1 0 0)"
  ink: "oklch(0.279 0.036 250.8)"
  mortar: "oklch(0.949 0.014 74.4)"
  paper: "oklch(0.98 0.006 75.4)"
  card: "oklch(1 0 0)"
  slate-muted: "oklch(0.506 0.027 256.2)"
  muted-surface: "oklch(0.955 0.011 74.4)"
  kiln-wash: "oklch(0.939 0.024 55.3)"
  kiln-wash-foreground: "oklch(0.408 0.116 38.2)"
  hairline: "oklch(0.907 0.016 73.7)"
  field-outline: "oklch(0.64 0.02 73.7)"
  focus-ring: "oklch(0.635 0.164 42.8)"
  success: "oklch(0.44 0.08 170)"
  success-soft: "oklch(0.95 0.035 170)"
  warning: "oklch(0.45 0.095 80)"
  warning-soft: "oklch(0.94 0.075 92)"
  info: "oklch(0.43 0.07 250)"
  info-soft: "oklch(0.945 0.022 250)"
  danger: "oklch(0.505 0.19 27.5)"
  danger-soft: "oklch(0.95 0.03 25)"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
  metric:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
    fontFeature: "tnum"
  wordmark:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.025em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  touch: "44px"
components:
  button-primary:
    backgroundColor: "{colors.kiln}"
    textColor: "{colors.kiln-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-outline-hover:
    backgroundColor: "{colors.kiln-wash}"
    textColor: "{colors.kiln-wash-foreground}"
  button-ghost-hover:
    backgroundColor: "{colors.kiln-wash}"
    textColor: "{colors.kiln-wash-foreground}"
  nav-link:
    textColor: "{colors.slate-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  nav-link-active:
    backgroundColor: "{colors.kiln}"
    textColor: "{colors.kiln-foreground}"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "24px"
  badge-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  badge-warning:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  badge-info:
    backgroundColor: "{colors.info-soft}"
    textColor: "{colors.info}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  badge-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  badge-quiet:
    backgroundColor: "{colors.mortar}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
---

# Design System: BrickFill

## Overview

**Creative North Star: "The Curator's Workbench"**

BrickFill is a workbench, not a showroom. The curator works the day's queue at a desk, and every screen is laid out
so a value sits next to its proof: the source page, the screenshot, the crop, the rule it passed or failed. The
surface stays calm and warm, with paper-toned backgrounds, Ink text and thin outlines, so the evidence and the few
decisions that matter stand out. Its character is **sober and precise**: tool density, thin borders, softly rounded
corners, and color only where it says something.

The system is built on Databricks AppKit UI (shadcn components on Tailwind v4) and themed through its CSS variables
in `app/brickfill/client/src/index.css`. The brand lives in precise details:

- the terracotta Kiln on the one action that moves the work forward;
- the brick-course mark that fills from the bottom up;
- warm Mortar neutrals instead of cold grays.

It has two confirmed anti-references:

- the "AI magic" panel, whose glows, gradients and sparkles sell the model instead of showing the evidence;
- the dense gray ERP, where every row and label has the same weight and nothing breathes.

**Key Characteristics:**
- Paper and Ink with warm Mortar neutrals; Kiln (terracotta) is used only for actions and the current selection.
- Four status tones (success, warning, info, danger), each a soft surface with same-hue text, always shown with an
  icon and a label.
- Flat surfaces separated by hairlines; shadows are minimal and grow only on what floats.
- The system sans in a clear, short scale; tabular numerals in every figure.
- Light and dark themes with their own values (the dark theme is not the light one inverted), and an optional
  customer accent that replaces only Kiln.

## Colors

A warm neutral workspace (Paper, Mortar, Ink) with one terracotta action color and four restrained status tones.

### Primary
- **Kiln** (`kiln`): a burnt terracotta, taken from the fired brick of the mark. It is used for the primary button
  ("Próximo para revisar", "Salvar configurações", "Abrir fila de revisão"), the active navigation item, focus rings
  (`focus-ring`, a lighter Kiln) and selection. Text on Kiln is white in the light theme and Ink in the dark one. A
  customer accent (`BRAND_ACCENT_COLOR`) replaces Kiln at runtime and picks white or Ink for contrast. The brick fill
  of the mark (`--brand-fill`) always stays Kiln.
- **Kiln Wash** (`kiln-wash`, with `kiln-wash-foreground`): a pale terracotta tint, the hover surface of outline and
  ghost buttons and of selected rows.

### Neutral
- **Ink** (`ink`): a deep slate navy for all body text and headings, about 14.6:1 on white. It is also the theme
  color of the browser chrome.
- **Paper** (`paper`): the warm off-white of the page and of dialogs.
- **Card White** (`card`): pure white for cards, popovers and fields, a step brighter than Paper so a card lifts
  without a shadow.
- **Mortar** (`mortar`): the warm secondary surface used for quiet badges ("Em revisão"), stage chips and secondary
  buttons.
- **Muted Surface** (`muted-surface`): the tabs track and subtle inset panels.
- **Slate Muted** (`slate-muted`): secondary text, help text, metadata and inactive navigation, about 5.8:1 on white.
- **Hairline** (`hairline`): the decorative border of cards, table rows and dividers. It is deliberately faint
  (1.3:1) because it only separates things.
- **Field Outline** (`field-outline`): the border of inputs, selects and textareas, at least 3:1 against the card and
  the page (WCAG 1.4.11). Fields are controls, so their edge has to be visible.

### Status tones
Each tone is a soft surface (`*-soft`) carrying text of the same hue. Text on its soft surface measures 5.5–6.9:1
in light and 6.9–7.7:1 in dark.
- **Teal Success** (`success`, `success-soft`): approved, official source, complete capture. It sits at hue 170,
  away from warning and danger, so it stays distinct under deuteranopia.
- **Mustard Warning** (`warning`, `warning-soft`): review required, unpublished candidate, incomplete capture,
  validation warnings. It sits well away from Kiln so a warning never reads as an action.
- **Slate Info** (`info`, `info-soft`): enriched, human edit. It is Ink's hue in a lighter step.
- **Brick Red Danger** (`danger`, `danger-soft`): rejected, missing reference, errors. In the dark theme it becomes
  AppKit's lighter red, `oklch(0.704 0.191 22.216)`.
- **Quiet** (Mortar surface, Ink text) is for in-progress states such as "Em revisão". **Neutral** (outline only) is
  for pending.

### Named Rules
**The Kiln Is for Doing Rule.** Kiln marks the action that moves the work forward and the user's current place.
Nothing that only describes state is drawn in Kiln, so a reviewer always knows where to click.

**The Never Color Alone Rule.** Every status carries an icon and a word next to its tone: CircleCheck for approved,
TriangleAlert for review, CircleX for rejected, and so on. A grayscale screenshot must still be readable.

**The Twin Dark Rule.** The dark palette is written twice in `index.css`, once for a `.dark` class and once for the
system setting. `theme.test.ts` fails if the two differ, so change both together.

## Typography

**Display Font:** the system sans (`ui-sans-serif, system-ui, sans-serif`); there is no webfont.
**Body Font:** the same system sans.

**Character:** a single native sans with weight doing the work. It loads instantly, matches the operating system
the curator already reads all day, and keeps the brand in the wordmark's extra-bold weight rather than in a costume
face.

### Hierarchy
- **Display** (600, 1.875rem, line-height 1.2, -0.025em): one page title (h1) per screen, such as "Produtos e
  qualidade do enriquecimento" or the product's generated title. There is no label above it.
- **Headline** (600, 1.125rem): section headings inside dialogs and long panels ("Fluxo principal", "Garantias").
- **Title** (600, 1rem, line-height 1): card titles ("Filtros", "Descrição abreviada"), exposed to assistive
  technology as level-2 headings.
- **Body** (400, 0.875rem, line-height 1.5): controls, tables and most reading text. Generated content paragraphs use
  1rem with a 1.75rem line height.
- **Label** (400, 0.75rem): field help, metadata ("GTIN 789… · Marca"), table and card labels, in Slate Muted.
  Uppercase with tracking is allowed only for a label/value pair inside a panel ("ONDE RODA"), never above a heading.
- **Metric** (600, 1.875rem, tabular numerals): the overview counts. The product's quality and coverage figures use
  the same face at 1.5rem.
- **Wordmark** (800, 1.125rem, -0.025em): "BrickFill" next to the mark, in the text color.

### Named Rules
**The No Eyebrow Rule.** A heading speaks for itself; no small colored kicker sits above it. The page eyebrows were
removed in the polish pass and must not come back.

**The Tabular Figures Rule.** Percentages, counts, page numbers and step numbers use tabular numerals so columns and
neighboring metrics line up.

## Layout

- **Page frame:**
  - content is centered in a 1280px column (`max-w-7xl`) inside a 1600px header and footer frame;
  - side padding is 16px, or 24px from 768px up;
  - vertical padding is 24px, or 32px from 768px up.
- **Rhythm:**
  - sections of a page stack 24px apart;
  - cards pad 24px, and compact metric cards pad 16px;
  - a field's label, control and help are grouped 6px apart, and field groups sit 16–24px apart;
  - there is more space above a heading than below it.
- **Density:** desktop keeps tool density, with 36px controls and 14px text. On touch screens
  (`@media (pointer: coarse)`), every button, trigger, tab, field and select item grows to 44px. Small icon controls
  keep their size and gain an invisible 12px hit area instead.
- **Breakpoints (Tailwind defaults):**
  - **below 768px:** navigation moves into a sheet and the language switcher is icon-only;
  - **below 1024px:** product lists and attribute tables become stacked cards, and action tables become labeled
    blocks (`.stack-table`), so actions never hide behind a horizontal scroll;
  - **1280px and up:** the catalog filters fit in a single row.
- **Header:** sticky, 64px tall, with Paper at 95% opacity, a backdrop blur and a hairline bottom border.

## Elevation & Depth

The system is flat and outlined. Surfaces are separated by tone (white cards on Paper) and by a hairline. Shadows
stay at AppKit's minimum and grow only for things that float above the page.

### Shadow Vocabulary
- **Rest** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)`): outline buttons and fields; it is barely there.
- **Card** (`box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)`): cards at rest.
- **Floating** (`box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)`): popovers, select
  menus and dropdowns.
- **Overlay** (`box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`): dialogs and the
  audit sheet, over a dimmed backdrop.

### Named Rules
**The Hairline First Rule.** Separate with a 1px Hairline or a tone step before reaching for a shadow. A shadow means
"this floats", and nothing that sits in the page floats.

## Shapes

- **Corners:** softly rounded, scaled to the size of the object:
  - fields, buttons and nav items are 8px (`md`);
  - tab tracks and evidence tiles are 10px (`lg`, the base `--radius`);
  - cards, dialogs and large panels are 14px (`xl`);
  - badges are fully rounded pills.
- **Borders:** always 1px. Neutral timeline rails in history lists are 2px in Hairline. Nothing has a colored side
  stripe.
- **The mark:** three rounded brick courses (3px corners in a 64px grid), with the empty courses at 18% of the text
  color and the filled ones in `--brand-fill`. It is the one recurring geometric motif.

## Components

### Buttons
Quiet until they matter: one filled Kiln button per area, and outlines everywhere else.
- **Shape:** gently rounded (8px), 36px tall (32px small, 40px large), 14px medium text, a 16px icon with an 8px gap.
- **Primary:** a Kiln fill with white text, used for the next step, saving and opening the queue. It reaches 90%
  opacity on hover.
- **Outline:** a Paper fill with a Hairline border and the Rest shadow, used for secondary actions ("Atualizar
  dados", "Limpar", icon-only refresh). On hover it takes the Kiln Wash surface and text.
- **Ghost:** no chrome until hover (Kiln Wash), used for "Voltar ao catálogo" and in-row actions.
- **Destructive:** a danger fill, used only to confirm a deletion inside an alert dialog.
- **Focus:** a 3px ring in Kiln at 50% opacity, with the border taking the ring color. Disabled buttons drop to 50%
  opacity and do not react.

### Chips (status badges)
- **Style:** a pill with 2px × 8px padding and 12px medium text with a 12px icon. Tone badges have no border and use
  the soft surface with same-hue text. Plain badges (GTIN, SKU, category) are outline pills in Ink.
- **Mapping:**
  - PENDING is neutral (CircleDashed);
  - ENRICHED is info (Sparkles);
  - REVIEW_REQUIRED is warning (TriangleAlert);
  - IN_REVIEW is quiet (Eye);
  - APPROVED is success (CircleCheck);
  - REJECTED is danger (CircleX).
  The enrichment status and the review decision appear as two badges side by side.

### Cards / Containers
- **Corner Style:** 14px.
- **Background:** Card White on Paper.
- **Shadow Strategy:** the Card shadow (see Elevation & Depth).
- **Border:** a 1px Hairline.
- **Internal Padding:** 24px with 24px between header and content. Metric cards use 16px with 8px between label and
  figure. A card holding a table or list drops its padding so rows run edge to edge.
- Cards never nest inside cards. A grouping inside a card is a column with a heading, or a tone-step panel.

### Inputs / Fields
- **Style:** Card White (in dark, a 36% white outline over a faint white wash), a 1px Field Outline border, 8px
  corners, 36px tall, 14px text and Slate Muted placeholders. A search field has a leading 16px icon inset 12px.
- **Focus:** the border turns Kiln and gains a 3px Kiln ring at 50%.
- **Error / Disabled:** an invalid field takes a danger border and ring, with the message right next to the field or
  the action that failed. Disabled fields sit at 50% opacity.
- **Selection:** selected text is Ink on Kiln at 24%, never white on a pale tint.

### Navigation
- **Style:** a horizontal row of icon-and-label links in the sticky header, 14px medium, 8px corners, 8px × 12px
  padding.
- **States:** inactive links are Slate Muted and turn Ink on a Muted Surface on hover. The active link is filled
  Kiln with white text, the one place Kiln marks location rather than an action.
- **Mobile:** below 768px the links move into a side sheet opened by a menu button. A skip link ("Pular para o
  conteúdo") slides in on focus.

### Evidence audit sheet (signature)
A side sheet that puts the AI value, the curated value and each source side by side. Each source shows:
- its host;
- a source-tier badge (official is success);
- a capture badge (complete is success, incomplete is warning);
- the screenshot crop;
- the excerpt.
This sheet is the workbench in miniature. Anything new that shows a value should be able to show its proof the same
way.

### Architecture dialog ("Como funciona")
A wide dialog with four numbered pipeline stages. Each stage is a column, not a card, with a neutral Mortar step
chip, and arrows sit between the stages. The steps inside a stage are selectable outline cards, and the selected one
takes a Kiln border with a Kiln wash. Firecrawl steps carry the partner's own orange as a credit, the one sanctioned
non-system hue.

## Do's and Don'ts

### Do:
- **Do** keep Kiln for the primary action, the active navigation item, focus and selection; one filled Kiln button
  per area.
- **Do** pair every status tone with its icon and label, and use the soft surface with same-hue text from the
  status tones.
- **Do** give fields the Field Outline (≥3:1) and keep Hairline for decoration only.
- **Do** use tabular numerals for every figure, and the system sans at the scale above.
- **Do** make touch targets 44px on coarse pointers, and turn tables into labeled stacked blocks below 1024px.
- **Do** change `.dark` and the `prefers-color-scheme: dark` block together; `theme.test.ts` checks that they match.

### Don't:
- **Don't** add glows, gradients, sparkle effects or gradient text to sell the AI. Show the evidence instead. The
  "AI magic" panel is a confirmed anti-reference.
- **Don't** flatten every row, label and figure to the same gray weight; the dense gray ERP is a confirmed
  anti-reference.
- **Don't** put an eyebrow or kicker above a heading.
- **Don't** draw a status in Kiln, or use a new hue for a status outside the four tones.
- **Don't** nest cards, add colored side or top stripes, or use a shadow on anything that does not float.
- **Don't** add a webfont or a display face; the brand lives in the wordmark's weight and the mark.
