# Display text

The server's 8×8 bitmap font supports printable ASCII and these additional
characters in every widget and in both BMP and raw output:

- Danish: `æ ø å Æ Ø Å`.
- Accented Latin: `À Á Â Ã Ä È É Ê Ë Ì Í Î Ï Ñ Ò Ó Ô Õ Ö Ù Ú Û Ü Ý Ÿ`
  and `à á â ã ä è é ê ë ì í î ï ñ ò ó ô õ ö ù ú û ü ý ÿ`, plus `Ç ç ß`.
- Symbols: `° € £ ± × ÷`.
- Punctuation: `‘ ’ “ ” „ « » – — − … •` and non-breaking space.

Text is normalized to Unicode NFC, so `a` followed by a combining ring renders
the same as `å`. Wrapped text measures Unicode code points rather than UTF-16
units, preserves explicit paragraph breaks, and splits long words across lines
without dropping their remainder. Drawing remains clipped to each widget.
Ordinary spaces and tabs between words collapse to one space during wrapping;
non-breaking spaces remain inside a word.

Each unsupported code point draws one visible `?`. This font does not provide
full Unicode coverage, emoji, right-to-left layout, ligatures or script shaping.
Accented letters have compacted bodies to fit the same eight-pixel cell. The
additional glyphs are hand-drawn; no external font files are required.

The [Open Book's Unicode text support](https://www.oddlyspecificobjects.com/projects/openbook/)
inspired this focused improvement for Danish household data and European names.
