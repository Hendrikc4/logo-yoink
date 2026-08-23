# Cowboy runner visual source

The supplied user images were treated as style references only. No composite sheet, generated logo, or baked-in interface text from those images is shipped at runtime.

## Art direction extracted from the references

- Bright cyan sky with large quiet regions for the title and HUD.
- Purple/mauve mesa layers above a warm orange desert.
- A thin lime grass edge and chunky dark-orange soil establish one exact gameplay baseline.
- Cowboy, horse, cactus, lasso, and UI use crisp 16-bit clusters, dark pixel outlines, and no antialias blur.
- Desktop keeps the opening copy on the left and the idle rider on the right. Mobile reserves more sky and anchors play to the lower fifth.

The approved generated reference images are `desktop-gameplay-reference.png` and `mobile-gameplay-reference.png`. Fresh text-free desktop and mobile backgrounds were generated from the same direction rather than cropped from either reference.

## Production generation prompts

The production prompts requested:

1. A text-free, logo-free Southwestern pixel-art background with cyan sky, sparse white pixel clouds, purple mesas, orange desert, lime grass edge, and an empty gameplay lane. Desktop and mobile were generated as separate compositions.
2. A side-view mustached cowboy in a brown hat, mustard shirt, red neckerchief, and blue jeans riding a chestnut horse with a dark mane and white muzzle marking.
3. One compact green saguaro obstacle with a clean game-readable silhouette.
4. One golden two-loop lasso power-up with amber outline and sparkling highlights.
5. A 3×2 rider animation sheet containing three gallop poses, two jump poses, and one damage pose, with generous separation and no baked-in scenery.

The first rider and animation-sheet outputs painted checkerboard backgrounds and were rejected. Background-extraction passes produced real alpha files, verified from channel data before use. The final six animation poses were cropped by non-overlapping pose bounds, alpha-trimmed, and re-centered on independent 512×512 transparent frames to prevent neighboring-horse bleed.

## Runtime provenance

- Generated runtime art lives under `public/assets/game/`.
- Local logo provenance, revisions, colors, license notes, and enable flags live in `public/assets/game/logos/manifest.json`.
- Eleven paths are pinned to Simple Icons revision `8ece2c134419494a02b49a118e93a53da575a86f`; Slack uses its official CDN artwork because that Simple Icons revision no longer includes Slack.
- Press Start 2P is pinned to Google Fonts revision `ec626514f79f831f1ab848a82114a0ce7e2d6372`, with its OFL license stored beside the font.
