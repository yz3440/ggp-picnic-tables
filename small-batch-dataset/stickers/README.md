# Stickers

20 × 25 mm SD card labels, for Cricut Print Then Cut on Letter.

`bun run small-batch-dataset/stickers/build.ts --web` only writes the label the
site's About page puts on its turning SD card (`website/src/assets/sd-sticker.webp`).
The full build writes it too.

`out/cricut/` has one print image and one cut file per sheet:

| Sheet | Stickers | Print image | Cut layer |
| --- | --- | --- | --- |
| `park-letter-7.44x9.94` | 72 | 7.244 × 9.921 in | 7.126 × 9.803 in |
| `park-letter-6.75x9.25` | 60 | 6.614 × 9.055 in | 6.496 × 8.937 in |

Use the 6.75 × 9.25 sheet if Design Space says the larger one is too big.

## Design Space

1. Upload `-print.jpg` as a Print Then Cut image.
2. Upload `-cut.svg`.
3. Set both to the sizes in the table.
4. Select both and choose **Align → Center**.
5. Select the image and choose **Contour → Hide All Contours**.
6. Select both and click **Attach**.
7. Click **Make**. You should see one mat.
8. Print with **Add bleed** off, at 100% scale.
9. Cut with the **Printable Vinyl** preset.
