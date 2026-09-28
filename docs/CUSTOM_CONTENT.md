# Notes and images

Apply `backend/src/db/migrations/011_custom_content.sql` before deploying this
feature. It adds content and enabled-state columns to `user_preferences`, using
the table's existing ownership policies.

On the Dashboard, use **Your notes and images** to write a note, select a local
PNG/JPEG, and enable each source. Choose **Save content**. In the layout editor,
add **My note** and/or **My image**, make space by moving or removing other
widgets, and save the layout. The Dashboard's saved-layout preview and Bluetooth
transfer use the same content. Changing a toggle hides content without deleting
it; **Remove image** removes the saved bitmap on the next save.

Notes allow 2,000 UTF-16 code units, with line breaks and the documented
[bitmap font coverage](TEXT_RENDERING.md). Content is plain text, not HTML.

Uploads are limited to 5 MiB, 16 million source pixels, and 16,384 pixels on
either side. PNG/JPEG headers are checked before browser decoding. Images are
resized proportionally to at most 512×512, composited on white and converted to
one-bit pixels. **Dither** uses Floyd–Steinberg error diffusion for photographs;
**Threshold** provides an adjustable cutoff for line art. The original photo
stays in the browser: only the converted bitmap is saved. Select the original
file again if you want to change conversion after saving or reloading.

**Fit whole image** centers the bitmap with white margins; **Crop to fill
widget** centers and crops it to the widget's aspect ratio. Both preserve aspect
ratio. Widget scaling uses nearest-neighbor sampling so it never invents gray
pixels. The small conversion preview shows the bitmap; the Dashboard preview
shows its actual placement in the saved layout.

The preferences API accepts optional `show_custom_text`, `custom_text`,
`show_custom_image` and `custom_image` fields. An image is `null`, or an object
with integer `width`/`height` (1–512), `fit` (`contain` or `cover`) and `pixels`.
`pixels` is canonical base64 containing MSB-first, tightly packed rows of
`ceil(width/8)` bytes: 1 means white, and unused row bits must be white. The
server validates dimensions, exact byte count, encoding and padding before
persisting. Preferences requests have a 64 KiB body limit; other routes retain
their existing limit. There is no image URL fetching or original-photo storage.

This feature draws on the [Inkplate image tools](https://github.com/SolderedElectronics/Inkplate-Arduino-library),
[Glider's dithering modes](https://github.com/Modos-Labs/Glider), and
[Tesserae's personal display content](https://tesserae.ink/).
