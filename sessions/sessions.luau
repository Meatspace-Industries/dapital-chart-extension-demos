-- Sessions: shades the bars of each trading session and boxes each session instance
-- between its high and its low. Hours are whole local hours in each session's time zone.

local SESSIONS = {
  { id = "sydney", name = "Sydney", zone = "Australia/Sydney", start = 7, finish = 16, color = "#AB47BC" },
  { id = "tokyo", name = "Tokyo", zone = "Asia/Tokyo", start = 9, finish = 18, color = "#EF5350" },
  { id = "london", name = "London", zone = "Europe/London", start = 8, finish = 17, color = "#2962FF" },
  { id = "new_york", name = "New York", zone = "America/New_York", start = 8, finish = 17, color = "#FF9800" },
}
local ZONES = { "Australia/Sydney", "Asia/Tokyo", "Europe/London", "America/New_York", "Etc/UTC" }
local BACKGROUND_TRANSPARENCY = 85

local inputs, plots, fills = {}, {}, {}

for _, s in ipairs(SESSIONS) do
  inputs[s.id .. "_on"] = input.bool(true, { title = s.name })
  inputs[s.id .. "_start"] = input.int(s.start, { min = 0, max = 23, title = s.name .. " start hour" })
  inputs[s.id .. "_end"] = input.int(s.finish, { min = 0, max = 23, title = s.name .. " end hour" })
  inputs[s.id .. "_zone"] = input.options(s.zone, ZONES, { title = s.name .. " time zone" })
end

-- Backgrounds first, so the boxes paint above them (llms.txt, section 4).
for _, s in ipairs(SESSIONS) do
  plots[s.id] = plot.background(s.name, { color = s.color, transparency = BACKGROUND_TRANSPARENCY })
end

for _, s in ipairs(SESSIONS) do
  plots[s.id .. "_high"] = plot.step(s.name .. " high", { color = s.color })
  plots[s.id .. "_low"] = plot.step(s.name .. " low", { color = s.color })
end

for _, s in ipairs(SESSIONS) do
  fills[s.id .. "_box"] = fill(s.id .. "_high", s.id .. "_low", { title = s.name .. " box", color = s.color })
end

return study {
  name = "Sessions",
  placement = "overlay",
  inputs = inputs,
  plots = plots,
  fills = fills,
  compute = function(ctx)
    if ctx.interval > 3600 then
      return {}
    end

    local times, highs, lows = ctx.bars.time, ctx.bars.high, ctx.bars.low
    local n = #times
    local t, hi, lo = {}, {}, {}
    for i = 1, n do
      t[i], hi[i], lo[i] = times[i], highs[i], lows[i]
    end

    -- Each bar's local wall-clock time in a zone, one time.wall call per bar. Sessions
    -- that share a zone share the result.
    local wallsByZone = {}
    local function localWalls(zone)
      local cached = wallsByZone[zone]
      if cached then
        return cached
      end
      local result = {}
      for i = 1, n do
        result[i] = time.wall(t[i], zone)
      end
      wallsByZone[zone] = result
      return result
    end

    local out = {}
    for _, s in ipairs(SESSIONS) do
      local start, finish = ctx.inputs[s.id .. "_start"], ctx.inputs[s.id .. "_end"]
      if ctx.inputs[s.id .. "_on"] and start ~= finish then
        local walls = localWalls(ctx.inputs[s.id .. "_zone"])
        local wraps = finish < start

        -- An instance is the local day its window opened on.
        local instance, top, bottom = {}, {}, {}
        for i = 1, n do
          local h, day = walls[i].hour, walls[i].day
          local inside
          if wraps then
            inside = h >= start or h < finish
          else
            inside = h >= start and h < finish
          end
          if inside then
            local key = day
            if wraps and h < finish then
              key = day - 1
            end
            instance[i] = key
            top[key] = math.max(top[key] or hi[i], hi[i])
            bottom[key] = math.min(bottom[key] or lo[i], lo[i])
          end
        end

        local shade, high, low = {}, {}, {}
        for i = 1, n do
          local key = instance[i]
          if key ~= nil then
            shade[i], high[i], low[i] = 1, top[key], bottom[key]
          end
        end
        out[s.id] = shade
        out[s.id .. "_high"] = high
        out[s.id .. "_low"] = low
      end
    end
    return out
  end,
}
