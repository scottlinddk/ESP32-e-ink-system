--[[--
Device-feed protocol rules, free of KOReader dependencies so they run under plain LuaJIT.

The protocol is described in docs/DEVICE_DELIVERY.md. This module builds the requests,
checks what the server sent and decides when to ask again. It does no I/O.
]]

local Feed = {}

Feed.VERSION = "1.0.0"
-- Reported in the heartbeat; the server accepts 1-64 characters of [A-Za-z0-9._+/-].
Feed.CLIENT_VERSION = "koreader-plugin/" .. Feed.VERSION
Feed.ENCODING = "mono-msb-white1"
-- The same ceiling as tools/display-client.mjs.
Feed.MAX_BODY_BYTES = 512 * 1024
Feed.MIN_RETRY_SECONDS = 30
Feed.MAX_RETRY_SECONDS = 86400
Feed.DEFAULT_RETRY_SECONDS = 900
Feed.BACKOFF_BASE_SECONDS = 60
Feed.BACKOFF_MAX_SECONDS = 3600

local UUID = "^%x%x%x%x%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%x%x%x%x%x%x%x%x$"
local HASH = "^" .. string.rep("[0-9a-f]", 64) .. "$"

local function trim(value)
    return (tostring(value or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end
Feed.trim = trim

--- "https://host", "https://host/" and "https://host/api/" all become "https://host/api", as in the firmware.
-- @treturn string|nil normalized address
-- @treturn string|nil reason when the address is rejected
function Feed.normalizeApiUrl(value)
    local url = trim(value):gsub("/+$", "")
    if url == "" then
        return nil, "Enter the API address"
    end
    local rest = url:match("^[Hh][Tt][Tt][Pp][Ss]://(.+)$")
    if not rest then
        return nil, "The API address must start with https://"
    end
    local authority, path = rest:match("^([^/]+)(.*)$")
    if not authority or not (authority:match("^[%w%.%-]+$") or authority:match("^[%w%.%-]+:%d+$")) then
        -- NOTE: this also rejects user:password@host, so a token is never sent with embedded credentials.
        return nil, "The API address has an invalid host name"
    end
    if path:find("[^%w%.%-_~/]") then
        return nil, "The API address must not contain a query or other special characters"
    end
    url = "https://" .. authority .. path
    if not url:match("/api$") then
        url = url .. "/api"
    end
    return url
end

--- Checks the three settings a device needs.
-- @treturn table|nil {api_url, device_id, token}
-- @treturn string|nil what to fix
function Feed.config(settings)
    settings = settings or {}
    local api_url, reason = Feed.normalizeApiUrl(settings.api_url)
    if not api_url then
        return nil, reason
    end
    local device_id = trim(settings.device_id):lower()
    if not device_id:match(UUID) then
        return nil, "Enter the device ID (a UUID) from the device card"
    end
    local token = trim(settings.token)
    if not token:match("^einkd_[%w_%-]+$") or #token ~= 49 then
        return nil, "Enter the device token (it starts with einkd_)"
    end
    return { api_url = api_url, device_id = device_id, token = token }
end

--- Reads "key = value" lines. Unknown keys, comments and empty values are skipped.
function Feed.parseConfigFile(text)
    local values = {}
    for line in tostring(text or ""):gmatch("[^\r\n]+") do
        local key, value = line:match("^%s*([%a_]+)%s*=%s*(.-)%s*$")
        if key and value ~= "" and (key == "api_url" or key == "device_id" or key == "token") then
            values[key] = value
        end
    end
    return values
end

local function baseHeaders(config)
    return {
        ["Authorization"] = "Bearer " .. config.token,
        ["User-Agent"] = Feed.CLIENT_VERSION,
    }
end

--- The frame request. The screen size is declared so the server draws for this panel
-- (an unsupported size falls back to the display profile saved for the device).
function Feed.frameRequest(config, screen_width, screen_height, etag)
    local headers = baseHeaders(config)
    headers["Accept"] = "application/octet-stream"
    headers["X-Device-Width"] = string.format("%d", screen_width)
    headers["X-Device-Height"] = string.format("%d", screen_height)
    if etag then
        headers["If-None-Match"] = etag
    end
    return {
        method = "GET",
        url = config.api_url .. "/device-feed/" .. config.device_id .. "/frame?format=raw",
        headers = headers,
    }
end

--- The heartbeat request.
-- applied_hash: a hash string for a confirmed image, or nil to report that the shown image is unknown.
-- refresh_request_id is sent only together with a hash, as the server requires.
function Feed.heartbeatRequest(config, report)
    report = report or {}
    local fields = { string.format('"firmware_version":"%s"', Feed.CLIENT_VERSION) }
    local battery = tonumber(report.battery_percent)
    if battery and battery >= 0 and battery <= 100 then
        fields[#fields + 1] = string.format('"battery_percent":%d', math.floor(battery + 0.5))
    end
    local rssi = tonumber(report.rssi)
    if rssi and rssi < 0 and rssi >= -150 then
        fields[#fields + 1] = string.format('"rssi":%d', math.floor(rssi))
    end
    local hash = type(report.applied_hash) == "string" and report.applied_hash:match(HASH) and report.applied_hash
    fields[#fields + 1] = hash and string.format('"last_applied_hash":"%s"', hash) or '"last_applied_hash":null'
    local request_id = type(report.refresh_request_id) == "string" and report.refresh_request_id:lower()
    if hash and request_id and request_id:match(UUID) then
        fields[#fields + 1] = string.format('"refresh_request_id":"%s"', request_id)
    end
    local body = "{" .. table.concat(fields, ",") .. "}"
    local headers = baseHeaders(config)
    headers["Content-Type"] = "application/json"
    headers["Content-Length"] = tostring(#body)
    return {
        method = "POST",
        url = config.api_url .. "/device-feed/" .. config.device_id .. "/heartbeat",
        headers = headers,
        body = body,
    }
end

local function positiveInteger(value)
    local text = trim(value)
    if not text:match("^%d+$") then
        return nil
    end
    local number = tonumber(text)
    return number and number > 0 and number or nil
end

--- Validates a 200 frame response before anything is drawn.
-- headers must use lower-case names (LuaSocket delivers them that way).
-- sha256 is a function returning the lower-case hex digest of a string.
-- @treturn table|nil {width, height, row_bytes, hash, etag, refresh_request_id, body}
-- @treturn string|nil reason
function Feed.checkFrame(headers, body, sha256)
    headers = headers or {}
    body = body or ""
    local width = positiveInteger(headers["x-display-width"])
    local height = positiveInteger(headers["x-display-height"])
    local row_bytes = positiveInteger(headers["x-display-row-bytes"])
    if not width or not height or not row_bytes then
        return nil, "The server sent no image size: check the API address"
    end
    if trim(headers["x-display-encoding"]) ~= Feed.ENCODING then
        return nil, "The server sent an unsupported image encoding"
    end
    if row_bytes ~= math.ceil(width / 8) or row_bytes * height > Feed.MAX_BODY_BYTES then
        return nil, "The server sent an unsupported image size"
    end
    if #body ~= row_bytes * height then
        return nil, "The image is incomplete"
    end
    local hash = trim(headers["x-image-sha256"]):lower()
    if not hash:match(HASH) or sha256(body) ~= hash then
        return nil, "The image failed its integrity check"
    end
    local request_id = trim(headers["x-refresh-request-id"]):lower()
    return {
        width = width,
        height = height,
        row_bytes = row_bytes,
        hash = hash,
        etag = headers["etag"] and trim(headers["etag"]) or ('"' .. hash .. '"'),
        refresh_request_id = request_id:match(UUID) and request_id or nil,
        body = body,
    }
end

--- Seconds until the next check, from Retry-After, kept within sane bounds for an e-reader.
function Feed.retrySeconds(headers, fallback)
    local seconds = headers and positiveInteger(headers["retry-after"]) or fallback or Feed.DEFAULT_RETRY_SECONDS
    return math.min(Feed.MAX_RETRY_SECONDS, math.max(Feed.MIN_RETRY_SECONDS, seconds))
end

--- Delay after the nth failure in a row: 60 s, 120 s, 240 s ... up to one hour,
-- or longer when the server asked for more.
function Feed.backoffSeconds(failures, headers)
    local exponent = math.min(math.max((failures or 1) - 1, 0), 10)
    local delay = math.min(Feed.BACKOFF_MAX_SECONDS, Feed.BACKOFF_BASE_SECONDS * 2 ^ exponent)
    local hinted = headers and positiveInteger(headers["retry-after"])
    if hinted then
        delay = math.max(delay, math.min(hinted, Feed.MAX_RETRY_SECONDS))
    end
    return delay
end

--- What a frame response status means for the plugin.
-- @treturn string "frame" | "unchanged" | "quiet" | "auth" | "error"
-- @treturn string|nil message for "auth" and "error"
function Feed.classify(status)
    if status == 200 then return "frame" end
    if status == 304 then return "unchanged" end
    if status == 204 then return "quiet" end
    if status == 401 or status == 403 then
        return "auth", "The server rejected the device token: create a new one under Devices and enter it again"
    end
    if status == 404 then
        return "error", "The server does not know this address: check the API address"
    end
    if status == 429 then
        return "error", "The server is limiting requests: trying again later"
    end
    if type(status) == "number" and status >= 300 and status < 400 then
        return "error", "The server redirected the request: enter the final API address"
    end
    return "error", "The server answered with HTTP " .. tostring(status)
end

--- Wi-Fi signal level in dBm from the text of /proc/net/wireless, or nil when unknown.
function Feed.parseRssi(stats)
    -- Columns after the interface name: status, link quality, level, noise.
    local level = tonumber(tostring(stats or ""):match("%w+:%s+%x+%s+[%d.]+%s+(%-?%d+)"))
    -- NOTE: older drivers report dBm as an unsigned byte.
    if level and level >= 64 then
        level = level - 256
    end
    if level and level < 0 and level >= -150 then
        return level
    end
    return nil
end

return Feed
