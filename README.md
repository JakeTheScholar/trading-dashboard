# Trading Command Center

A real-time futures trading dashboard with automated trade journaling via email alerts. Built for prop firm traders managing multiple evaluation and funded accounts.

![Dashboard](https://img.shields.io/badge/status-active-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **Multi-Account Dashboard** -- Track equity, P&L, drawdown cushion, and win rate across multiple prop firm accounts simultaneously
- **Automated Trade Import** -- Gmail IMAP monitor parses TradingView email alerts, pairs entry/exit signals, and calculates P&L automatically
- **Trade Journal** -- Log trades manually or sync from bots with entry/exit prices, timestamps, and notes
- **Prop Firm Rule Engine** -- Built-in presets for Apex, Topstep, MyFundedFutures, Alpha Futures, and Lucid Trading with trailing drawdown, daily loss limits, consistency rules, and payout eligibility tracking
- **Equity Curves & Charts** -- SVG-based equity curves, daily P&L bar charts, and progress bars rendered without external chart libraries
- **Payout Tracker** -- Log payouts per account with firm-level aggregation on the dashboard
- **Risk Alerts** -- Real-time warnings when approaching daily loss limits or violating consistency rules
- **Export/Import** -- Full JSON backup and restore of all account and journal data
- **Zero Dependencies Frontend** -- Pure vanilla JS, Tailwind via CDN, localStorage persistence. No build step, no framework

## Screenshots

### Dashboard
Multi-account overview with equity stats, payout tracker, and risk alerts.

### Journal
Filter by firm, outcome, or time range. Quick-entry form supports batch logging to multiple accounts.

### Account Detail
Per-account equity curve with trailing drawdown floor, payout status, consistency tracking, and daily P&L distribution.

## Architecture

```
Frontend (index.html)           Backend (server/)
+-----------------------+       +-------------------------+
| Tailwind + Vanilla JS |       | Flask + IMAP            |
| localStorage for data |<----->| Gmail poll (60s)        |
| SVG charts (no libs)  |  API  | TradingView JSON parse  |
+-----------------------+       | SQLite trade storage    |
                                | REST API on :5555       |
                                +-------------------------+
```

The frontend works standalone -- the email monitor server is optional and only needed for automated bot trade syncing.

## Quick Start

### Frontend Only (Manual Trading)
```bash
# Just open the dashboard -- no server needed
open index.html
```
Add accounts, log trades, track performance. All data stored in browser localStorage.

### With Email Monitor (Automated Bot Trades)
```bash
# 1. Set up Gmail credentials
cd server
cp .env.example .env
# Edit .env with your Gmail address and App Password

# 2. Install Python dependencies
pip install -r requirements.txt

# 3. Start the email monitor
python email_monitor.py
```

### Gmail Setup
1. **Enable IMAP** in Gmail Settings > Forwarding and POP/IMAP
2. **Create an App Password** (requires 2FA):
   - Google Account > Security > 2-Step Verification > App passwords
   - Generate one for "Mail" / "Windows Computer"
3. Add credentials to `server/.env`

### Load Demo Data
Open the dashboard, go to **Settings > Import Data**, and import `demo-data.json` to see the dashboard populated with sample trades.

## Supported Prop Firms

| Firm | Eval | Funded | Features |
|------|------|--------|----------|
| Apex | 50K | 50K PA | Trailing DD, consistency rule |
| Topstep | -- | 50K Normal/Consistency XFA | Daily loss limit, min trading days |
| MyFundedFutures | 50K Core/Rapid | 50K Core/Rapid | EOD vs intraday drawdown |
| Alpha Futures | 50K | 50K | Daily loss limit, consistency |
| Lucid Trading | 50K | 50K | Min day amount |

## API Endpoints (Email Monitor)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Health check + stats |
| GET | `/api/trades` | All completed trades (filter: `?since=`, `?unsynced=true`) |
| GET | `/api/signals` | Raw email signals (debug) |
| POST | `/api/trades/mark-synced` | Mark trades as synced `{ "trade_ids": [1,2,3] }` |
| POST | `/api/poll` | Manually trigger email check |

## TradingView Alert Format

The email monitor expects JSON payloads in TradingView alert emails:

```json
{
  "symbol": "MNQ",
  "data": "buy",
  "quantity": 2,
  "price": 21450.25
}
```

Supported actions: `buy`, `sell`, `closelong`, `closeshort`

## Tech Stack

- **Frontend:** HTML, Tailwind CSS (CDN), Vanilla JavaScript, SVG charts
- **Backend:** Python, Flask, IMAP (Gmail), SQLite
- **Storage:** localStorage (frontend), SQLite (backend)
- **Fonts:** Cinzel, Bodoni Moda, Outfit, DM Sans

## License

MIT
