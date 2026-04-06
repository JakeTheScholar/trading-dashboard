"""
TradingView Email Monitor — reads alert emails from Gmail, parses trade data,
and serves it via REST API for the Trading Command Center.

Architecture:
  Gmail (IMAP) ← TradingView alert emails
       ↓
  email_monitor.py (this file)
       ↓ parses JSON from email body
       ↓ pairs entry + exit → completed trade with P&L
       ↓ stores in SQLite
       ↓
  REST API → Trading Command Center frontend fetches /api/trades

Setup:
  1. Enable IMAP in Gmail settings
  2. Create a Google App Password (requires 2FA enabled):
     - Google Account → Security → 2-Step Verification → App passwords
     - Generate one for "Mail" / "Windows Computer"
  3. Copy .env.example to .env and fill in credentials
  4. pip install -r requirements.txt
  5. python email_monitor.py
"""

import os
import re
import json
import imaplib
import email
import sqlite3
import logging
import threading
import time
from datetime import datetime, timezone, timedelta
from email.header import decode_header
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

# ── Config ──────────────────────────────────────────────────
GMAIL_USER = os.getenv("GMAIL_USER", "")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "60"))  # seconds
DB_PATH = os.getenv("DB_PATH", "trades.db")
MNQ_POINT_VALUE = 2.0  # MNQ = $2 per point

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("email-monitor")

# ── Database ────────────────────────────────────────────────

def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS raw_signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email_uid TEXT UNIQUE,
            received_at TEXT,
            action TEXT,
            symbol TEXT,
            quantity INTEGER,
            price REAL,
            raw_json TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT,
            symbol TEXT,
            direction TEXT,
            quantity INTEGER,
            entry_price REAL,
            exit_price REAL,
            entry_time TEXT,
            exit_time TEXT,
            pnl REAL,
            points REAL,
            entry_signal_id INTEGER,
            exit_signal_id INTEGER,
            synced INTEGER DEFAULT 0
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sync_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            synced_at TEXT,
            trade_count INTEGER
        )
    """)
    conn.commit()
    conn.close()


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ── Email Parsing ───────────────────────────────────────────

def decode_subject(msg):
    """Decode email subject, handling encoded headers."""
    raw = msg.get("Subject", "")
    parts = decode_header(raw)
    decoded = []
    for part, charset in parts:
        if isinstance(part, bytes):
            decoded.append(part.decode(charset or "utf-8", errors="replace"))
        else:
            decoded.append(part)
    return " ".join(decoded)


def extract_tradingview_json(msg):
    """Extract the JSON alert payload from a TradingView email body."""
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            if ctype == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    body = payload.decode("utf-8", errors="replace")
                    break
            elif ctype == "text/html" and not body:
                payload = part.get_payload(decode=True)
                if payload:
                    # Strip HTML tags for fallback
                    html = payload.decode("utf-8", errors="replace")
                    body = re.sub(r"<[^>]+>", " ", html)
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            body = payload.decode("utf-8", errors="replace")

    # Find JSON object in the body
    match = re.search(r'\{[^{}]*"symbol"\s*:\s*"[^"]*"[^{}]*\}', body)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    # Fallback: try to find any JSON-like structure with "data" key
    match = re.search(r'\{[^{}]*"data"\s*:\s*"[^"]*"[^{}]*\}', body)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    return None


def parse_email_date(msg):
    """Parse the email Date header into ISO format."""
    date_str = msg.get("Date", "")
    try:
        dt = email.utils.parsedate_to_datetime(date_str)
        return dt.astimezone(timezone(timedelta(hours=-4))).isoformat()  # ET
    except Exception:
        return datetime.now(timezone(timedelta(hours=-4))).isoformat()


def classify_action(data_field):
    """Classify the trade action from the PickMyTrade 'data' field."""
    d = data_field.lower().strip()
    if d == "buy":
        return "entry", "long"
    elif d == "sell":
        return "entry", "short"
    elif d == "closelong":
        return "exit", "long"
    elif d == "closeshort":
        return "exit", "short"
    return None, None


# ── Email Polling ───────────────────────────────────────────

def poll_gmail():
    """Connect to Gmail IMAP and fetch new TradingView alert emails."""
    if not GMAIL_USER or not GMAIL_APP_PASSWORD:
        log.warning("Gmail credentials not configured — skipping poll")
        return

    try:
        mail = imaplib.IMAP4_SSL("imap.gmail.com")
        mail.login(GMAIL_USER, GMAIL_APP_PASSWORD)
        mail.select("INBOX")

        # Search for TradingView alert emails not yet processed
        _, data = mail.search(None, '(FROM "noreply@tradingview.com" UNSEEN)')
        uids = data[0].split()

        if not uids:
            log.info("No new TradingView emails")
            mail.logout()
            return

        log.info(f"Found {len(uids)} new TradingView email(s)")
        db = get_db()

        for uid in uids:
            uid_str = uid.decode()

            # Skip if already processed
            existing = db.execute(
                "SELECT id FROM raw_signals WHERE email_uid = ?", (uid_str,)
            ).fetchone()
            if existing:
                continue

            _, msg_data = mail.fetch(uid, "(RFC822)")
            raw_email = msg_data[0][1]
            msg = email.message_from_bytes(raw_email)

            subject = decode_subject(msg)
            received_at = parse_email_date(msg)
            payload = extract_tradingview_json(msg)

            if not payload:
                log.warning(f"Could not parse JSON from email UID {uid_str}: {subject}")
                continue

            action = payload.get("data", "")
            symbol = payload.get("symbol", "MNQ")
            quantity = int(payload.get("quantity", 0))
            price = float(payload.get("price", 0))

            db.execute("""
                INSERT OR IGNORE INTO raw_signals
                (email_uid, received_at, action, symbol, quantity, price, raw_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (uid_str, received_at, action, symbol, quantity, price, json.dumps(payload)))

            log.info(f"Stored signal: {action} {symbol} x{quantity} @ {price}")

        db.commit()
        db.close()
        mail.logout()

        # After ingesting new signals, try to pair into trades
        pair_trades()

    except imaplib.IMAP4.error as e:
        log.error(f"IMAP error: {e}")
    except Exception as e:
        log.error(f"Email poll error: {e}")


def pair_trades():
    """Match entry signals with their corresponding exit signals to create completed trades."""
    db = get_db()

    # Get unpaired entry signals (not yet linked to a trade)
    entries = db.execute("""
        SELECT * FROM raw_signals
        WHERE (action = 'buy' OR action = 'sell')
        AND id NOT IN (SELECT entry_signal_id FROM trades WHERE entry_signal_id IS NOT NULL)
        ORDER BY received_at ASC
    """).fetchall()

    for entry in entries:
        entry_type, direction = classify_action(entry["action"])
        if entry_type != "entry":
            continue

        # Find the matching exit
        exit_action = "closelong" if direction == "long" else "closeshort"
        exit_signal = db.execute("""
            SELECT * FROM raw_signals
            WHERE action = ? AND symbol = ?
            AND received_at > ? AND received_at <= datetime(?, '+1 day')
            AND id NOT IN (SELECT exit_signal_id FROM trades WHERE exit_signal_id IS NOT NULL)
            ORDER BY received_at ASC LIMIT 1
        """, (exit_action, entry["symbol"], entry["received_at"], entry["received_at"])).fetchone()

        if not exit_signal:
            continue  # Exit hasn't arrived yet

        # Calculate P&L
        entry_price = entry["price"]
        exit_price = exit_signal["price"]
        quantity = entry["quantity"]

        if direction == "long":
            points = exit_price - entry_price
        else:
            points = entry_price - exit_price

        pnl = points * quantity * MNQ_POINT_VALUE

        # Extract times
        entry_dt = entry["received_at"]
        exit_dt = exit_signal["received_at"]
        trade_date = entry_dt[:10]  # YYYY-MM-DD
        entry_time = entry_dt[11:16] if len(entry_dt) > 16 else ""  # HH:MM
        exit_time = exit_dt[11:16] if len(exit_dt) > 16 else ""

        db.execute("""
            INSERT INTO trades
            (date, symbol, direction, quantity, entry_price, exit_price,
             entry_time, exit_time, pnl, points, entry_signal_id, exit_signal_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (trade_date, entry["symbol"], direction, quantity,
              entry_price, exit_price, entry_time, exit_time,
              pnl, points, entry["id"], exit_signal["id"]))

        log.info(f"Paired trade: {direction} {entry['symbol']} | "
                 f"Entry {entry_price} → Exit {exit_price} | "
                 f"P&L ${pnl:+.2f} ({points:+.1f} pts)")

    db.commit()
    db.close()


def poll_loop():
    """Background thread that polls Gmail on an interval."""
    log.info(f"Email monitor started — polling every {POLL_INTERVAL}s")
    while True:
        try:
            poll_gmail()
        except Exception as e:
            log.error(f"Poll loop error: {e}")
        time.sleep(POLL_INTERVAL)


# ── Flask API ───────────────────────────────────────────────

app = Flask(__name__)
CORS(app, origins=["http://localhost:*", "http://127.0.0.1:*", "null"])


@app.route("/api/trades", methods=["GET"])
def get_trades():
    """Return all completed trades, optionally filtered by date or unsynced only."""
    db = get_db()
    since = request.args.get("since")  # ISO date string
    unsynced = request.args.get("unsynced")  # "true" to get only unsynced

    query = "SELECT * FROM trades WHERE 1=1"
    params = []

    if since:
        query += " AND date >= ?"
        params.append(since)

    if unsynced == "true":
        query += " AND synced = 0"

    query += " ORDER BY date DESC, entry_time DESC"

    trades = db.execute(query, params).fetchall()
    result = [dict(t) for t in trades]
    db.close()
    return jsonify(result)


@app.route("/api/trades/mark-synced", methods=["POST"])
def mark_synced():
    """Mark trades as synced after the frontend has imported them."""
    data = request.get_json()
    if not data or "trade_ids" not in data:
        return jsonify({"error": "trade_ids required"}), 400

    trade_ids = data["trade_ids"]
    if not isinstance(trade_ids, list) or not all(isinstance(i, int) for i in trade_ids):
        return jsonify({"error": "trade_ids must be list of integers"}), 400

    db = get_db()
    placeholders = ",".join("?" * len(trade_ids))
    db.execute(f"UPDATE trades SET synced = 1 WHERE id IN ({placeholders})", trade_ids)
    db.execute("""
        INSERT INTO sync_log (synced_at, trade_count)
        VALUES (?, ?)
    """, (datetime.now(timezone(timedelta(hours=-4))).isoformat(), len(trade_ids)))
    db.commit()
    db.close()

    return jsonify({"marked": len(trade_ids)})


@app.route("/api/signals", methods=["GET"])
def get_signals():
    """Return raw signals for debugging."""
    db = get_db()
    signals = db.execute(
        "SELECT * FROM raw_signals ORDER BY received_at DESC LIMIT 50"
    ).fetchall()
    result = [dict(s) for s in signals]
    db.close()
    return jsonify(result)


@app.route("/api/status", methods=["GET"])
def get_status():
    """Health check + stats."""
    db = get_db()
    signal_count = db.execute("SELECT COUNT(*) FROM raw_signals").fetchone()[0]
    trade_count = db.execute("SELECT COUNT(*) FROM trades").fetchone()[0]
    unsynced = db.execute("SELECT COUNT(*) FROM trades WHERE synced = 0").fetchone()[0]
    last_signal = db.execute(
        "SELECT received_at FROM raw_signals ORDER BY received_at DESC LIMIT 1"
    ).fetchone()
    db.close()

    return jsonify({
        "status": "running",
        "gmail_configured": bool(GMAIL_USER and GMAIL_APP_PASSWORD),
        "poll_interval": POLL_INTERVAL,
        "total_signals": signal_count,
        "total_trades": trade_count,
        "unsynced_trades": unsynced,
        "last_signal": last_signal[0] if last_signal else None,
    })


@app.route("/api/poll", methods=["POST"])
def trigger_poll():
    """Manually trigger an email poll."""
    threading.Thread(target=poll_gmail, daemon=True).start()
    return jsonify({"message": "Poll triggered"})


# ── Main ────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    log.info("Database initialized")

    # Start background email poller
    poller = threading.Thread(target=poll_loop, daemon=True)
    poller.start()

    # Start API server
    port = int(os.getenv("PORT", "5555"))
    log.info(f"API server starting on http://localhost:{port}")
    app.run(host="127.0.0.1", port=port, debug=False)
