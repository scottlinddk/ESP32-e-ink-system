--[[--
Unpacks a device-feed raw frame into 8-bit grey pixels.

The frame is row-major, ceil(width / 8) bytes per row, most significant bit first,
1 = white. The target is one byte per pixel (0 = black, 255 = white), which is what
a KOReader 8-bit Blitbuffer holds. Needs LuaJIT, nothing from KOReader.
]]

local bit = require("bit")
local ffi = require("ffi")

local Bitmap = {}

--- Writes width x height pixels to target, a uint8_t pointer with `stride` bytes per row.
-- The caller guarantees #frame == row_bytes * height and stride >= width.
function Bitmap.unpack(frame, width, height, row_bytes, target, stride)
    assert(#frame == row_bytes * height, "frame length does not match its size")
    assert(stride >= width, "target rows are too short")
    local source = ffi.cast("const uint8_t *", frame)
    local band, rshift = bit.band, bit.rshift
    for y = 0, height - 1 do
        local source_row = y * row_bytes
        local target_row = y * stride
        for x = 0, width - 1 do
            local byte = source[source_row + rshift(x, 3)]
            target[target_row + x] = band(byte, rshift(0x80, band(x, 7))) ~= 0 and 0xFF or 0x00
        end
    end
end

return Bitmap
