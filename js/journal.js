"use strict";

const Journal = {
  filters: { firm: 'all', outcome: 'all', range: 'month' },
  editingId: null,
  expandedId: null,

  render(el) {
    const accounts = Store.getAccounts().filter(a => a.status === 'active');
    let html = '';

    html += '<div class="panel" style="padding:24px;margin-bottom:24px">';
    html += '<div style="font-size:15px;font-weight:600;margin-bottom:16px"><span style="color:var(--gold)">+</span> ' + (Journal.editingId ? 'Edit Trade' : 'Quick Trade Entry') + '</div>';

    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:12px">';
    if (Journal.editingId) {
      html += '<div><div class="form-label">Account</div><select class="form-input" id="j-account">';
      accounts.forEach(a => { html += '<option value="' + a.id + '">' + UI.esc(a.name) + '</option>'; });
      html += '</select></div>';
    } else {
      html += '<div><div class="form-label">Accounts <span style="font-size:9px;color:var(--text-muted);text-transform:none;letter-spacing:0">(select multiple)</span></div>';
      html += '<div id="j-accounts-wrap" style="display:flex;flex-wrap:wrap;gap:6px">';
      accounts.forEach(a => {
        html += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;padding:4px 10px;border:1px solid var(--glass-border);border-radius:6px;background:var(--deep)">';
        html += '<input type="checkbox" class="j-account-cb" value="' + a.id + '" style="accent-color:var(--gold)"> ' + UI.esc(a.name);
        html += '</label>';
      });
      html += '</div></div>';
    }
    html += '<div><div class="form-label">Date</div><input type="date" class="form-input" id="j-date" value="' + UI.today() + '"></div>';
    html += '<div><div class="form-label">P&L ($)</div><input type="text" class="form-input" id="j-pnl" placeholder="+275 or -150"></div>';
    html += '<div><div class="form-label">Entry Price</div><input type="text" class="form-input" id="j-entry-price" placeholder="21,450.25"></div>';
    html += '<div><div class="form-label">Exit Price</div><input type="text" class="form-input" id="j-exit-price" placeholder="21,462.50"></div>';
    html += '</div>';

    html += '<div style="display:grid;grid-template-columns:140px 140px 120px 1fr;gap:12px;margin-bottom:12px">';
    html += '<div><div class="form-label">Entry Time</div><input type="time" class="form-input" id="j-entry-time"></div>';
    html += '<div><div class="form-label">Exit Time</div><input type="time" class="form-input" id="j-exit-time"></div>';
    html += '<div><div class="form-label">Traded By</div><select class="form-input" id="j-traded-by"><option value="manual">Manual</option><option value="bot">Bot</option></select></div>';
    html += '<div><div class="form-label">Notes</div><textarea class="form-input" id="j-notes" rows="2" placeholder="What did you see? Why did you enter? What did you learn?" style="resize:vertical;min-height:42px"></textarea></div>';
    html += '</div>';

    html += '<div style="display:flex;justify-content:flex-end;gap:8px">';
    if (Journal.editingId) {
      html += '<button class="btn btn-ghost btn-sm" onclick="Journal.cancelEdit()">Cancel</button>';
    }
    html += '<button class="btn btn-ghost btn-sm" onclick="Journal.clearForm()">Clear</button>';
    html += '<button class="btn btn-primary btn-sm" onclick="Journal.saveEntry()">' + (Journal.editingId ? 'Update Trade' : 'Log Trade') + '</button>';
    html += '</div></div>';

    html += '<div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap">';
    ['all', 'topstep', 'apex', 'mff', 'alpha', 'lucid'].forEach(f => {
      const labels = { all: 'All Accounts', topstep: 'Topstep', apex: 'Apex', mff: 'MFF', alpha: 'Alpha', lucid: 'Lucid' };
      const label = labels[f] || f;
      html += '<div class="filter-chip' + (Journal.filters.firm === f ? ' active' : '') + '" onclick="Journal.setFilter(\'firm\',\'' + f + '\')">' + label + '</div>';
    });
    html += '<span style="color:var(--text-muted)">|</span>';
    ['all', 'winners', 'losers'].forEach(f => {
      const label = f === 'all' ? 'All Trades' : f.charAt(0).toUpperCase() + f.slice(1);
      html += '<div class="filter-chip' + (Journal.filters.outcome === f ? ' active' : '') + '" onclick="Journal.setFilter(\'outcome\',\'' + f + '\')">' + label + '</div>';
    });
    html += '<span style="color:var(--text-muted)">|</span>';
    [['week','This Week'],['month','This Month'],['all','All Time']].forEach(([k,label]) => {
      html += '<div class="filter-chip' + (Journal.filters.range === k ? ' active' : '') + '" onclick="Journal.setFilter(\'range\',\'' + k + '\')">' + label + '</div>';
    });
    html += '</div>';

    const allEntries = Store.getJournal();
    const allAccounts = Store.getAccounts();
    let filtered = allEntries.slice();

    if (Journal.filters.firm !== 'all') {
      const firmAccountIds = allAccounts.filter(a => a.firm === Journal.filters.firm).map(a => a.id);
      filtered = filtered.filter(e => firmAccountIds.includes(e.accountId));
    }

    if (Journal.filters.outcome === 'winners') filtered = filtered.filter(e => e.pnl > 0);
    if (Journal.filters.outcome === 'losers') filtered = filtered.filter(e => e.pnl < 0);

    const range = Rules.dateRange(Journal.filters.range);
    filtered = filtered.filter(e => e.date >= range.start && e.date <= range.end);

    filtered.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

    html += '<div class="panel" style="overflow:hidden">';

    html += '<div style="display:grid;grid-template-columns:80px 140px 90px 90px 90px 70px 70px 1fr 50px;padding:12px 16px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);border-bottom:1px solid var(--glass-border);background:var(--deep)">';
    html += '<div>Date</div><div>Account</div><div>P&L</div><div>Entry</div><div>Exit</div><div>In</div><div>Out</div><div>Notes</div><div></div>';
    html += '</div>';

    if (filtered.length === 0) {
      html += '<div style="padding:40px;text-align:center;color:var(--text-muted);font-size:13px">No trades match your filters</div>';
    }

    filtered.forEach(entry => {
      const acct = Store.getAccount(entry.accountId);
      const isExpanded = Journal.expandedId === entry.id;

      html += '<div class="journal-row" style="display:grid;grid-template-columns:80px 140px 90px 90px 90px 70px 70px 1fr 50px;padding:14px 16px;font-size:13px;border-bottom:1px solid var(--glass-border);align-items:center;cursor:pointer" onclick="Journal.toggleExpand(\'' + entry.id + '\')">';
      html += '<div>' + UI.formatDate(entry.date) + '</div>';
      html += '<div>' + (acct ? UI.firmBadgeHtml(acct.firm) + ' ' + UI.esc(acct.name) : 'Unknown') + '</div>';
      html += '<div style="font-weight:500;' + UI.pnlClass(entry.pnl) + '">' + UI.currencySign(entry.pnl) + (entry.tradedBy === 'bot' ? ' <span style="font-size:9px;padding:1px 4px;border-radius:3px;background:rgba(139,92,246,0.15);color:var(--violet);font-weight:500">BOT</span>' : '') + '</div>';
      html += '<div>' + UI.formatPrice(entry.entryPrice) + '</div>';
      html += '<div>' + UI.formatPrice(entry.exitPrice) + '</div>';
      html += '<div>' + UI.esc(entry.entryTime || '-') + '</div>';
      html += '<div>' + UI.esc(entry.exitTime || '-') + '</div>';
      html += '<div style="color:var(--text-secondary);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + UI.esc(entry.notes || '') + '</div>';
      html += '<div style="display:flex;gap:4px">';
      html += '<span style="cursor:pointer;padding:2px 4px;color:var(--text-muted);font-size:12px;transition:color 0.2s;opacity:0.5" onmouseenter="this.style.opacity=1;this.style.color=\'var(--gold)\'" onmouseleave="this.style.opacity=0.5;this.style.color=\'var(--text-muted)\'" onclick="event.stopPropagation();Journal.editEntry(\'' + entry.id + '\')">&#9998;</span>';
      html += '<span style="cursor:pointer;padding:2px 4px;color:var(--text-muted);font-size:12px;transition:color 0.2s;opacity:0.5" onmouseenter="this.style.opacity=1;this.style.color=\'var(--red)\'" onmouseleave="this.style.opacity=0.5;this.style.color=\'var(--text-muted)\'" onclick="event.stopPropagation();Journal.deleteEntry(\'' + entry.id + '\')">&#128465;</span>';
      html += '</div></div>';

      if (isExpanded && entry.notes) {
        html += '<div style="padding:0 16px 12px;animation:slideDown 0.25s cubic-bezier(0.4,0,0.2,1) both"><div style="padding:16px;background:var(--deep);border-radius:8px;font-size:13px;line-height:1.7;color:var(--text-secondary);border-left:2px solid var(--gold-dim)">' + UI.esc(entry.notes) + '</div></div>';
      }
    });

    const netPnl = filtered.reduce((s, e) => s + e.pnl, 0);
    const fWins = filtered.filter(e => e.pnl > 0);
    const fLosses = filtered.filter(e => e.pnl < 0);
    const fWinRate = filtered.length > 0 ? fWins.length / filtered.length : 0;
    const fAvgWin = fWins.length > 0 ? fWins.reduce((s, e) => s + e.pnl, 0) / fWins.length : 0;
    const fAvgLoss = fLosses.length > 0 ? fLosses.reduce((s, e) => s + e.pnl, 0) / fLosses.length : 0;
    const fGrossWin = fWins.reduce((s, e) => s + e.pnl, 0);
    const fGrossLoss = Math.abs(fLosses.reduce((s, e) => s + e.pnl, 0));
    const fPF = fGrossLoss > 0 ? fGrossWin / fGrossLoss : (fGrossWin > 0 ? Infinity : 0);

    html += '<div style="display:flex;gap:24px;padding:12px 16px;background:var(--deep);border-top:1px solid var(--glass-border);font-size:12px;color:var(--text-secondary);flex-wrap:wrap">';
    html += '<span>Showing <span style="color:var(--text);font-weight:500">' + filtered.length + '</span> trades</span>';
    html += '<span>Net P&L: <span style="color:' + UI.pnlColor(netPnl) + ';font-weight:500">' + UI.currencySign(netPnl) + '</span></span>';
    html += '<span>Win Rate: <span style="color:var(--text);font-weight:500">' + UI.pct(fWinRate * 100) + '</span></span>';
    html += '<span>Avg Win: <span style="color:var(--green);font-weight:500">' + UI.currencySign(fAvgWin) + '</span></span>';
    html += '<span>Avg Loss: <span style="color:var(--red);font-weight:500">' + UI.currency(fAvgLoss) + '</span></span>';
    html += '<span>Profit Factor: <span style="color:var(--text);font-weight:500">' + (fPF === Infinity ? '∞' : fPF.toFixed(2)) + '</span></span>';
    html += '</div>';

    html += '</div>';

    el.innerHTML = html;
  },

  parseNumber(str) {
    if (!str) return 0;
    return parseFloat(str.replace(/[,$\s+]/g, '')) || 0;
  },

  saveEntry() {
    const date = document.getElementById('j-date').value;
    const pnl = Journal.parseNumber(document.getElementById('j-pnl').value);
    const entryPrice = Journal.parseNumber(document.getElementById('j-entry-price').value);
    const exitPrice = Journal.parseNumber(document.getElementById('j-exit-price').value);
    const entryTime = document.getElementById('j-entry-time').value;
    const exitTime = document.getElementById('j-exit-time').value;
    const tradedBy = document.getElementById('j-traded-by').value;
    const notes = document.getElementById('j-notes').value.trim();

    if (Journal.editingId) {
      const accountId = document.getElementById('j-account').value;
      if (!accountId || !date) { alert('Account and date are required.'); return; }
      Store.saveEntry({ id: Journal.editingId, accountId, date, pnl, entryPrice, exitPrice, entryTime, exitTime, tradedBy, notes });
    } else {
      const checked = document.querySelectorAll('.j-account-cb:checked');
      const accountIds = Array.from(checked).map(cb => cb.value);
      if (accountIds.length === 0 || !date) { alert('Select at least one account and a date.'); return; }
      accountIds.forEach(accountId => {
        Store.saveEntry({ accountId, date, pnl, entryPrice, exitPrice, entryTime, exitTime, tradedBy, notes });
      });
    }
    Journal.editingId = null;
    Journal.render(document.getElementById('content'));
  },

  clearForm() {
    Journal.editingId = null;
    Journal.render(document.getElementById('content'));
  },

  cancelEdit() {
    Journal.editingId = null;
    Journal.render(document.getElementById('content'));
  },

  editEntry(id) {
    Journal.editingId = id;
    Journal.render(document.getElementById('content'));
    const entry = Store.getEntry(id);
    if (entry) {
      document.getElementById('j-account').value = entry.accountId;
      document.getElementById('j-date').value = entry.date;
      document.getElementById('j-pnl').value = entry.pnl;
      document.getElementById('j-entry-price').value = entry.entryPrice || '';
      document.getElementById('j-exit-price').value = entry.exitPrice || '';
      document.getElementById('j-entry-time').value = entry.entryTime || '';
      document.getElementById('j-exit-time').value = entry.exitTime || '';
      document.getElementById('j-traded-by').value = entry.tradedBy || 'manual';
      document.getElementById('j-notes').value = entry.notes || '';
    }
  },

  deleteEntry(id) {
    if (confirm('Delete this trade entry?')) {
      Store.deleteEntry(id);
      Journal.render(document.getElementById('content'));
    }
  },

  toggleExpand(id) {
    Journal.expandedId = Journal.expandedId === id ? null : id;
    Journal.render(document.getElementById('content'));
  },

  setFilter(key, value) {
    Journal.filters[key] = value;
    Journal.render(document.getElementById('content'));
  },
};
