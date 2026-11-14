# Small Batch: Golden Gate Park Picnic Tables

- `sd-card/`: the card contents, built from `model/` (the .glb copies are not committed).
- `stickers/`: the SD card labels.

```sh
bun run small-batch-dataset/build-sd-card.ts
bun run small-batch-dataset/flash-sd.ts   # erase a card to FAT32 and copy sd-card/ onto it
bun run small-batch-dataset/stickers/build.ts
```
