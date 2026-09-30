# Where this art came from

Every image in this folder was generated on the owner's own Higgsfield account, at the owner's
direction, for this project. DECISIONS.md 0020 is the ruling that makes that the owner's art for
the purposes of CLAUDE.md §1. Nothing here was bought, licensed, downloaded or copied from
anywhere else, and no prompt names another work, artist, studio, game or franchise.

The only references given to the generator were images already in this repository: the owner's
earlier generations, the code-drawn sigil, and a layout diagram drawn from `plan.ts`.

To regenerate one, reuse its job id as a reference in Higgsfield, or re-run the prompt below
against the same references. Then repeat the post-processing step, which is the part that makes
the file fit the code.

| File | What it is | Used by |
| --- | --- | --- |
| `tower-floor.png` | The observatory at night, in perspective. Owner-supplied, 2026-09-14; job id not recorded. | The first-light scene on an empty floor, and the workbench's connection deck |
| `floor-plan.jpg` | The same room from directly overhead, registered to the plan | The floor (`scriptorium/floor/stage.ts`), under the baked layer |
| `familiars/*.png` | One figure per order, transparent | The floor's actors and the first-light scene |
| `app-mark.png` | The Grimoire sigil as an engraved brass medallion, transparent | `scripts/icons.ts`, which composes every application icon from it |

## `familiars/quill.png`, `lantern.png`, `crucible.png`, `compass.png`, `ledger.png`

Generated 2026-09-30 with `gpt_image_2_5`, 2:3, 1k, quality high, `background: transparent`.
Each was given one reference: its own figure, cropped from the owner's earlier sheet
(`familiar-sheet.png`, removed in the same change, because its cream backdrop and captions were
baked into the pixels).

| File | Job |
| --- | --- |
| `quill.png` | `30f0e197-cd1c-4634-9895-30a0e12df2cc` |
| `lantern.png` | `6b3fe4f6-01c9-4947-ab80-83394dbd0f34` |
| `crucible.png` | `2c6c8193-9384-4d65-914f-3804d4990c7b` |
| `compass.png` | `15ef9216-bf8d-4622-9250-779ccb9d6f21` |
| `ledger.png` | `f3282b1c-3b84-49a6-86b8-8a213b423fb0` |

The prompt, with the figure's description changed per order:

> Redraw this exact pixel-art character as one clean game sprite: *[the figure]*. Identical
> design, colours, dark outline, proportions and crisp pixel-art style as the reference. Full
> body, standing, facing the viewer in the same pose, centered horizontally, feet near the bottom
> edge with a small margin, generous empty margin on every side. Fully transparent background:
> no backdrop, no paper colour, no ground shadow, no floor, no halo, no text, no caption, no
> letters, no border.

**Post-processing.** Alpha at or below 24 set to zero (the generator leaves a faint haze that
reads as fog on the floor), trimmed to the figure plus 6px, scaled to 384px tall with Lanczos.

## `floor-plan.jpg`

Generated 2026-09-30 with `gpt_image_2_5`, 1:1, 2k, quality high. Job
`3e4bce71-31d6-4622-9b1d-c4e527720572`, chosen over `71554582-1196-4d56-a48a-ccc8e673b31b`,
which set its ward circle off-centre.

Two references: a flat layout diagram drawn from `plan.ts` (the wall at 448–470, the door gap,
five desks at their bearings and radius with a dot at each lamp, the ward circle at 90, the
concourse at 196, the hearth, cabinet and lectern), and `tower-floor.png` for mood alone.

> Paint the first reference, a layout diagram, as a finished illustration of a circular stone
> tower study at night, seen from directly overhead: a strictly top-down orthographic plan view,
> camera pointing straight down, no perspective, no visible wall faces, no tilt. Use the second
> reference only for mood, palette, materials and lighting (moonlit blue flagstones, warm
> candlelight, brass inlay, deep violet night). Keep every element exactly where the diagram
> puts it, at the same size and orientation: *[each element, as above]*. Leave the floor around
> the desks and the ward circle clear and uncluttered so small figures can stand there. No
> people, no creatures, no text, no letters, no symbols inside the ward circle, no labels.

**Registration.** The painted ward ring was measured at world (495.5, 482.1), radius 84.7; the
wall's outer face at 442–476 along eight bearings. The image was scaled by 1.04 about the
ward ring's centre and moved so that centre is the plan's (500, 500), resampled to 2048×2048
so the file's square is exactly the 1000-unit world, and feathered to `--ink-void` beyond
radius 476 so there is no edge where it meets the letterbox. The painted candles were then
measured and written into `LAMPS` in `plan.ts`, because two of them were a desk-width away from
where the plan put the lamp. Saved as JPEG, quality 86.

## `app-mark.png`

Generated 2026-09-30 with `gpt_image_2_5`, 1:1, 1k, quality high, `background: transparent`.
Job `101f1d64-ef90-40a4-ab36-7a7a1fda2dd6`.

Made in two steps. First the code-drawn mark (`sigilGeometry("Grimoire")`, as the old
`scripts/icons.ts` rendered it) was given as the reference for a lamplit brass medallion on a
desk (jobs `8e0a441a-bc0b-412c-97c3-e682b33caccd` and `5aa8f5e7-3282-4889-873d-c8fa92838b7f`);
both read well large and turned to mud at 32px, because of the candles and books behind them.
The second of those was then the reference for the medallion alone:

> Isolate only the brass medallion from the reference as a standalone object: the same engraved
> antique brass ring with the same seven radial brass strokes crossing it at the same angles, the
> same dark ink-violet lacquered inlay, and the same bone-ivory diamond lozenge with a centre dot.
> Seen perfectly head-on and flat, perfectly centered, the ring spanning about 80 percent of the
> frame with even margin all round. Warm lamplight from the upper left, a trace of verdigris in
> the engraving. Fully transparent background: no candles, no books, no desk, no paper, no cast
> shadow, no glow, no text, no letters, no border.

**Post-processing.** Haze below alpha 24 cleared, trimmed, centred on a square, 768×768.
Everything around it — the tile, its lamplight, the shadow — is drawn by `scripts/icons.ts`.
