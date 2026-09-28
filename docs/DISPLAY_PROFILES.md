# Display profiles

Run migration `009_display_profile.sql`. In the dashboard, choose native width/height and clockwise content rotation, then save. Defaults remain 250×122 monochrome. Dimensions are bounded to 64–1600 and at most 1,920,000 pixels. Content uses the existing 10×6 grid; rotation changes the logical canvas before pixels are mapped to native panel coordinates.

BMP files have four-byte row alignment. Raw output is top-down, MSB-first, one means white, and each row occupies `ceil(width/8)` bytes. The raw endpoint returns width, height, rotation, encoding and row-byte headers. The browser consumes pixels and metadata together, preventing a settings change from silently selecting the wrong payload size.

Bluetooth reads OpenDisplay's configuration before any image command, requires exactly one monochrome panel, matches native dimensions and keeps full refresh. Commands use big-endian opcodes per the [official protocol implementation](https://github.com/OpenDisplay/py-opendisplay/blob/main/src/opendisplay/protocol/commands.py). Config field sizes and byte offsets follow the [firmware structures](https://github.com/OpenDisplay/Firmware/blob/main/include/opendisplay_structs.h).

Current upstream firmware truncates direct-write rows when width is not divisible by eight. These widths are rejected, including legacy250×122; download the BMP for a compatible driver instead. Unknown configuration layouts, encrypted devices and mismatched panels are rejected, with no fallback image writes. A successful GATT write means transfer completion, not independently verified physical refresh. Panel profiles do not install drivers or establish hardware compatibility.
