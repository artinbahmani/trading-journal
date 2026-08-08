# trading-journal

Trading journal and analytics: P&L, R multiples, equity curve, setup/weekday breakdowns, daily heatmap, pre-entry rules checklist. Vanilla JS, no dependencies

## Features

- Log trades with date, pair, long/short, entry, exit, stop loss, size, fees, setup tag, strategy tag, 1–5 execution rating, and notes
- Automatic per-trade net P&L (fees included) and R multiple computed from the stop-loss risk distance
- Trade table with column sorting and filters for pair, setup, win/loss/breakeven, and date range; click any row to edit or delete
- Analytics dashboard: total P&L, win rate, profit factor, expectancy, average win/loss, best and worst trade
- Equity curve, P&L by setup, and P&L by weekday rendered as inline SVG — no chart library
- Calendar heatmap of daily P&L with month navigation and a monthly summary
- Pre-entry rules checklist that gates the save button until every rule is checked
- localStorage persistence, CSV export/import, and one-click sample seed trades (48 trades, deterministic)

## Run

Open index.html in any modern browser. No build step, no dependencies.

## Controls / Usage

- `+ Log Trade` (or press `n`) opens the trade form; all checklist rules must be ticked before saving
- `Esc` closes the modal; clicking outside it does too
- Click table headers to sort; use the filter bar to narrow by pair, setup, result, or date range
- `Export CSV` downloads all trades; `Import CSV` merges a CSV back in (needs at least date, pair, entry, exit, size columns)
- `Sample Data` resets the journal to the seeded demo trades

## Tech notes

- Two plain scripts (`analytics.js` exposes a global `Analytics` object with pure math + SVG renderers; `app.js` owns state, DOM, persistence) so everything works over `file://` without modules or a server
- R multiple is net P&L divided by planned risk `|entry − stop| × size`; trades without a stop loss show `—` and always sort last
- Charts are hand-built SVG with CSS-variable theming — the equity curve flips green/red based on final cumulative P&L
- The CSV parser handles quoted fields, escaped quotes, and CRLF; exports include computed `pnl` and `rMultiple` columns that are ignored on re-import (they are recomputed)

## Roadmap

- Per-trade chart snapshots (canvas screenshot or image attach stored as data URL)
- Risk-of-ruin and drawdown statistics (max drawdown overlay on the equity curve)
- Editable rules checklist with custom rules per strategy
- Playbook view: per-setup expectancy, R histogram, and rating-vs-outcome correlation
- Multiple accounts/journals with a switcher and per-account currency
- Import adapters for broker exports (MT4/MT5, Binance CSV formats)
