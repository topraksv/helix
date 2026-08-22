# Helix interface standard

One app, one layout grammar. This document states where a component sits, who
owns the space around it, and how a surface changes with width. It is the
authority for *placement*; `src/ui/theme.ts` remains the authority for the
token values themselves, and `tests/design-system-contract.test.ts` plus
`e2e/ui-consistency.spec.ts` are what stop the rules decaying.

Read this before adding a screen, a card, a control cluster or a breakpoint.
A screen that needs a rule this document does not have is a request to extend
this document, not a licence to invent one locally.

## 1. The page

Every routed surface renders `Screen` — directly, or through a shared editor
body that does. `Screen` owns four things and a screen never restates any of
them:

| Owned by `Screen` | Value |
|---|---|
| Horizontal gutter | `spacing.lg` under 768px, `spacing.xxl` at or above it (`shouldUseWideGutter`) |
| Top inset | The safe area on a titled or headerless screen; a flat `spacing.lg` under a stack header |
| Bottom clearance | The floating tab bar's real clearance in tabs, otherwise the safe area plus `spacing.md` |
| Content column | `contentWidth[width]`, centred, filling below its cap |

A screen therefore never sets `paddingHorizontal` on its root, never sets
`maxWidth` on its root, and never adds bottom padding for the tab bar. If a
page's last row is hidden behind the bar, the defect is in `navigationInset`,
not in the page.

`width` is chosen from the information structure, never from taste:

- **`focus` (560)** — one decision at a time: sign-in, onboarding, recovery.
- **`form` (860)** — one object being edited, with its explanation beside it.
- **`workspace` (1180)** — a primary work area plus the records it manages.
- **`wide` (1560)** — dense financial data that earns the width.

Two adjacent surfaces at different widths make the page jump when you move
between them; that is what the named scale exists to prevent.

## 2. Vertical rhythm: a block owns the space below it

This is the single rule that keeps every screen in step, and the one most often
broken by a local fix.

**A block reserves the gap that follows it. A block never reserves the gap
above itself.** The two exceptions are stated below and are the only ones.

| Block | Reserves |
|---|---|
| `Card`, `HeroCard` | `marginBottom: spacing.md` |
| `Field`, `MoneyField`, `Select`, `Segmented`, `ChipPicker`, `MonthDayField` | `marginBottom: spacing.md` |
| `FieldNote` | `marginBottom: spacing.md` for the control **and** its sentence, as one block |
| `Divider` | `marginVertical: spacing.sm` — a separator, so symmetric by definition |
| `SectionHeader` | `marginTop: density.list.sectionGap`, `marginBottom: spacing.sm` — the second exception: a section head is a separator between two groups, so it owns both sides |

Consequences a caller must respect:

- Never write `marginTop` before a `Card`. If a card needs more air above it,
  the block before it is under-spaced, or a `SectionHeader` belongs there.
- Never write a negative margin to pull a hint up under its control. That
  sentence is part of the control: wrap the pair in `FieldNote`. A negative
  margin written per screen is how three screens end up with three gaps for
  the same relationship.
- A trailing action inside a card is separated from the content above it by
  `spacing.md`, the same step the card's own rows use.

### Inside a card

| Relationship | Gap |
|---|---|
| Peer blocks (a label block and its action, two fields on one line) | `spacing.md` — `Row`'s default |
| A tight cluster (badges, small buttons, an icon and its word) | `spacing.sm` |
| Inside a chip or badge | `spacing.xs` |
| Between two labelled figures in a strip | `spacing.sm` |

`density` names the rhythm per surface kind (`dashboard`, `list`, `settings`,
`analytics`); a card that reaches for a different padding uses a density name,
never a number.

## 3. Interaction: the lit box is the control

`interactionSurface` is the app's only hover and pressed fill, and it is
returned from the **pressable's own** style callback. Three rules follow, and
all three have already been paid for once:

1. **The pressable owns its padding.** Padding held by a wrapper leaves the
   fill floating inside an unlit margin.
2. **A container without a role never carries the fill.** The transition *is*
   the claim to be interactive.
3. **One cell, one lit region.** The test is whether the inner control has a
   box of its own. An `IconButton` is a bordered chip and reads as a separate
   button, so it keeps its own hover. A bare glyph sharing the outer control's
   box — a table header and its pin — does not: the *outer* control owns the
   fill and the inner one paints none.
   Nesting is not enough on its own: react-native-web's `Pressable` hard-codes
   `contain: true` on its hover, so entering the inner control ends the outer
   one's hover whether it is a child or a sibling, and a 24px strip lights on
   its own inside a cell that has gone dark. The inner control reports its
   pointer through `interactionSurface`'s `hovered` option instead, and keeps a
   pressed state of its own (`stateOpacity.pressed`) because native has no
   pointer to fall back on. Delegation is explicit state, so the inner control
   stays a **sibling**: nesting one button inside another is `nested-interactive`
   and axe fails it.

Pressed adds `translateY: 1`. Disabled keeps its resting fill and never reacts.

## 4. Choosing, editing, removing

**A choice is made with a selection control, never with a button that changes
its own variant.** `ChoiceTile`, `ChipPicker`, `SelectionGrid`, `Segmented` and
`Select` are the vocabulary; a primary/ghost `Button` that toggles is a control
whose state is invisible until you learn the colour code.

**A record's own actions are always the same pair, in the same order.** Where a
list row can be changed or removed:

```
<Row gap={spacing.sm}>
  <Button size="sm" variant="secondary" label={tr.common.edit} … />
  <Button size="sm" variant="ghost"     label={tr.common.delete} … />
</Row>
```

Destructive confirmation goes through `appConfirm`; a delete that can be
reversed reports through `useUndo` rather than a dialog.

### Transient surfaces

The confirmation bar is the one thing that appears over a settled screen. It
announces itself politely, it leaves on its own, and it can be pushed away by
dragging it **down** — a gesture claimed only after real movement, so the
actions it carries stay pressable. Nothing else in the app floats over content
without a scrim.

## 5. Rows, records and status

- Repeated records are `Card rows` holding `ListRow`s, or one `Card` per record
  when a record carries its own controls. `Card rows` exists so a row's fill
  reaches the card's edge; a card of rows never also sets vertical padding.
- Status and provenance are `Badge`s in a `Row gap={spacing.sm}` above the
  record's title, wrapping rather than truncating.
- A leading mark aligns with `useLedeAlignment`, so it centres against short
  text and stops travelling past three lines.
- **Nothing truncates.** Labels wrap; `maxFontScale.measuredBox` is the only
  place a text size is capped, and only where the box is a measured constant.

## 6. Responsive

**Every threshold is a named predicate in `src/ui/responsive.ts`.** A screen
that writes `width >= 720` inline has made a rule nobody can find, test or keep
consistent with the rule beside it. The predicate's name says what the width
buys; its comment says what was measured.

Standing rules:

- Navigation does not change with width. One bottom bar, every viewport.
- A phone keeps one reading column. Two columns require both that the width
  allows it *and* that both columns carry comparable mass (`shouldPairByMass`).
- Dense financial data stays in a shared table; it never becomes one card per
  value.
- A control stops filling its container above `shouldBoundIntrinsicControls`
  and carries its own intrinsic width instead.

## 7. Type, colour and money

- Inter carries dense content; IBM Plex Serif is limited to brand-level
  headings and high-value totals.
- Income/positive is green, expense/negative red, warning amber. Accent
  expresses hierarchy, never financial meaning.
- Direction is never carried by colour alone: a glyph or a word says it too.
- Displayed money goes through the shared compact formatter. Integer kuruş and
  ISO dates are the storage contract.
- Contextual table marks are the four fixed hues in `src/domain/matrix-colors.ts`.
  Their *names* are the owner's and are stored once for the whole account; the
  hue is the theme's and is measured in both schemes. The mark's strength is a
  measurement, not a taste: every pair must clear ΔE 5 against each other and
  against an unmarked cell, while the figure on the cell stays at AA.

## 8. Motion

- Durations come from `motion`, named for a user-perceived event.
- Reduced motion short-circuits every family.
- A screen arrives by rising, never by fading from zero — a full fade is the
  shape of a reload.
- A list arrives with `staggerDelay`, bounded by `motion.stagger.budget`.

### Which animation library

New motion is written with `react-native-reanimated`. The existing families in
`ui/motion-primitives.tsx` stay on React Native's `Animated` and are not being
converted: on native they already run on the UI thread through
`useNativeDriver`, and the ones that say `useNativeDriver: false` say it
deliberately, because a colour cannot be driven natively. Rewriting them buys
nothing a person can see and puts a suite of geometry and contrast assertions
at risk for it.

What Reanimated is for is the motion those families cannot express: anything
driven by a finger or a scroll offset, where a value has to change every frame
without a React render to carry it. Reach for the existing primitive first —
if `Collapse`, `SlideUp`, `FadeIn`, `useCountUp` or `useValueFlash` already
says what the screen means, use it and add nothing.

### Motion evaluated and not adopted

Recorded so the same three ideas are not costed twice.

**A cell that grows into its editor.** Apple's zoom transition needs iOS 18 and
Expo SDK 55, and this project is on 54; it is also iOS-only, while the primary
surface here is the web. Hand-rolling a shared element across a route push is
fragile on the web and would have to make `cell-editor` special, which breaks
the single `cardScreenOptions` presentation that twelve screens share. Revisit
with the SDK, not before.

**A saved amount that flies to the month it landed in.** Two things stop it.
Saving leaves the form, so the destination is not on screen to fly to; and the
matrix must not run per-cell animation hooks, which the `useCountUp` header
already states as the reason only one hero figure per surface uses one. What
the animation was for — saying where an entry landed — the undo bar already
says in words, including the month when it differs from the one being worked
in. The one thing it does not say is how an instalment plan spreads across
months, and that is a sentence, not an animation.

**Typing directly into a matrix cell.** The nearest thing to a spreadsheet, and
the most expensive: it lands in `sticky-table.tsx`, which carries incident
history for pinned headers and hover containment and the same no-per-cell-hooks
rule. Not attempted while the cell editor answers the same need from one tap
away.

## 9. What proves it

| Rule | Proof |
|---|---|
| Spacing comes from the scale; no raw colours | `tests/design-system-contract.test.ts` |
| No hand-written field-note margins | `tests/design-system-contract.test.ts` |
| No inline width thresholds outside `responsive.ts` | `tests/design-system-contract.test.ts` |
| Hover belongs to the control under the pointer | `e2e/ui-consistency.spec.ts` |
| Cards, rows and clusters keep even insets | `e2e/ui-consistency.spec.ts` |
| Nothing overflows its viewport across the target matrix | `e2e/ui-consistency.spec.ts` |

Visual regressions are proved with behaviour, semantics, measured geometry,
overflow, focus and rendered contrast first. A screenshot baseline is added
only when those layers cannot express a named risk — see
[`ARCHITECTURE.md`](ARCHITECTURE.md).
