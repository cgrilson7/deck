# Foxtrot: four impressions

Image-generation prompts for **Gemini 3.1 Flash Image** (`gemini-3.1-flash-image`), each
depicting Foxtrot in one of his four roles. Every prompt is designed to be sent alongside the
sprite sheet (`src/renderer/src/assets/fox.png`) as a reference image — the model grounds its
voxel rendering on the pixel art.

## The four

| # | File | Use case | Aspect | Resolution | Bark |
|---|---|---|---|---|---|
| 1 | [01-the-deck.md](01-the-deck.md) | **The Deck** — status indicator on the monitor bezel, the developer's companion | 16:9 | 2K | YIP! |
| 2 | [02-the-head.md](02-the-head.md) | **The Head** — the watcher on the shelf, looking down over a field of session tiles | 4:3 | 2K | YIP! |
| 3 | [03-casa.md](03-casa.md) | **Casa** — holographic guardian projected from the Mac mini in a quiet home at dusk | 16:9 | 4K | CHRRP! |
| 4 | [04-the-pack.md](04-the-pack.md) | **The Pack** — the rust-orange alpha on a ridge, five gold betas working the hillside | 16:9 | 2K | ARF! |

## How to use

Each file has:
- **Prompt** — the full text, ready to paste into AI Studio or the Gemini API. Attach
  `fox.png` as the image input alongside it.
- **Notes** — fallback instructions for common model drift (fur, rounded cubes, wrong
  coat colors).

### API call shape (Gemini 3.1 Flash Image)

```python
import google.genai as genai

client = genai.Client()
fox_sheet = genai.upload_file("src/renderer/src/assets/fox.png")

response = client.models.generate_content(
    model="gemini-3.1-flash-image",
    contents=[fox_sheet, prompt_text],
    config=genai.types.GenerateContentConfig(
        response_modalities=["IMAGE", "TEXT"],
    ),
)
```

## Character reference

The base visual that every prompt opens with (paraphrased per scene):

> Foxtrot, a voxel fox built from chunky cubes, faithful to a 16x16 pixel-art sprite extruded
> into 3D. Rust-orange body with lighter orange highlight blocks on the back and cheeks,
> cream-white muzzle, chest bib and tail tip, a grey-white band before the tail tip, thick
> dark charcoal outline cubes around every edge (not pure black), a single white cube for the
> eye, dark stubby feet. Hard cube edges, no smoothing, no fur texture. Warm limited palette:
> rust, amber, cream, charcoal, grey.

The gold coat (betas in prompt 4): swap "rust-orange" for "warm gold-yellow."

His barks: "YIP!", "ARF!", "CHRRP!" — blocky pixel font (Press Start 2P), cream on charcoal,
flat 2D speech bursts floating in the 3D scene.

See also `docs/foxtrot-portrait.md` for the earlier AR-glasses and physical-robot prompts.
