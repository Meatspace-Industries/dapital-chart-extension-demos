# Dapital chart extension demos

> **DEMOS ONLY. NOT SUPPORTED.**
> Dapital does not support, maintain, review or answer questions about these extensions, their
> bridges, or the data they show. They exist only to show what you can build. They can break,
> show wrong values, or stop working at any time. Run only code you have read.

The Dapital desktop app lets you write your own chart indicators: Luau scripts in the
`Extensions` folder of the app's data folder. These are two examples of that.

| Folder | What it shows | Needs |
| --- | --- | --- |
| [`sessions`](sessions/) | Shades the Sydney, Tokyo, London and New York sessions and boxes each session's high and low | Nothing else |
| [`delta-cvd`](delta-cvd/) | Two panes: buy volume minus sell volume per bar (delta), and its running total (CVD) | Node 23 or later, and the bridge running |

## Try one

1. In Dapital, open **Settings > Extensions**, turn on **Chart extensions**, and click
   **Open folder**.
2. Copy a demo folder (for example `sessions`) into that folder. It appears in the list within a
   second.
3. On a chart, open the indicators dialog and search for the study's name.

### The delta-cvd bridge

`delta-cvd` reads trades from a small local bridge, `bridge.ts`, that you run yourself. It
connects to Binance's public market data (no key) and serves one record per minute on
`ws://127.0.0.1:8765/trades`, with the last 24 hours of minutes.

```bash
cd delta-cvd
npm ci
node bridge.ts --symbol BTCUSDT
```

The data is Binance spot trades for the symbol you start it with, whatever market the chart
shows. Binance's terms apply to it.

## Write your own

Click **Copy example** in **Settings > Extensions**. It puts an example extension in your
`Extensions` folder with `llms.txt` and `dapital.d.luau`, the complete API reference. Read
`llms.txt`, or give it to your AI tool.

Errors from an extension are written to `.dapital/log.txt` in its folder.

## License

[MIT](LICENSE), with no warranty of any kind.
