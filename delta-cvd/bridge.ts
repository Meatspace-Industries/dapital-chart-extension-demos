// The delta-cvd extension's bridge in Node. DEMO ONLY: Dapital does not support it or its data.
// Run only bridges you wrote or have read.
//
// It serves the trades feed on ws://127.0.0.1:8765/trades from the Binance spot raw trade stream
// (public, no key). It serves the exchange symbol it is started with, whatever symbol the chart's
// query names. It sends one JSON record per minute that had trades, per text frame:
//   {"feed": "trades", "time": <the minute's open, UTC seconds>, "buy": <q>, "sell": <q>}
// `buy` is the size that buyers took in that minute (trades whose buyer was the taker), and `sell`
// the size that sellers took. A busy market trades tens to hundreds of times a second, and one
// record per trade would pass the script's step limit within minutes (llms.txt, section 15).
//
//   node bridge.ts [--symbol BTCUSDT] [--port 8765]  live: Binance spot raw trades (needs ws)
//   node bridge.ts --replay frames.jsonl            serve a recording of raw frames (needs ws)
//   node bridge.ts --replay frames.jsonl --print --from <first bar's open time>
//                                                   print the records it would send, one per
//                                                   line, and exit (needs no package)
//
// Live, it keeps the last 24 hours of minutes in memory. At start it reads the trade stream, then
// fills the 24 hours before the stream's first full minute from the exchange's public 1m candles,
// whose taker-buy volume gives the same split. Each chart that connects gets the kept minutes
// from its `from`, then each minute as it closes, so the live bar updates once a minute. If the
// exchange stream closes, the bridge drops its minutes and its charts and starts again; the app
// reconnects within 3 seconds. A minute with no trades sends no record. It fills no other gap.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { WebSocket as Chart } from "ws";

// Never 0.0.0.0: the feed is for this machine only.
const HOST = "127.0.0.1";
const PATH = "/trades";
const MINUTE = 60;
const KEPT = 24 * 60 * MINUTE;
const RESTART_MS = 3000;

type Trade = { time: number; size: number; buyer: boolean };
type Minute = { feed: "trades"; time: number; buy: number; sell: number };

/** One raw Binance trade frame as a trade; null for any other frame. */
function trade(frame: string): Trade | null {
  const message = JSON.parse(frame);
  if (message.e !== "trade") return null;
  // m: the buyer was the maker, so a seller took the trade.
  return { time: message.T / 1000, size: Number(message.q), buyer: !message.m };
}

/** Sums trades, in time order, into minutes. */
class Minutes {
  open: Minute | null = null;

  /** Adds a trade; returns the minute it closes, if it starts another. */
  add(trade: Trade): Minute | null {
    const time = Math.floor(trade.time / MINUTE) * MINUTE;
    let closed: Minute | null = null;
    if (this.open && this.open.time !== time) closed = this.open;
    if (!this.open || closed) this.open = { feed: "trades", time, buy: 0, sell: 0 };
    // Sizes have at most 8 decimals; rounding each sum to them keeps the sums exact.
    const sum = (total: number) => Math.round((total + trade.size) * 1e8) / 1e8;
    if (trade.buyer) this.open.buy = sum(this.open.buy);
    else this.open.sell = sum(this.open.sell);
    return closed;
  }
}

/** The minutes of a recording, one raw frame per line, from `from` on, in frame order. */
async function* replay(file: string, from: number): AsyncGenerator<Minute> {
  const minutes = new Minutes();
  for await (const line of createInterface({ input: createReadStream(file) })) {
    if (!line.trim()) continue;
    const next = trade(line);
    const closed = next && minutes.add(next);
    if (closed && closed.time >= from) yield closed;
  }
  if (minutes.open && minutes.open.time >= from) yield minutes.open;
}

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
}

const recording = option("--replay");
const symbol = option("--symbol") ?? "BTCUSDT";
const port = Number(option("--port") ?? 8765);

if (process.argv.includes("--print")) {
  if (!recording) throw new Error("--print needs --replay <file>");
  for await (const minute of replay(recording, Number(option("--from") ?? 0))) {
    console.log(JSON.stringify(minute));
  }
} else {
  // The one dependency, needed only to serve.
  const { WebSocketServer } = await import("ws");
  const server = new WebSocketServer({ host: HOST, port, path: PATH });
  /** The live minutes kept, in time order, and each connected chart's `from`. */
  const kept: Minute[] = [];
  const charts = new Map<Chart, number>();

  function send(minutes: Minute[]) {
    for (const [chart, from] of charts) {
      for (const minute of minutes) {
        if (minute.time >= from) chart.send(JSON.stringify(minute));
      }
    }
  }

  /** Keeps minutes and sends them to the charts. */
  function keep(minutes: Minute[]) {
    kept.push(...minutes);
    kept.sort((a, b) => a.time - b.time);
    const oldest = kept[kept.length - 1].time - KEPT;
    kept.splice(0, kept.findIndex((minute) => minute.time > oldest));
    send(minutes);
  }

  /** The exchange's 1m candles of the kept span that ends at `last` (a minute's open), as
   *  minutes. */
  async function candles(last: number): Promise<Minute[]> {
    const minutes: Minute[] = [];
    let start = last + MINUTE - KEPT;
    while (start <= last) {
      const url = new URL("https://api.binance.com/api/v3/klines");
      url.search = new URLSearchParams({
        symbol,
        interval: "1m",
        startTime: String(start * 1000),
        endTime: String(last * 1000),
        limit: "1000",
      }).toString();
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      const rows: (string | number)[][] = await response.json();
      if (rows.length === 0) break;
      for (const row of rows) {
        // [open time, open, high, low, close, volume, close time, quote volume, trades,
        //  taker-buy volume, …]
        if (row[8] === 0) continue;
        const buy = Number(row[9]);
        const time = Number(row[0]) / 1000;
        const sell = Math.round((Number(row[5]) - buy) * 1e8) / 1e8;
        minutes.push({ feed: "trades", time, buy, sell });
      }
      start = Number(rows[rows.length - 1][0]) / 1000 + MINUTE;
    }
    return minutes;
  }

  function start() {
    // Node's built-in WebSocket client reads the exchange's public raw trade stream.
    const upstream = new WebSocket(
      `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@trade`,
    );
    const minutes = new Minutes();
    let filled = false;
    let stopped = false;
    upstream.onmessage = (event) => {
      const next = trade(String(event.data));
      const closed = next && minutes.add(next);
      if (!closed) return;
      if (filled) {
        keep([closed]);
        return;
      }
      // The stream's first minute started before the stream did: its candle and the 24 hours
      // before it come from the exchange's candles, which hold every trade of each minute.
      filled = true;
      candles(closed.time).then(
        (history) => stopped || keep(history),
        (error) => console.error(`No history: ${error}`),
      );
    };
    upstream.onclose = () => {
      stopped = true;
      kept.length = 0;
      for (const chart of charts.keys()) chart.close();
      charts.clear();
      console.error(`The ${symbol} trade stream closed; starting again`);
      setTimeout(start, RESTART_MS);
    };
  }

  server.on("connection", async (chart, request) => {
    const query = new URL(request.url ?? "/", `ws://${HOST}`).searchParams;
    const from = Number(query.get("from") ?? 0);
    if (recording) {
      for await (const minute of replay(recording, from)) chart.send(JSON.stringify(minute));
      return;
    }
    for (const minute of kept) if (minute.time >= from) chart.send(JSON.stringify(minute));
    charts.set(chart, from);
    chart.on("close", () => charts.delete(chart));
  });
  if (!recording) start();
  console.log(`Serving ${recording ?? symbol} trades on ws://${HOST}:${port}${PATH}`);
}
