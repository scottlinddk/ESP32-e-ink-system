--[[--
E-Ink Display plugin for KOReader.

Turns a KOReader device (a jailbroken Kindle Paperwhite, a Kobo, ...) into a display of
the ESP32 E-Ink Home Display web app. It speaks the same device-feed protocol as the
ESP32 firmware (docs/DEVICE_DELIVERY.md): it asks for a frame with the device token,
checks size and SHA-256, draws it full screen, then reports battery and the applied
image in a heartbeat.

The protocol rules live in einkdisplay_feed.lua and the pixel unpacking in
einkdisplay_bitmap.lua; both are tested without KOReader (koreader/spec).
]]

local Blitbuffer = require("ffi/blitbuffer")
local CenterContainer = require("ui/widget/container/centercontainer")
local DataStorage = require("datastorage")
local Device = require("device")
local Dispatcher = require("dispatcher")
local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local ImageWidget = require("ui/widget/imagewidget")
local InfoMessage = require("ui/widget/infomessage")
local InputContainer = require("ui/widget/container/inputcontainer")
local LuaSettings = require("luasettings")
local MultiInputDialog = require("ui/widget/multiinputdialog")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local ffi = require("ffi")
local logger = require("logger")
local _ = require("gettext")

local Bitmap = require("einkdisplay_bitmap")
local Feed = require("einkdisplay_feed")

local Screen = Device.screen
local Input = Device.input

local EinkDisplay = WidgetContainer:extend{
    name = "einkdisplay",
    is_doc_only = false,
}

EinkDisplay.default_settings = {
    api_url = "",
    device_id = "",
    token = "",
    verify_tls = true,
    keep_awake = true,
    refresh_type = "full",
}

-- Seconds a request may take in total; requests block the UI.
local REQUEST_TOTAL_SECONDS = 30
local REQUEST_BLOCK_SECONDS = 10

--============================================================================--
-- Lifecycle
--============================================================================--

function EinkDisplay:init()
    self.store = LuaSettings:open(DataStorage:getSettingsDir() .. "/einkdisplay.lua")
    self.settings = self.store:readSetting("settings") or {}
    for key, value in pairs(self.default_settings) do
        if self.settings[key] == nil then
            self.settings[key] = value
        end
    end
    self.dashboard_active = self.store:isTrue("dashboard_active")
    self.failures = 0
    self:importConfigFile()

    -- NOTE: one function value per instance, so UIManager can unschedule exactly this task.
    self.refresh_task = function()
        self:fetch()
    end

    Dispatcher:registerAction("einkdisplay_fetch", { category = "none", event = "EinkDisplayFetch", title = _("E-Ink Display: update now"), general = true })
    Dispatcher:registerAction("einkdisplay_start", { category = "none", event = "EinkDisplayStart", title = _("E-Ink Display: start dashboard"), general = true })
    self.ui.menu:registerToMainMenu(self)

    if self.dashboard_active then
        -- A dashboard that was running when KOReader closed starts again by itself.
        if self.settings.keep_awake then
            self:setKeepAwake(true)
        end
        UIManager:scheduleIn(3, self.refresh_task)
    end
end

function EinkDisplay:saveSettings()
    self.store:saveSetting("settings", self.settings)
    self.store:saveSetting("dashboard_active", self.dashboard_active and true or false)
    self.store:flush()
end

function EinkDisplay:onFlushSettings()
    if self.store then
        self:saveSettings()
    end
end

function EinkDisplay:onSuspend()
    UIManager:unschedule(self.refresh_task)
end

function EinkDisplay:onResume()
    if self.dashboard_active then
        UIManager:unschedule(self.refresh_task)
        UIManager:scheduleIn(2, self.refresh_task)
    end
end

--- KOReader is closing, or switching between the file browser and a book.
-- The saved dashboard state is kept, so the next plugin instance continues.
function EinkDisplay:onCloseWidget()
    UIManager:unschedule(self.refresh_task)
    self:closeScreen()
end

--============================================================================--
-- Settings
--============================================================================--

function EinkDisplay:pluginDir()
    local source = debug.getinfo(1, "S").source
    return source:match("^@(.*/)") or "./"
end

--- Values typed into config.txt on a computer win over stored ones; empty lines change nothing.
function EinkDisplay:importConfigFile()
    local file = io.open(self:pluginDir() .. "config.txt", "r")
    if not file then
        return
    end
    local values = Feed.parseConfigFile(file:read("*a"))
    file:close()
    local changed = false
    for key, value in pairs(values) do
        if self.settings[key] ~= value then
            self.settings[key] = value
            changed = true
        end
    end
    if changed then
        logger.info("EinkDisplay: settings read from config.txt")
        self:saveSettings()
    end
end

function EinkDisplay:showSettingsDialog()
    self.settings_dialog = MultiInputDialog:new{
        title = _("E-Ink Display settings"),
        fields = {
            { text = self.settings.api_url or "", hint = _("API address, e.g. https://your-host.example/api"), input_type = "string" },
            { text = self.settings.device_id or "", hint = _("Device ID (UUID from the device card)"), input_type = "string" },
            { text = self.settings.token or "", hint = _("Device token (starts with einkd_)"), input_type = "string", password = true },
        },
        buttons = {
            {
                {
                    text = _("Cancel"),
                    id = "close",
                    callback = function()
                        UIManager:close(self.settings_dialog)
                    end,
                },
                {
                    text = _("Save"),
                    is_enter_default = true,
                    callback = function()
                        local fields = self.settings_dialog:getFields()
                        local candidate = { api_url = fields[1], device_id = fields[2], token = fields[3] }
                        local config, reason = Feed.config(candidate)
                        if not config then
                            self:notify(reason)
                            return
                        end
                        self.settings.api_url = config.api_url
                        self.settings.device_id = config.device_id
                        self.settings.token = config.token
                        self.applied = nil
                        self:saveSettings()
                        UIManager:close(self.settings_dialog)
                        self:notify(_("Settings saved."))
                    end,
                },
            },
        },
    }
    UIManager:show(self.settings_dialog)
    self.settings_dialog:onShowKeyboard()
end

--============================================================================--
-- Device state
--============================================================================--

--- Stops the device from sleeping while the dashboard runs, as KOReader's Keep alive plugin does.
function EinkDisplay:setKeepAwake(enabled)
    if Device:isKindle() then
        os.execute("lipc-set-prop com.lab126.powerd preventScreenSaver " .. (enabled and "1" or "0"))
    elseif Device:isKobo() or Device:isCervantes() then
        require("pluginshare").pause_auto_suspend = enabled
    end
    logger.info("EinkDisplay: keep awake", enabled and "on" or "off")
end

function EinkDisplay:batteryPercent()
    if not Device:hasBattery() then
        return nil
    end
    local ok, capacity = pcall(function()
        return Device:getPowerDevice():getCapacity()
    end)
    return ok and tonumber(capacity) or nil
end

function EinkDisplay:rssi()
    local file = io.open("/proc/net/wireless", "r")
    if not file then
        return nil
    end
    local stats = file:read("*a")
    file:close()
    return Feed.parseRssi(stats)
end

--============================================================================--
-- Network
--============================================================================--

--- One blocking HTTPS request.
-- @treturn number|nil status
-- @treturn table|string response headers (lower-case names), or the transport error
-- @treturn string|nil body
function EinkDisplay:request(request)
    local https = require("ssl.https")
    local ltn12 = require("ltn12")
    local socketutil = require("socketutil")

    local chunks, size = {}, 0
    local deadline = os.time() + REQUEST_TOTAL_SECONDS
    local params = {
        url = request.url,
        method = request.method,
        headers = request.headers,
        -- NOTE: a redirect would carry the device token to another address.
        redirect = false,
        sink = function(chunk)
            if chunk then
                size = size + #chunk
                if size > Feed.MAX_BODY_BYTES then
                    return nil, "response too large"
                end
                if os.time() > deadline then
                    return nil, "timeout"
                end
                chunks[#chunks + 1] = chunk
            end
            return 1
        end,
    }
    if request.body then
        params.source = ltn12.source.string(request.body)
    end
    if not self.settings.verify_tls then
        -- NOTE: left unset otherwise, so KOReader verifies against its CA bundle when it has one.
        params.verify = "none"
    end

    socketutil:set_timeout(REQUEST_BLOCK_SECONDS, REQUEST_TOTAL_SECONDS)
    local ok, result, status, headers = pcall(https.request, params)
    socketutil:reset_timeout()
    if not ok then
        return nil, tostring(result)
    end
    if not result then
        -- On a transport failure LuaSocket returns the reason in place of the status.
        return nil, tostring(status)
    end
    return status, headers or {}, table.concat(chunks)
end

--- Starts one update: connect Wi-Fi if needed, fetch, draw, report.
function EinkDisplay:fetch(manual)
    local config, reason = Feed.config(self.settings)
    if not config then
        self:stopDashboard()
        self:notify(reason)
        return
    end
    -- A second tap while an update is on its way does not start another one.
    if self.fetch_started and os.time() - self.fetch_started < 30 then
        return
    end
    self.fetch_started = os.time()
    UIManager:unschedule(self.refresh_task)
    if self.dashboard_active then
        -- NOTE: a Wi-Fi connection that fails never runs the callback below, so the
        -- retry is booked first. A completed attempt replaces it.
        UIManager:scheduleIn(Feed.backoffSeconds(self.failures + 1), self.refresh_task)
    end
    NetworkMgr:runWhenConnected(function()
        -- Some devices report "connected" a moment before requests work.
        UIManager:scheduleIn(2, function()
            self:performFetch(config, manual)
        end)
    end)
end

function EinkDisplay:performFetch(config, manual)
    local width, height = Screen:getWidth(), Screen:getHeight()
    -- The ETag is only offered while its image is still on screen.
    local etag = self.screen_widget and self.applied and self.applied.etag or nil
    logger.info("EinkDisplay: requesting frame", width, "x", height)
    local status, headers, body = self:request(Feed.frameRequest(config, width, height, etag))

    if not status then
        self:finish(false, nil, _("Could not reach the server: ") .. tostring(headers), manual)
        return
    end

    local outcome, message = Feed.classify(status)
    if outcome == "auth" then
        logger.warn("EinkDisplay: device token rejected, HTTP", status)
        self.fetch_started = nil
        self:stopDashboard()
        NetworkMgr:afterWifiAction()
        self:notify(message)
        return
    end
    if outcome == "error" then
        self:finish(false, headers, message, manual)
        return
    end

    local request_id
    if outcome == "frame" then
        local frame, reason = Feed.checkFrame(headers, body, require("ffi/sha2").sha256)
        if not frame then
            -- NOTE: Retry-After of a good response is the normal interval, not a reason to wait with the retry.
            self:finish(false, nil, reason, manual)
            return
        end
        if not self:showFrame(frame) then
            -- The previous image is still on screen, so what was reported stays true.
            self:finish(false, nil, _("The image could not be drawn"), manual)
            return
        end
        self.applied = { hash = frame.hash, etag = frame.etag }
        request_id = frame.refresh_request_id
    else
        -- "unchanged" and "quiet" (204 during quiet hours) keep what is on screen.
        logger.info("EinkDisplay: nothing new, HTTP", status)
    end

    self:heartbeat(config, request_id)
    self:finish(true, headers, nil, manual)
end

--- Reports battery, signal and the image now on screen. A failure is only logged:
-- the next update reports again.
function EinkDisplay:heartbeat(config, request_id)
    local shown = self.screen_widget and self.applied and self.applied.hash or nil
    local status, detail = self:request(Feed.heartbeatRequest(config, {
        battery_percent = self:batteryPercent(),
        rssi = self:rssi(),
        applied_hash = shown,
        refresh_request_id = request_id,
    }))
    if status ~= 200 then
        logger.warn("EinkDisplay: heartbeat not accepted:", status or detail)
    end
end

--- Ends an attempt: lets KOReader apply its "when done with Wi-Fi" setting and books the next check.
function EinkDisplay:finish(succeeded, headers, message, manual)
    self.fetch_started = nil
    NetworkMgr:afterWifiAction()
    local delay
    if succeeded then
        self.failures = 0
        delay = Feed.retrySeconds(type(headers) == "table" and headers or nil)
    else
        self.failures = self.failures + 1
        delay = Feed.backoffSeconds(self.failures, type(headers) == "table" and headers or nil)
        logger.warn("EinkDisplay:", message)
        -- An error over a running dashboard is only shown when someone asked for the update.
        if manual or not self.screen_widget then
            self:notify(message)
        end
    end
    UIManager:unschedule(self.refresh_task)
    if self.dashboard_active then
        logger.info("EinkDisplay: next check in", delay, "seconds")
        UIManager:scheduleIn(delay, self.refresh_task)
    end
end

--============================================================================--
-- Screen
--============================================================================--

--- Draws a checked frame full screen. The previous image stays until the new one is ready.
-- @treturn boolean whether the frame is now on screen
function EinkDisplay:showFrame(frame)
    local ok, image_bb = pcall(function()
        local bb = Blitbuffer.new(frame.width, frame.height, Blitbuffer.TYPE_BB8)
        Bitmap.unpack(frame.body, frame.width, frame.height, frame.row_bytes,
            ffi.cast("uint8_t *", bb.data), tonumber(bb.stride))
        return bb
    end)
    if not ok or not image_bb then
        logger.err("EinkDisplay: could not unpack the frame:", image_bb)
        return false
    end

    local screen_width, screen_height = Screen:getWidth(), Screen:getHeight()
    local exact = frame.width == screen_width and frame.height == screen_height
    local image = ImageWidget:new{
        image = image_bb,
        image_disposable = true,
        width = screen_width,
        height = screen_height,
        -- A frame drawn for another size (the saved display profile) is fitted to the screen.
        scale_factor = exact and 1 or 0,
    }

    self:closeScreen()
    local full_screen = Geom:new{ x = 0, y = 0, w = screen_width, h = screen_height }
    local plugin = self
    local widget = InputContainer:new{
        dimen = full_screen:copy(),
        covers_fullscreen = true,
        FrameContainer:new{
            background = Blitbuffer.COLOR_WHITE,
            bordersize = 0,
            padding = 0,
            margin = 0,
            width = screen_width,
            height = screen_height,
            CenterContainer:new{
                dimen = Geom:new{ w = screen_width, h = screen_height },
                image,
            },
        },
    }
    function widget:onUpdateNow()
        plugin:fetch(true)
        return true
    end
    function widget:onCloseDashboard()
        plugin:stopDashboard()
        return true
    end
    if Device:isTouchDevice() then
        -- Hold closes, so a stray tap on a wall display only asks for an update.
        widget.ges_events = {
            UpdateNow = { GestureRange:new{ ges = "tap", range = full_screen } },
            CloseDashboard = { GestureRange:new{ ges = "hold", range = full_screen } },
        }
    end
    if Device:hasKeys() then
        widget.key_events = { CloseDashboard = { { Input.group.Any } } }
    end

    self.screen_widget = widget
    UIManager:show(widget, self.settings.refresh_type or "full")
    logger.info("EinkDisplay: frame shown", frame.width, "x", frame.height)
    return true
end

function EinkDisplay:closeScreen()
    if self.screen_widget then
        UIManager:close(self.screen_widget)
        self.screen_widget = nil
    end
end

function EinkDisplay:notify(text)
    logger.info("EinkDisplay:", text)
    UIManager:show(InfoMessage:new{ text = text, timeout = 6 })
end

--============================================================================--
-- Dashboard
--============================================================================--

function EinkDisplay:startDashboard()
    local config, reason = Feed.config(self.settings)
    if not config then
        self:notify(reason)
        return
    end
    self.dashboard_active = true
    self.failures = 0
    self:saveSettings()
    if self.settings.keep_awake then
        self:setKeepAwake(true)
    end
    self:fetch(true)
end

function EinkDisplay:stopDashboard()
    UIManager:unschedule(self.refresh_task)
    self:closeScreen()
    if self.dashboard_active then
        -- Only a dashboard that was running hands sleep control back to the device.
        if self.settings.keep_awake then
            self:setKeepAwake(false)
        end
        self.dashboard_active = false
        self:saveSettings()
        logger.info("EinkDisplay: dashboard stopped")
    end
end

function EinkDisplay:onEinkDisplayFetch()
    self:fetch(true)
    return true
end

function EinkDisplay:onEinkDisplayStart()
    self:startDashboard()
    return true
end

--============================================================================--
-- Menu
--============================================================================--

function EinkDisplay:toggleItem(text, key, after)
    return {
        text = text,
        checked_func = function()
            return self.settings[key] and true or false
        end,
        callback = function()
            self.settings[key] = not self.settings[key]
            self:saveSettings()
            if after then
                after()
            end
        end,
    }
end

function EinkDisplay:refreshTypeItem(text, value)
    return {
        text = text,
        checked_func = function()
            return (self.settings.refresh_type or "full") == value
        end,
        radio = true,
        callback = function()
            self.settings.refresh_type = value
            self:saveSettings()
        end,
    }
end

function EinkDisplay:addToMainMenu(menu_items)
    menu_items.einkdisplay = {
        text = _("E-Ink Display"),
        sorting_hint = "tools",
        sub_item_table = {
            {
                text_func = function()
                    return self.dashboard_active and _("Stop dashboard") or _("Start dashboard")
                end,
                callback = function()
                    if self.dashboard_active then
                        self:stopDashboard()
                    else
                        self:startDashboard()
                    end
                end,
            },
            {
                text = _("Update now"),
                callback = function()
                    self:fetch(true)
                end,
            },
            {
                text = _("Settings"),
                keep_menu_open = true,
                callback = function()
                    self:showSettingsDialog()
                end,
            },
            self:toggleItem(_("Keep the device awake while the dashboard runs"), "keep_awake", function()
                if self.dashboard_active then
                    self:setKeepAwake(self.settings.keep_awake)
                end
            end),
            self:toggleItem(_("Verify the server certificate"), "verify_tls"),
            {
                text = _("E-ink refresh type"),
                sub_item_table = {
                    self:refreshTypeItem(_("Full (cleanest image)"), "full"),
                    self:refreshTypeItem(_("UI (no flash)"), "ui"),
                    self:refreshTypeItem(_("Partial (fastest)"), "partial"),
                },
            },
        },
    }
end

return EinkDisplay
