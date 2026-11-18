-- CVD: the running total of each bar's delta (buy size minus sell size) from the first loaded
-- bar. Each record is one minute of trades: `buy` and `sell` are the sizes each side took.
-- It starts at 0, never resets, and bars without records add nothing and show no point.
return study {
  name = "CVD",
  placement = "pane",
  feeds = { "trades" },
  plots = {
    cvd = plot.line("CVD", { color = "#2962FF" }),
  },
  compute = function(ctx)
    local trades = ctx.feeds.trades
    local cvd, total = {}, 0
    for i = 1, #trades do
      local records = trades[i]
      if #records > 0 then
        for _, record in ipairs(records) do
          total += record.buy - record.sell
        end
        cvd[i] = total
      end
    end
    return { cvd = cvd }
  end,
}
