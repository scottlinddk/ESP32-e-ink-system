--[[--
Tests for the E-Ink Display KOReader plugin. Needs only LuaJIT:

    luajit koreader/spec/run.lua

The protocol and bitmap modules are tested directly. main.lua runs against small
stand-ins for the KOReader modules it uses (koreader/spec/stubs.lua), so a whole
update cycle is exercised without an e-reader. KOReader's own widgets, Wi-Fi handling
and the e-ink screen are not covered here and need a device.
]]

local here = debug.getinfo(1, "S").source:match("^@(.*/)") or "./"
local plugin_dir = here .. "../einkdisplay.koplugin/"
package.path = plugin_dir .. "?.lua;" .. here .. "?.lua;" .. package.path

local ffi = require("ffi")
local Feed = require("einkdisplay_feed")
local Bitmap = require("einkdisplay_bitmap")
local stubs = require("stubs")

local passed, failed = 0, {}
local function test(name, body)
    local ok, err = xpcall(body, debug.traceback)
    if ok then
        passed = passed + 1
    else
        failed[#failed + 1] = name .. "\n" .. tostring(err)
    end
end
local function equal(actual, expected, label)
    if actual ~= expected then
        error((label or "value") .. ": expected " .. tostring(expected) .. ", got " .. tostring(actual), 2)
    end
end

local TOKEN = "einkd_" .. string.rep("a", 43)
local DEVICE = "3f2b8c1e-9d4a-4b6f-8e21-0a1b2c3d4e5f"
local CONFIG = { api_url = "https://display.example/api", device_id = DEVICE, token = TOKEN }
local HASH = string.rep("ab", 32)

--============================================================================--
-- Protocol rules
--============================================================================--

test("API addresses are normalized like the firmware does", function()
    equal(Feed.normalizeApiUrl("https://display.example"), "https://display.example/api")
    equal(Feed.normalizeApiUrl(" https://display.example/ "), "https://display.example/api")
    equal(Feed.normalizeApiUrl("https://display.example/api/"), "https://display.example/api")
    equal(Feed.normalizeApiUrl("https://display.example:8443/eink"), "https://display.example:8443/eink/api")
end)

test("unsafe API addresses are rejected", function()
    for _, url in ipairs({ "", "http://display.example", "display.example", "https://user:pw@display.example",
        "https://display.example/api?x=1", "https://display.example/a b", "https:///api" }) do
        local result, reason = Feed.normalizeApiUrl(url)
        equal(result, nil, url)
        assert(type(reason) == "string" and reason ~= "", "a reason for " .. url)
    end
end)

test("settings are checked before any request", function()
    local config = assert(Feed.config({ api_url = "https://display.example", device_id = DEVICE:upper(), token = " " .. TOKEN .. "\n" }))
    equal(config.api_url, "https://display.example/api")
    equal(config.device_id, DEVICE)
    equal(config.token, TOKEN)
    equal(Feed.config({ api_url = "https://display.example", device_id = "kindle", token = TOKEN }), nil)
    equal(Feed.config({ api_url = "https://display.example", device_id = DEVICE, token = "einkd_short" }), nil)
    equal(Feed.config({ api_url = "https://display.example", device_id = DEVICE, token = TOKEN .. "\r\nX-Evil: 1" }), nil)
    equal(Feed.config(nil), nil)
end)

test("config.txt keeps comments and empty values out", function()
    local values = Feed.parseConfigFile("# note\r\napi_url = https://display.example/api\ndevice_id=" .. DEVICE .. "\ntoken =\nother = 1\n")
    equal(values.api_url, "https://display.example/api")
    equal(values.device_id, DEVICE)
    equal(values.token, nil)
    equal(values.other, nil)
end)

test("the frame request carries the token, the screen size and the ETag", function()
    local request = Feed.frameRequest(CONFIG, 1072, 1448, '"etag"')
    equal(request.url, "https://display.example/api/device-feed/" .. DEVICE .. "/frame?format=raw")
    equal(request.headers["Authorization"], "Bearer " .. TOKEN)
    equal(request.headers["X-Device-Width"], "1072")
    equal(request.headers["X-Device-Height"], "1448")
    equal(request.headers["If-None-Match"], '"etag"')
    equal(Feed.frameRequest(CONFIG, 1072, 1448).headers["If-None-Match"], nil)
end)

test("the heartbeat matches what the server validates", function()
    local request = Feed.heartbeatRequest(CONFIG, { battery_percent = 78.4, rssi = -61, applied_hash = HASH, refresh_request_id = DEVICE:upper() })
    equal(request.url, "https://display.example/api/device-feed/" .. DEVICE .. "/heartbeat")
    equal(request.body, '{"firmware_version":"koreader-plugin/' .. Feed.VERSION .. '","battery_percent":78,"rssi":-61,"last_applied_hash":"'
        .. HASH .. '","refresh_request_id":"' .. DEVICE .. '"}')
    equal(request.headers["Content-Length"], tostring(#request.body))
    assert(Feed.CLIENT_VERSION:match("^[A-Za-z0-9][A-Za-z0-9._+/-]*$") and #Feed.CLIENT_VERSION <= 64, "version format")
end)

test("an unknown image is reported as null and never acknowledges a request", function()
    local request = Feed.heartbeatRequest(CONFIG, { battery_percent = 140, rssi = 5, applied_hash = "nope", refresh_request_id = DEVICE })
    equal(request.body, '{"firmware_version":"koreader-plugin/' .. Feed.VERSION .. '","last_applied_hash":null}')
end)

local function frameHeaders(width, height, hash, extra)
    local headers = {
        ["x-display-width"] = tostring(width), ["x-display-height"] = tostring(height),
        ["x-display-row-bytes"] = tostring(math.ceil(width / 8)), ["x-display-encoding"] = "mono-msb-white1",
        ["x-image-sha256"] = hash, ["etag"] = '"' .. hash .. '"', ["retry-after"] = "900",
    }
    for key, value in pairs(extra or {}) do headers[key] = value end
    return headers
end
local function fixedHash() return HASH end

test("a valid frame is accepted", function()
    local body = string.rep("\255", 9 * 80)
    local frame = assert(Feed.checkFrame(frameHeaders(70, 80, HASH, { ["x-refresh-request-id"] = DEVICE }), body, fixedHash))
    equal(frame.width, 70)
    equal(frame.height, 80)
    equal(frame.row_bytes, 9)
    equal(frame.hash, HASH)
    equal(frame.etag, '"' .. HASH .. '"')
    equal(frame.refresh_request_id, DEVICE)
end)

test("damaged or mislabelled frames are rejected", function()
    local body = string.rep("\255", 9 * 80)
    local function rejected(headers, payload, label)
        equal(Feed.checkFrame(headers, payload, fixedHash), nil, label)
    end
    rejected(frameHeaders(70, 80, HASH), body:sub(2), "short body")
    rejected(frameHeaders(70, 80, string.rep("cd", 32)), body, "hash mismatch")
    rejected(frameHeaders(70, 80, HASH, { ["x-display-row-bytes"] = "8" }), body, "row bytes")
    rejected(frameHeaders(70, 80, HASH, { ["x-display-encoding"] = "gray8" }), body, "encoding")
    rejected(frameHeaders(70, 80, HASH, { ["x-display-width"] = "-70" }), body, "negative width")
    rejected({}, body, "no headers")
    rejected(frameHeaders(8000, 8000, HASH), body, "oversized")
end)

test("check intervals stay within bounds", function()
    equal(Feed.retrySeconds({ ["retry-after"] = "900" }), 900)
    equal(Feed.retrySeconds({ ["retry-after"] = "1" }), Feed.MIN_RETRY_SECONDS)
    equal(Feed.retrySeconds({ ["retry-after"] = "999999" }), Feed.MAX_RETRY_SECONDS)
    equal(Feed.retrySeconds({ ["retry-after"] = "soon" }), Feed.DEFAULT_RETRY_SECONDS)
    equal(Feed.retrySeconds(nil), Feed.DEFAULT_RETRY_SECONDS)
    equal(Feed.backoffSeconds(1), 60)
    equal(Feed.backoffSeconds(2), 120)
    equal(Feed.backoffSeconds(3), 240)
    equal(Feed.backoffSeconds(50), 3600)
    equal(Feed.backoffSeconds(1, { ["retry-after"] = "600" }), 600)
end)

test("statuses map to the right outcome", function()
    equal(Feed.classify(200), "frame")
    equal(Feed.classify(304), "unchanged")
    equal(Feed.classify(204), "quiet")
    equal(Feed.classify(401), "auth")
    equal(Feed.classify(302), "error")
    equal(Feed.classify(503), "error")
end)

test("signal strength is read from /proc/net/wireless", function()
    local stats = "Inter-| sta-|   Quality        |   Discarded packets\n face | tus | link level noise |  nwid\n wlan0: 0000   55.  -55.  -256        0\n"
    equal(Feed.parseRssi(stats), -55)
    equal(Feed.parseRssi(" wlan0: 0000   70.  201.  0        0\n"), -55)
    equal(Feed.parseRssi(""), nil)
end)

--============================================================================--
-- Pixels
--============================================================================--

test("bits become grey pixels, most significant bit first, ignoring row padding", function()
    -- 10 pixels wide: two bytes per row, the last six bits are padding.
    local frame = string.char(0xA5, 0xFF, 0x00, 0x40)
    local stride = 12
    local target = ffi.new("uint8_t[?]", stride * 2, 0x77)
    Bitmap.unpack(frame, 10, 2, 2, target, stride)
    local rows = {}
    for y = 0, 1 do
        local row = {}
        for x = 0, 9 do row[#row + 1] = target[y * stride + x] == 0xFF and "1" or (target[y * stride + x] == 0 and "0" or "?") end
        rows[#rows + 1] = table.concat(row)
    end
    equal(rows[1], "1010010111")
    equal(rows[2], "0000000001")
    equal(target[10], 0x77, "bytes past the width stay untouched")
end)

test("a frame of the wrong length is refused", function()
    local target = ffi.new("uint8_t[?]", 16)
    equal(pcall(Bitmap.unpack, "\255", 8, 2, 1, target, 8), false)
end)

--============================================================================--
-- A whole update cycle in main.lua
--============================================================================--

local function rawFrame(width, height)
    local row_bytes = math.ceil(width / 8)
    local rows = {}
    for y = 1, height do rows[y] = string.rep(string.char(y % 2 == 0 and 0xFF or 0x0F), row_bytes) end
    return table.concat(rows)
end

local function newPlugin(env, settings)
    env.saved.settings = settings or { api_url = CONFIG.api_url, device_id = DEVICE, token = TOKEN }
    local EinkDisplay = dofile(plugin_dir .. "main.lua")
    local plugin = EinkDisplay:new{ ui = { menu = { registerToMainMenu = function() end } } }
    plugin:init()
    return plugin
end

test("a frame is drawn, acknowledged and the next check is booked", function()
    local env = stubs.install({ screen = { 600, 800 } })
    local body = rawFrame(600, 800)
    local hash = env.sha256(body)
    env.respond(200, frameHeaders(600, 800, hash, { ["x-refresh-request-id"] = DEVICE }), body)
    env.respond(200, {}, '{"accepted":true}')
    local plugin = newPlugin(env)
    plugin:startDashboard()
    env.runScheduled(5)

    equal(#env.requests, 2, "requests")
    equal(env.requests[1].headers["X-Device-Width"], "600")
    equal(env.requests[1].redirect, false, "redirects are refused")
    equal(env.requests[2].method, "POST")
    assert(env.requests[2].sent:find('"last_applied_hash":"' .. hash .. '"', 1, true), "heartbeat reports the hash")
    assert(env.requests[2].sent:find('"refresh_request_id":"' .. DEVICE .. '"', 1, true), "heartbeat acknowledges the request")
    assert(env.requests[2].sent:find('"battery_percent":64', 1, true), "heartbeat reports the battery")
    equal(#env.shown, 1, "one widget on screen")
    equal(env.shown[1].covers_fullscreen, true)
    local bb = env.blitbuffers[1]
    equal(bb.data[0], 0x00, "first row starts black")
    equal(bb.data[4], 0xFF, "first row turns white")
    equal(bb.data[600], 0xFF, "second row is white")
    equal(env.nextDelay(plugin.refresh_task), 900, "next check follows Retry-After")
    equal(env.wifi_released, 1)
    equal(env.keep_awake, true)

    -- The following check offers the ETag; 304 keeps the image and still reports in.
    env.respond(304, { ["retry-after"] = "1200" }, "")
    env.respond(200, {}, '{"accepted":true}')
    env.runScheduled(905)
    equal(env.requests[3].headers["If-None-Match"], '"' .. hash .. '"')
    equal(#env.shown, 1)
    equal(env.nextDelay(plugin.refresh_task), 1200)

    plugin:stopDashboard()
    equal(#env.shown, 0, "screen closed")
    equal(env.keep_awake, false)
    equal(env.saved.dashboard_active, false)
    equal(env.nextDelay(plugin.refresh_task), nil, "nothing booked after stopping")
end)

test("a frame for another size is still shown, fitted to the screen", function()
    local env = stubs.install({ screen = { 1236, 1648 } })
    local body = rawFrame(250, 122)
    env.respond(200, frameHeaders(250, 122, env.sha256(body)), body)
    env.respond(200, {}, "{}")
    local plugin = newPlugin(env)
    plugin:fetch(true)
    env.runScheduled(5)
    equal(#env.shown, 1)
    equal(env.images[1].scale_factor, 0)
end)

test("a corrupt image is not drawn and the attempt backs off", function()
    local env = stubs.install({ screen = { 600, 800 } })
    env.respond(200, frameHeaders(600, 800, HASH), rawFrame(600, 800))
    local plugin = newPlugin(env)
    plugin:startDashboard()
    env.runScheduled(5)
    equal(#env.shown, 0)
    equal(#env.requests, 1, "no heartbeat claims an image")
    equal(env.nextDelay(plugin.refresh_task), 60)
    assert(env.messages[1]:find("integrity", 1, true), "the reason is shown")
end)

test("a rejected token stops the dashboard", function()
    local env = stubs.install({ screen = { 600, 800 } })
    env.respond(401, {}, '{"error":"Invalid device token"}')
    local plugin = newPlugin(env)
    plugin:startDashboard()
    env.runScheduled(5)
    equal(plugin.dashboard_active, false)
    equal(env.saved.dashboard_active, false)
    equal(env.nextDelay(plugin.refresh_task), nil)
    assert(env.messages[1]:find("token", 1, true), "the message names the token")
end)

test("an unreachable server keeps the old image and retries later", function()
    local env = stubs.install({ screen = { 600, 800 } })
    local body = rawFrame(600, 800)
    env.respond(200, frameHeaders(600, 800, env.sha256(body)), body)
    env.respond(200, {}, "{}")
    local plugin = newPlugin(env)
    plugin:startDashboard()
    env.runScheduled(5)
    env.fail("connection refused")
    env.runScheduled(905)
    equal(#env.shown, 1, "the image stays")
    equal(env.nextDelay(plugin.refresh_task), 60)
    equal(#env.messages, 0, "no pop-up over a running dashboard")
    env.fail("connection refused")
    env.runScheduled(65)
    equal(env.nextDelay(plugin.refresh_task), 120)
end)

test("missing settings are reported instead of requested", function()
    local env = stubs.install({ screen = { 600, 800 } })
    local plugin = newPlugin(env, { api_url = "", device_id = "", token = "" })
    plugin:startDashboard()
    env.runScheduled(5)
    equal(#env.requests, 0)
    equal(plugin.dashboard_active, false)
    equal(#env.messages, 1)
end)

test("a dashboard that was running starts again with KOReader", function()
    local env = stubs.install({ screen = { 600, 800 } })
    env.saved.dashboard_active = true
    local body = rawFrame(600, 800)
    env.respond(200, frameHeaders(600, 800, env.sha256(body)), body)
    env.respond(200, {}, "{}")
    newPlugin(env)
    env.runScheduled(10)
    equal(#env.shown, 1)
    equal(env.keep_awake, true)
end)

--============================================================================--

for _, message in ipairs(failed) do
    io.stderr:write("FAIL " .. message .. "\n\n")
end
print(string.format("%d passed, %d failed", passed, #failed))
os.exit(#failed == 0 and 0 or 1)
