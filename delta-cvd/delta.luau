-- Delta: per bar, the size of buyer-initiated trades minus the size of seller-initiated trades.
-- Each record is one minute of trades: `buy` and `sell` are the sizes each side took.
-- A bar with no records has no value: the script cannot tell a quiet bar from missing data.
return study {
  name = "Delta",
  placement = "pane",
  feeds = { "trades" },
  plots = {
    up = plot.histogram("Buy delta", { color = "#26A69A" }),
    down = plot.histogram("Sell delta", { color = "#EF5350" }),
  },
  compute = function(ctx)
    local trades = ctx.feeds.trades
    local up, down = {}, {}
    for i = 1, #trades do
      local records = trades[i]
      if #records > 0 then
        local delta = 0
        for _, record in ipairs(records) do
          delta += record.buy - record.sell
        end
        -- A delta of exactly 0 on a bar with records goes to up.
        if delta >= 0 then
          up[i] = delta
        else
          down[i] = delta
        end
      end
    end
    return { up = up, down = down }
  end,
}
