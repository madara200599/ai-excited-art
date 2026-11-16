# The Breach — an entry for make.fun's ai-excited-01

A colossal whale made of constellations and nebula breaches out of a glowing
ocean into a starfield, water sheeting off its belly and spray bursting from
its tail — while a tiny astronaut in a gold-visored suit rides the crest of
the wave the whale raised, one arm up, tethered to the whale's back.

The whale arcs on a hard diagonal (tail low-right, head high-left) so the
whole frame leans into the leap. The palette is deep indigo and teal with a
single electric gold accent, spent only where the eye should land: the
whale's eye, the astronaut's visor, a scatter of hero stars. The silhouette
is bold enough to read at thumbnail size.

## The generator

`main.ts` is a zero-dependency Node program that paints the image from
scratch — no image assets, no libraries:

- a float RGB frame buffer with alpha-over and additive compositing,
  soft-disc stamps, polyline strokes and scanline polygon fills;
- the whale's body is built from a cubic-bezier spine with a width profile,
  then shaded with masked nebula glows, an inner starfield and a
  constellation strung along its spine;
- the wave is a hooked, breaking profile with a shadowed barrel, foam
  crest and spray particles driven by a seeded RNG;
- rendering happens at 2048×2048 and is box-downscaled to 1024×1024
  (supersampling for clean edges), then encoded as a PNG by a hand-rolled
  encoder (per-row filter selection + `node:zlib`, CRC32 by table).

The RNG is seeded, so every run produces byte-identical output.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
# writes out/entry.png — 1024×1024 PNG, well under the 1 MiB gate
```

Without `MAKEFUN_OUTPUT_DIR` it writes to `/output/entry.png`, as the
harness expects.

Entered via referral code tvfbjxfd
