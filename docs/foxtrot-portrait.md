# Foxtrot off the screen: image prompts

Foxtrot on the deck is Elthen's pixel fox (`src/renderer/src/assets/fox.png`, terms in
`assets/LICENSE-fox.md`). These prompts describe him as a voxel figure for concept images: a
physical robot in the house, or a projection seen through AR glasses. They are for concept art;
anything shipped that is drawn from the sprite still owes Elthen credit.

## Base description (put this first in either prompt)

```
Foxtrot, a voxel fox built from chunky cubes, faithful to a 16x16 pixel-art sprite extruded into 3D. Rust-orange body with lighter orange highlight blocks on the back and cheeks, cream-white muzzle, chest bib and tail tip, a grey-white band before the tail tip, thick dark charcoal outline cubes around every edge (not pure black), a single white cube for the eye, dark stubby feet. Alert pose: sitting up tall, both ears straight up, tail raised, looking off to one side as if he just heard something. Proportions of a small dog, about knee height. Hard cube edges, no smoothing, no fur texture. Warm limited palette: rust, amber, cream, charcoal, grey.
```

## Option A: through AR glasses

```
First-person view through AR glasses, the frame edges softly vignetted like a lens. A quiet home at dusk, cream rug, warm lamps, front door in view. Foxtrot is a holographic voxel projection standing on the rug: translucent glowing cubes with a faint amber edge light, a subtle scanline shimmer, a soft glow on the rug beneath him, slightly ghosted where he overlaps furniture. He has just sat up alert and barked. Above him floats a blocky 8-bit speech burst reading "YIP!" in a chunky pixel font, cream on charcoal, like a retro game bark. In the corner of the lens a minimal HUD: a cream tile with a tiny pixel fox and three short lines of text. Photoreal room, only the fox and the HUD are digital. Cinematic, cool evening light with warm interior lamps.
```

## Option B: a physical robot in the home

```
He is a real robot in a real home: a physical voxel-fox chassis made of matte painted blocks with visible seams, small rubber pads under the feet, a faint amber glow in the eye cube, a tiny status LED on the chest bib. He sits on a cream wool rug in a quiet living room at dusk, warm lamp light, a window behind him with the last blue of evening outside. On the wall a small screen shows a grid of tiles in cream and charcoal. He has just sat up alert, head turned toward the front door. Shallow depth of field, photorealistic environment, the robot is the only voxel object in the scene. 35mm lens, natural light, cozy and calm, slightly cinematic.
```

## Notes

- If a model drifts toward a realistic fox, add "no fur, no realistic animal, strictly cubes,
  Minecraft-adjacent voxel style" near the front.
- A wolfpack beta wears the gold coat: swap "rust-orange" for "warm gold-yellow" in the base.
- His barks are "YIP!", "ARF!", "CHRRP!" in Press Start 2P; the deck's cream tile is his ground.
