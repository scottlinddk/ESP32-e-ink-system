--[[--
Stand-ins for the KOReader modules main.lua requires, for koreader/spec/run.lua.

They record what the plugin does (requests, widgets on screen, scheduled tasks) and
replay scripted HTTPS responses. They imitate the calling conventions only; they do
not prove that KOReader behaves the same way.
]]

local ffi = require("ffi")

local stubs = {}

local MODULES = {
    "ffi/blitbuffer", "ui/widget/container/centercontainer", "datastorage", "device", "dispatcher",
    "ui/widget/container/framecontainer", "ui/geometry", "ui/gesturerange", "ui/widget/imagewidget",
    "ui/widget/infomessage", "ui/widget/container/inputcontainer", "luasettings", "ui/widget/multiinputdialog",
    "ui/network/manager", "ui/uimanager", "ui/widget/container/widgetcontainer", "logger", "gettext",
    "ssl.https", "ltn12", "socketutil", "ffi/sha2", "pluginshare",
}

--- A class whose new() copies the given table, like KOReader widgets do.
local function class(record)
    local Class = {}
    Class.__index = Class
    function Class:new(object)
        object = setmetatable(object or {}, self)
        if record then record(object) end
        return object
    end
    function Class:extend(object)
        object = object or {}
        object.__index = object
        return setmetatable(object, { __index = self })
    end
    return Class
end

local function sha256(text)
    local path = os.tmpname()
    local file = assert(io.open(path, "wb"))
    file:write(text)
    file:close()
    local pipe = assert(io.popen("sha256sum " .. path))
    local digest = pipe:read("*a"):match("^(%x+)")
    pipe:close()
    os.remove(path)
    assert(digest, "sha256sum is required for the tests")
    return digest
end

--- Replaces the KOReader modules and returns the recording environment.
function stubs.install(options)
    local env = {
        saved = {}, requests = {}, responses = {}, shown = {}, messages = {}, scheduled = {},
        blitbuffers = {}, images = {}, wifi_released = 0, keep_awake = nil, now = 0, sha256 = sha256,
    }
    for _, name in ipairs(MODULES) do
        package.loaded[name] = nil
        package.preload[name] = nil
    end
    local preload = package.preload

    function env.respond(status, headers, body)
        env.responses[#env.responses + 1] = { status = status, headers = headers, body = body }
    end
    function env.fail(reason)
        env.responses[#env.responses + 1] = { fail = reason }
    end
    --- Runs the tasks that fall due within the given number of seconds, in order.
    -- The clock stops at the last task run, so delays booked by it read as booked.
    function env.runScheduled(seconds)
        local deadline = env.now + seconds
        while true do
            local index
            for i, task in ipairs(env.scheduled) do
                if task.at <= deadline and (not index or task.at < env.scheduled[index].at) then index = i end
            end
            if not index then break end
            local task = table.remove(env.scheduled, index)
            env.now = task.at
            task.action()
        end
    end
    --- Seconds until the given task runs, or nil when it is not booked.
    function env.nextDelay(action)
        for _, task in ipairs(env.scheduled) do
            if task.action == action then return task.at - env.now end
        end
        return nil
    end

    preload["ffi/blitbuffer"] = function()
        return {
            TYPE_BB8 = 1,
            COLOR_WHITE = "white",
            new = function(width, height)
                local bb = { w = width, h = height, stride = ffi.new("size_t", width), data = ffi.new("uint8_t[?]", width * height) }
                env.blitbuffers[#env.blitbuffers + 1] = bb
                return bb
            end,
        }
    end
    preload["ui/widget/container/centercontainer"] = function() return class() end
    preload["ui/widget/container/framecontainer"] = function() return class() end
    preload["ui/widget/container/inputcontainer"] = function() return class() end
    preload["ui/widget/container/widgetcontainer"] = function() return class() end
    preload["ui/widget/imagewidget"] = function()
        return class(function(image) env.images[#env.images + 1] = image end)
    end
    preload["ui/widget/infomessage"] = function()
        return class(function(message) message.is_message = true end)
    end
    preload["ui/widget/multiinputdialog"] = function() return class() end
    preload["ui/gesturerange"] = function() return class() end
    preload["ui/geometry"] = function()
        local Geom = class()
        function Geom:copy() return Geom:new{ x = self.x, y = self.y, w = self.w, h = self.h } end
        return Geom
    end
    preload["datastorage"] = function()
        return { getSettingsDir = function() return "/settings" end }
    end
    preload["luasettings"] = function()
        local store = {}
        function store:readSetting(key) return env.saved[key] end
        function store:saveSetting(key, value) env.saved[key] = value end
        function store:isTrue(key) return env.saved[key] == true end
        function store:flush() end
        return { open = function() return store end }
    end
    preload["device"] = function()
        return {
            screen = {
                getWidth = function() return options.screen[1] end,
                getHeight = function() return options.screen[2] end,
            },
            input = { group = { Any = {} } },
            isKindle = function() return false end,
            isKobo = function() return true end,
            isCervantes = function() return false end,
            isTouchDevice = function() return true end,
            hasKeys = function() return false end,
            hasBattery = function() return true end,
            getPowerDevice = function() return { getCapacity = function() return 64 end } end,
        }
    end
    preload["pluginshare"] = function()
        return setmetatable({}, { __newindex = function(_, key, value)
            if key == "pause_auto_suspend" then env.keep_awake = value end
        end })
    end
    preload["dispatcher"] = function()
        return { registerAction = function() end }
    end
    preload["ui/network/manager"] = function()
        return {
            runWhenConnected = function(_, callback) callback() end,
            afterWifiAction = function() env.wifi_released = env.wifi_released + 1 end,
        }
    end
    preload["ui/uimanager"] = function()
        local UIManager = {}
        function UIManager:scheduleIn(seconds, action)
            env.scheduled[#env.scheduled + 1] = { at = env.now + seconds, action = action }
        end
        function UIManager:unschedule(action)
            for i = #env.scheduled, 1, -1 do
                if env.scheduled[i].action == action then table.remove(env.scheduled, i) end
            end
        end
        function UIManager:show(widget)
            if widget.is_message then
                env.messages[#env.messages + 1] = widget.text
            else
                env.shown[#env.shown + 1] = widget
            end
        end
        function UIManager:close(widget)
            for i = #env.shown, 1, -1 do
                if env.shown[i] == widget then table.remove(env.shown, i) end
            end
        end
        return UIManager
    end
    preload["logger"] = function()
        local quiet = function() end
        return { info = quiet, warn = quiet, err = quiet, dbg = quiet }
    end
    preload["gettext"] = function()
        return function(text) return text end
    end
    preload["ltn12"] = function()
        return { source = { string = function(text) return function() local chunk = text; text = nil; return chunk end end } }
    end
    preload["socketutil"] = function()
        return { set_timeout = function() end, reset_timeout = function() end }
    end
    preload["ffi/sha2"] = function()
        return { sha256 = sha256 }
    end
    preload["ssl.https"] = function()
        return {
            request = function(params)
                local sent = params.source and params.source() or nil
                env.requests[#env.requests + 1] = { url = params.url, method = params.method, headers = params.headers,
                    redirect = params.redirect, verify = params.verify, sent = sent }
                local response = table.remove(env.responses, 1)
                assert(response, "unexpected request to " .. tostring(params.url))
                if response.fail then
                    return nil, response.fail
                end
                if response.body and response.body ~= "" then
                    local accepted, reason = params.sink(response.body)
                    if not accepted then return nil, reason end
                end
                params.sink(nil)
                return 1, response.status, response.headers
            end,
        }
    end
    return env
end

return stubs
