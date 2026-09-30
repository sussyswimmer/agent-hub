# Where this art came from

Every image in this folder was generated on the owner's own Higgsfield account, at the owner's
direction, for this project. DECISIONS.md 0020 is the ruling that makes that the owner's art for
the purposes of CLAUDE.md §1. Nothing here was bought, licensed, downloaded or copied from
anywhere else, and no prompt names another work, artist, studio, game or franchise.

The only references given to the generator were images already in this repository or drawn from
it: the owner's earlier generations, the code-drawn sigil, and layout diagrams drawn from `plan.ts`.

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
`3c89302e-1e8d-4897-98bb-64ba1d89701d`, chosen over `39b7c15c-5d89-4b83-8b8a-24d1eec97789`,
which set the Ledger desk a chair's depth off the plan and painted the ward ring 125 units wide.
It replaces the first painting of the room (job `3e4bce71-31d6-4622-9b1d-c4e527720572`, a
1000-unit room), when the room was made bigger (DECISIONS 0025).

Two references: a flat layout diagram drawn from the new numbers for `plan.ts` (a 1600-unit room:
the wall at 740–772 with the door gap, five desks 180 × 54 at radius 500 with a dot on each for
the candle and a chair inboard, the ward circle at 110, a faint guide ring at 300, the hearth,
cabinet and lectern against the wall), uploaded as media `fcb81e90-fa7f-460e-8362-bb9548ed8004`;
and the first painting's job, for materials, palette and light.

> Paint the first reference, a layout diagram, as a finished illustration of a large circular
> stone tower hall at night, seen from directly overhead: a strictly top-down orthographic plan
> view, camera pointing straight down, no perspective, no visible wall faces, no tilt. The second
> reference is an earlier painting of a smaller version of this same room: match its materials,
> palette, lighting and painterly finish exactly (moonlit blue flagstones, warm candlelight,
> brass inlay, deep violet night), but follow the first reference for the layout. Keep every
> element exactly where the diagram puts it, at the same size and orientation: the thick round
> outer wall with the doorway gap and an open door leaf at the top; the brass ward circle, a
> double ring, in the exact centre; five wooden writing desks at the diagram's rectangles, each
> with a chair on its inner side and one lit candle on the desktop exactly at the yellow dot; a
> hearth with a low fire against the wall at the bottom; a tall glass-fronted cabinet against the
> wall on the right; a reading lectern with an open book against the wall on the left. The hall
> is wide and spacious: a great expanse of open flagstone floor between the desks and around the
> centre, with a few rugs, scattered books and small instruments near the wall only. Leave the
> open floor, the space around each desk, the area in front of the hearth and the ward circle
> clear and uncluttered so small figures can walk there. The faint thin ring in the diagram is
> only a guide; do not paint it. No people, no creatures, no text, no letters, no symbols inside
> the ward circle, no labels, no border.

**Registration.** The painted ward ring was fitted at pixel (1010.7, 970.9), radius 146 (114
units). The image was moved by (+13, +53) pixels so that centre is the plan's (800, 800), and not
scaled: 2048 pixels are the 1600-unit world. The painted wall's outer face was fitted as a circle
of radius 747 units whose centre is 17 units south of the ward ring — the painter drew the ring a
little north of the room's middle — and the image is feathered to `--ink-void` just beyond that
circle. The plan was then set from the painting rather than the other way round: `WARD_RADIUS`
114, the wall at 716–748, the cabinet, hearth and lectern at 622, 650 and 660, the Ledger desk at
478, and each desk's candle, found as the brightest warm blob near it, written into `LAMPS`.
Saved as JPEG, quality 86.

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
