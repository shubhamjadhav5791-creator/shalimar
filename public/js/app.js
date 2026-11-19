/**
 * Saffron & Ember — Unified SPA for Customer QR Ordering, Kitchen Display (KDS),
 * Billing Counter POS, Live 10-Table Floor Plan, and Printable QR Tent Cards.
 */
(function () {
  'use strict';

  const { CATEGORIES, MENU_ITEMS, formatMoney } = window.MENU_DATA;
  const Store = window.RestaurantStore;
  const Sound = window.SoundFX;
  const QR = window.QRCodeGen;

  const STATUS_LABELS = {
    available: 'Available',
    pending: 'Order Sent',
    preparing: 'Preparing',
    ready: 'Ready to Serve',
    served: 'Dining',
    bill_requested: 'Bill Requested'
  };

  // ---- App UI State ----
  const ui = {
    route: { view: 'hub', tableId: null },
    // Customer view state
    customerTab: 'menu', // 'menu' | 'orders'
    search: '',
    categoryFilter: 'All',
    vegOnly: false,
    bestsellerOnly: false,
    cart: {}, // { [itemId]: { item, qty, notes } }
    checkoutOpen: false,
    guestName: '',
    orderNote: '',
    submittingOrder: false,
    // Kitchen view state
    kdsShowServed: false,
    // Billing view state
    billingTab: 'active', // 'active' | 'history'
    selectedBillingTable: 1,
    discountPercent: 0,
    paymentMethod: 'UPI',
    settlingBill: false,
    // QR page state
    customBaseUrl: null,
    qrPreviewTableId: null
  };

  // ---- Utilities ----
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatElapsed(isoStr) {
    if (!isoStr) return '00:00';
    const diffSec = Math.max(0, Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000));
    const mins = Math.floor(diffSec / 60);
    const secs = diffSec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function elapsedMinutes(isoStr) {
    if (!isoStr) return 0;
    return Math.max(0, (Date.now() - new Date(isoStr).getTime()) / 60000);
  }

  function formatTime(isoStr) {
    if (!isoStr) return '';
    return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function showToast(message, variant = 'default') {
    const stack = document.getElementById('toast-stack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = `toast ${variant === 'accent' ? 'toast-accent' : variant === 'success' ? 'toast-success' : ''}`;
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-6px)';
      el.style.transition = 'all 0.2s ease';
      setTimeout(() => el.remove(), 220);
    }, 3400);
  }

  // ---- Routing ----
  function parseRoute() {
    const path = (window.location.hash ? window.location.hash.replace(/^#/, '') : window.location.pathname) || '/';
    const clean = path.replace(/\/+$/, '') || '/';
    const tableMatch = clean.match(/^\/table\/(\d+)$/);
    if (tableMatch) {
      const id = Number(tableMatch[1]);
      if (id >= 1 && id <= 10) return { view: 'table', tableId: id };
    }
    if (clean === '/kitchen') return { view: 'kitchen', tableId: null };
    if (clean === '/billing') return { view: 'billing', tableId: null };
    if (clean === '/qr-codes') return { view: 'qr', tableId: null };
    return { view: 'hub', tableId: null };
  }

  function navigate(path) {
    if (window.location.protocol.startsWith('http')) {
      window.history.pushState({}, '', path);
    } else {
      window.location.hash = `#${path}`;
    }
    ui.route = parseRoute();
    ui.checkoutOpen = false;
    ui.qrPreviewTableId = null;
    if (ui.route.view === 'table') {
      ui.customerTab = 'menu';
      ui.cart = {};
      ui.orderNote = '';
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    render();
  }

  window.addEventListener('popstate', () => {
    ui.route = parseRoute();
    render();
  });
  window.addEventListener('hashchange', () => {
    ui.route = parseRoute();
    render();
  });

  function getQrBaseUrl() {
    if (ui.customBaseUrl !== null) return ui.customBaseUrl.replace(/\/+$/, '');
    const info = Store.getServerInfo();
    return (info && info.lanBaseUrl) ? info.lanBaseUrl.replace(/\/+$/, '') : window.location.origin;
  }

  function tableUrl(tableId) {
    return `${getQrBaseUrl()}/table/${tableId}`;
  }

  // ---- Focus Preservation Helper ----
  function renderWithFocusPreserved(renderFn) {
    const active = document.activeElement;
    const focusId = active && active.getAttribute ? active.getAttribute('data-focus-id') : null;
    const selStart = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
    const selEnd = active && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;

    renderFn();

    if (focusId) {
      const nextEl = document.querySelector(`[data-focus-id="${focusId}"]`);
      if (nextEl) {
        nextEl.focus();
        if (selStart !== null && typeof nextEl.setSelectionRange === 'function') {
          try { nextEl.setSelectionRange(selStart, selEnd); } catch (_) {}
        }
      }
    }
  }

  // ---- Shared Top Navigation Bar (Staff views) ----
  function renderTopBar(state) {
    const kdsCount = state.orders.filter((o) => !o.billed && ['pending', 'preparing'].includes(o.status)).length;
    const billReqCount = state.tables.filter((t) => {
      if (!t.billRequested) return false;
      return Store.getTableActiveOrders(state, t.id).length > 0;
    }).length;
    const conn = Store.getConnectionStatus();
    const connLabel = conn === 'live' ? 'Live Sync' : conn === 'local' ? 'Local Sync' : 'Reconnecting…';

    return `
      <header class="topbar no-print">
        <div class="topbar-inner">
          <a href="/" data-nav="/" class="brand">
            <div class="brand-mark">S</div>
            <div>
              <div class="brand-title">Saffron &amp; Ember</div>
              <div class="brand-sub">10-Table QR Ordering &amp; POS</div>
            </div>
          </a>

          <nav class="nav-links" aria-label="Main navigation">
            <a href="/" data-nav="/" class="nav-pill ${ui.route.view === 'hub' ? 'active' : ''}">Floor Plan</a>
            <a href="/kitchen" data-nav="/kitchen" class="nav-pill ${ui.route.view === 'kitchen' ? 'active' : ''}">
              Kitchen Display
              ${kdsCount > 0 ? `<span class="nav-badge tabular">${kdsCount}</span>` : ''}
            </a>
            <a href="/billing" data-nav="/billing" class="nav-pill ${ui.route.view === 'billing' ? 'active' : ''}">
              Billing Counter
              ${billReqCount > 0 ? `<span class="nav-badge tabular">${billReqCount}</span>` : ''}
            </a>
            <a href="/qr-codes" data-nav="/qr-codes" class="nav-pill ${ui.route.view === 'qr' ? 'active' : ''}">Table QR Codes</a>
          </nav>

          <div class="topbar-right">
            <span class="live-indicator ${conn}">
              <span class="live-dot"></span>
              ${connLabel}
            </span>
          </div>
        </div>
      </header>
    `;
  }

  // =========================================================================
  // VIEW 1: Floor Plan & Restaurant Hub (/)
  // =========================================================================
  function renderHubView(state) {
    const summaries = state.tables.map((t) => Store.getTableSummary(state, t.id));
    const occupied = summaries.filter((s) => s.activeOrders.length > 0).length;
    const kitchenActive = state.orders.filter((o) => !o.billed && ['pending', 'preparing'].includes(o.status)).length;
    const openRevenue = summaries.reduce((acc, s) => acc + s.grandTotal, 0);
    const collectedRevenue = state.bills.reduce((acc, b) => acc + Number(b.grandTotal || 0), 0);

    return `
      ${renderTopBar(state)}
      <main class="container">
        <section class="hero-banner">
          <img src="/images/hero-table.jpg" alt="Saffron and Ember artisanal restaurant table spread" />
          <div class="hero-content">
            <div class="hero-eyebrow">Live QR Table Service • 10 Tables Connected</div>
            <h1 class="hero-title">Scan at the table. Straight to the kitchen &amp; billing counter.</h1>
            <p class="hero-desc">
              Every table has its own unique QR menu. When guests place an order from their phone, tickets appear instantly on the Kitchen Display and consolidate onto the Billing Counter POS.
            </p>
            <div class="hero-actions">
              <a href="/qr-codes" data-nav="/qr-codes" class="btn btn-primary">View &amp; Print 10 QR Codes</a>
              <a href="/kitchen" data-nav="/kitchen" class="btn btn-outline">Open Kitchen Screen</a>
              <a href="/billing" data-nav="/billing" class="btn btn-outline">Open Billing Counter</a>
              <button type="button" class="btn btn-outline" data-action="seed-demo">Load Sample Orders</button>
            </div>
          </div>
        </section>

        <section class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Active Tables</div>
            <div class="kpi-value tabular">${occupied} / 10</div>
            <div class="kpi-sub">${10 - occupied} tables available</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Kitchen Queue</div>
            <div class="kpi-value tabular">${kitchenActive}</div>
            <div class="kpi-sub">Orders pending or cooking</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Open Table Tabs</div>
            <div class="kpi-value tabular">${formatMoney(openRevenue)}</div>
            <div class="kpi-sub">Running total incl. ${state.taxRate}% GST</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Today's Settled Sales</div>
            <div class="kpi-value tabular">${formatMoney(collectedRevenue)}</div>
            <div class="kpi-sub">${state.bills.length} invoice${state.bills.length === 1 ? '' : 's'} paid</div>
          </div>
        </section>

        <div class="section-header">
          <div>
            <h2 class="section-title">Live 10-Table Floor Plan</h2>
            <p class="section-subtitle">Click any table to preview its customer QR menu, view its QR code, or open its bill.</p>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" class="btn btn-outline btn-sm" data-action="seed-demo">+ Demo Orders</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="reset-all">Reset All Tables</button>
          </div>
        </div>

        <section class="tables-grid">
          ${summaries.map((s) => {
            const t = s.table;
            return `
              <article class="table-card status-${s.displayStatus}">
                <div class="table-card-top">
                  <div>
                    <div class="table-num">${esc(t.name)}</div>
                    <div class="table-meta">${esc(t.zone)} • ${t.seats} seats</div>
                  </div>
                  <span class="status-pill ${s.displayStatus}">${STATUS_LABELS[s.displayStatus]}</span>
                </div>

                <div class="table-stats">
                  <div>
                    <div class="table-total tabular">${s.activeOrders.length > 0 ? formatMoney(s.grandTotal) : '—'}</div>
                    <div class="table-items-count">${s.activeOrders.length > 0 ? `${s.activeOrders.length} order${s.activeOrders.length > 1 ? 's' : ''} • ${s.itemCount} items` : 'No active order'}</div>
                  </div>
                  <button type="button" class="btn btn-ghost btn-sm" title="Show Table ${t.id} QR Code" data-action="open-qr-modal" data-table="${t.id}">QR ↗</button>
                </div>

                <div class="table-card-actions">
                  <a href="/table/${t.id}" data-nav="/table/${t.id}" class="btn btn-dark">Order Menu</a>
                  <button type="button" class="btn btn-outline" data-action="goto-bill" data-table="${t.id}">Bill</button>
                </div>
              </article>
            `;
          }).join('')}
        </section>

        <section class="workflow-strip">
          <div class="workflow-step">
            <div class="workflow-num">1</div>
            <div>
              <h4>Guest Scans Table QR (Tables 1–10)</h4>
              <p>Each table's QR code opens its dedicated mobile menu at <code>/table/1</code> through <code>/table/10</code> — no app download required.</p>
            </div>
          </div>
          <div class="workflow-step">
            <div class="workflow-num">2</div>
            <div>
              <h4>Instant Kitchen Display Ticket</h4>
              <p>Orders route straight to <strong>/kitchen</strong> with table badges, cooking notes, batch prep counts, and live timers.</p>
            </div>
          </div>
          <div class="workflow-step">
            <div class="workflow-num">3</div>
            <div>
              <h4>Automatic Billing Counter Sync</h4>
              <p>Every round consolidates automatically on <strong>/billing</strong>. Print thermal receipts, collect payment, and clear the table in one click.</p>
            </div>
          </div>
        </section>
      </main>
      ${ui.qrPreviewTableId ? renderQuickQrModal(ui.qrPreviewTableId) : ''}
    `;
  }

  function renderQuickQrModal(tableId) {
    const url = tableUrl(tableId);
    const svg = QR.toSVG(url, { margin: 3 });
    return `
      <div class="modal-backdrop" data-backdrop-close="qr">
        <div class="modal-card" style="max-width:380px; text-align:center;">
          <div class="modal-header">
            <h3>Table ${tableId} QR Code</h3>
            <button type="button" class="icon-close" data-action="close-qr-modal" aria-label="Close">×</button>
          </div>
          <p style="margin:0 0 16px; font-size:13.5px; color:var(--ink-secondary);">
            Scan with any smartphone camera on the same Wi-Fi to open Table ${tableId}'s ordering menu.
          </p>
          <div class="qr-frame" style="margin:0 auto 14px; width:220px; height:220px;">${svg}</div>
          <div class="qr-url-caption" style="margin-bottom:18px;">${esc(url)}</div>
          <div style="display:flex; gap:10px;">
            <a href="/table/${tableId}" data-nav="/table/${tableId}" class="btn btn-primary" style="flex:1;">Open Table ${tableId} Menu</a>
            <button type="button" class="btn btn-outline" data-action="close-qr-modal">Close</button>
          </div>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // VIEW 2: Customer QR Table Ordering (/table/:id)
  // =========================================================================
  function getCartTotals() {
    const entries = Object.values(ui.cart).filter((e) => e.qty > 0);
    const count = entries.reduce((s, e) => s + e.qty, 0);
    const subtotal = entries.reduce((s, e) => s + e.item.price * e.qty, 0);
    return { entries, count, subtotal };
  }

  function renderCustomerView(state, tableId) {
    const summary = Store.getTableSummary(state, tableId);
    const table = summary.table;
    const { entries, count, subtotal } = getCartTotals();
    const activeOrdersCount = summary.activeOrders.length;

    const query = ui.search.trim().toLowerCase();
    const filteredItems = MENU_ITEMS.filter((item) => {
      if (ui.categoryFilter !== 'All' && item.category !== ui.categoryFilter) return false;
      if (ui.vegOnly && !item.veg) return false;
      if (ui.bestsellerOnly && !item.bestseller) return false;
      if (query) {
        const hay = `${item.name} ${item.description} ${item.category}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    const visibleCategories = CATEGORIES.filter((cat) =>
      filteredItems.some((item) => item.category === cat.id)
    );

    return `
      <div class="customer-shell">
        <header class="customer-header">
          <div class="customer-header-row">
            <div class="brand">
              <div class="brand-mark">S</div>
              <div>
                <div class="brand-title">Saffron &amp; Ember</div>
                <div class="brand-sub">${esc(table.zone)} • ${table.seats}-Seater</div>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="table-badge-lg">Table ${table.id}</span>
            </div>
          </div>

          <div class="customer-tabs">
            <button type="button" class="customer-tab ${ui.customerTab === 'menu' ? 'active' : ''}" data-action="set-customer-tab" data-tab="menu">
              Browse Menu
            </button>
            <button type="button" class="customer-tab ${ui.customerTab === 'orders' ? 'active' : ''}" data-action="set-customer-tab" data-tab="orders">
              My Orders &amp; Bill
              ${activeOrdersCount > 0 ? `<span class="nav-badge tabular">${activeOrdersCount}</span>` : ''}
            </button>
          </div>
        </header>

        ${ui.customerTab === 'menu' ? `
          <section class="customer-hero">
            <img src="/images/hero-table.jpg" alt="Saffron and Ember kitchen spread" />
            <div class="customer-hero-text">
              <h1>Welcome to Table ${table.id}</h1>
              <p>Order directly from your table — prepared fresh in our wood-fired kitchen.</p>
            </div>
          </section>

          <section class="menu-controls">
            <div class="search-box">
              <span class="search-icon">🔍</span>
              <input
                type="search"
                placeholder="Search dishes, paneer, naan, biryani..."
                value="${esc(ui.search)}"
                data-input="menu-search"
                data-focus-id="menu-search"
              />
            </div>

            <div class="filter-row">
              <button type="button" class="chip veg-chip ${ui.vegOnly ? 'active' : ''}" data-action="toggle-veg">
                ● Pure Veg
              </button>
              <button type="button" class="chip ${ui.bestsellerOnly ? 'active' : ''}" data-action="toggle-bestseller">
                ★ Chef's Specials
              </button>
              <button type="button" class="chip ${ui.categoryFilter === 'All' ? 'active' : ''}" data-action="set-category" data-cat="All">
                All Categories
              </button>
              ${CATEGORIES.map((c) => `
                <button type="button" class="chip ${ui.categoryFilter === c.id ? 'active' : ''}" data-action="set-category" data-cat="${esc(c.id)}">
                  ${esc(c.id)}
                </button>
              `).join('')}
            </div>
          </section>

          ${visibleCategories.length === 0 ? `
            <div style="text-align:center; padding:48px 20px; color:var(--ink-secondary);">
              <p style="font-size:16px; font-weight:600; margin:0 0 8px;">No dishes match your filter</p>
              <button type="button" class="btn btn-outline btn-sm" data-action="clear-menu-filters">Clear Filters</button>
            </div>
          ` : visibleCategories.map((cat) => {
            const items = filteredItems.filter((i) => i.category === cat.id);
            return `
              <section class="category-section">
                <div class="category-banner">
                  <img class="category-thumb" src="${cat.image}" alt="${esc(cat.label)}" />
                  <div>
                    <h2>${esc(cat.label)}</h2>
                    <p>${esc(cat.subtitle)}</p>
                  </div>
                </div>

                <div class="dish-list">
                  ${items.map((item) => {
                    const cartEntry = ui.cart[item.id];
                    const qty = cartEntry ? cartEntry.qty : 0;
                    const spiceText = item.spicy === 2 ? '🌶🌶 Spicy' : item.spicy === 1 ? '🌶 Mild' : '';
                    return `
                      <div class="dish-card ${qty > 0 ? 'in-cart' : ''}">
                        <div class="dish-info">
                          <div class="dish-badges">
                            <span class="diet-mark ${item.veg ? '' : 'nonveg'}" title="${item.veg ? 'Vegetarian' : 'Non-Vegetarian'}"></span>
                            ${item.bestseller ? '<span class="tag-bestseller">Bestseller</span>' : ''}
                            ${spiceText ? `<span class="tag-prep">${spiceText}</span>` : ''}
                            <span class="tag-prep">• ${item.prepMins} min</span>
                          </div>
                          <h3 class="dish-name">${esc(item.name)}</h3>
                          <p class="dish-desc">${esc(item.description)}</p>
                          <div class="dish-price tabular">${formatMoney(item.price)}</div>
                          ${qty > 0 ? `
                            <input
                              type="text"
                              class="item-note-input"
                              placeholder="Add cooking note (e.g. less spicy, no onions)..."
                              value="${esc(cartEntry.notes || '')}"
                              data-input="item-note"
                              data-item-id="${item.id}"
                              data-focus-id="item-note-${item.id}"
                            />
                          ` : ''}
                        </div>
                        <div class="dish-action">
                          ${qty === 0 ? `
                            <button type="button" class="add-btn" data-action="cart-add" data-item-id="${item.id}">+ Add</button>
                          ` : `
                            <div class="qty-stepper">
                              <button type="button" data-action="cart-dec" data-item-id="${item.id}" aria-label="Decrease quantity">−</button>
                              <span class="tabular">${qty}</span>
                              <button type="button" data-action="cart-inc" data-item-id="${item.id}" aria-label="Increase quantity">+</button>
                            </div>
                          `}
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              </section>
            `;
          }).join('')}

          <footer style="text-align:center; padding:24px 18px 8px; font-size:12.5px; color:var(--ink-muted);">
            Saffron &amp; Ember • Table ${table.id} QR Ordering •
            <a href="/" data-nav="/" style="text-decoration:underline;">Staff Floor Plan</a>
          </footer>
        ` : renderCustomerOrdersTab(state, summary)}

        ${count > 0 && ui.customerTab === 'menu' ? `
          <div class="cart-bar-wrap">
            <div class="cart-bar" data-action="open-checkout" role="button" tabindex="0">
              <div class="cart-bar-left">
                <span class="cart-count-pill tabular">${count} ${count === 1 ? 'item' : 'items'}</span>
                <div>
                  <div style="font-weight:700; font-size:15.5px;" class="tabular">${formatMoney(subtotal)}</div>
                  <div style="font-size:11.5px; color:rgba(255,255,255,0.7);">Plus ${state.taxRate}% GST • Table ${table.id}</div>
                </div>
              </div>
              <div class="cart-bar-cta">Review &amp; Order →</div>
            </div>
          </div>
        ` : ''}

        ${ui.checkoutOpen ? renderCheckoutModal(state, tableId, entries, subtotal) : ''}
      </div>
    `;
  }

  function renderCustomerOrdersTab(state, summary) {
    const table = summary.table;
    const orders = summary.activeOrders;

    if (orders.length === 0) {
      return `
        <div class="tracker-wrap">
          <div class="order-track-card" style="text-align:center; padding:44px 20px;">
            <h2 style="font-family:var(--font-display); margin:0 0 8px;">No orders placed yet</h2>
            <p style="margin:0 0 20px; color:var(--ink-secondary); font-size:14px;">
              Browse our menu and send your order directly to the kitchen from Table ${table.id}.
            </p>
            <button type="button" class="btn btn-primary" data-action="set-customer-tab" data-tab="menu">
              Explore Menu
            </button>
          </div>
        </div>
      `;
    }

    const stages = [
      { key: 'pending', label: 'Sent to Kitchen' },
      { key: 'preparing', label: 'Cooking' },
      { key: 'ready', label: 'Ready' },
      { key: 'served', label: 'Served' }
    ];
    const stageIdxMap = { pending: 0, preparing: 1, ready: 2, served: 3 };

    return `
      <div class="tracker-wrap">
        <div class="bill-request-box">
          <div>
            <div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--accent);">
              Table ${table.id} Running Total
            </div>
            <div style="font-family:var(--font-display); font-size:28px; font-weight:700;" class="tabular">
              ${formatMoney(summary.grandTotal)}
            </div>
            <div style="font-size:12.5px; color:var(--ink-secondary);">
              Subtotal ${formatMoney(summary.subtotal)} + ${summary.taxRate}% GST (${formatMoney(summary.taxAmount)})
            </div>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" class="btn btn-outline btn-sm" data-action="set-customer-tab" data-tab="menu">
              + Add More Items
            </button>
            ${table.billRequested ? `
              <button type="button" class="btn btn-success btn-sm" disabled>
                ✓ Bill Requested — Staff Notified
              </button>
            ` : `
              <button type="button" class="btn btn-primary btn-sm" data-action="request-bill" data-table="${table.id}">
                Request Bill at Table
              </button>
            `}
          </div>
        </div>

        ${orders.map((ord) => {
          const curIdx = stageIdxMap[ord.status] ?? 0;
          return `
            <article class="order-track-card">
              <div class="order-track-top">
                <div>
                  <strong style="font-size:15.5px;">Order #${ord.orderNumber}</strong>
                  <span style="font-size:12.5px; color:var(--ink-muted); margin-left:8px;">Placed at ${formatTime(ord.createdAt)}</span>
                </div>
                <span class="status-pill ${ord.status}">${STATUS_LABELS[ord.status] || ord.status}</span>
              </div>

              <div class="progress-steps">
                ${stages.map((st, idx) => {
                  const cls = idx < curIdx ? 'done' : idx === curIdx ? 'current' : '';
                  return `
                    <div class="progress-step ${cls}">
                      <div class="progress-bar"></div>
                      <div class="progress-label">${st.label}</div>
                    </div>
                  `;
                }).join('')}
              </div>

              <div class="track-items-list">
                ${ord.items.map((it) => `
                  <div class="track-item-row">
                    <div>
                      <strong>${it.qty}×</strong> ${esc(it.name)}
                      ${it.notes ? `<div style="font-size:12px; color:var(--accent);">Note: ${esc(it.notes)}</div>` : ''}
                    </div>
                    <span class="tabular">${formatMoney(it.price * it.qty)}</span>
                  </div>
                `).join('')}
                ${ord.orderNote ? `
                  <div style="margin-top:6px; padding:8px 10px; border-radius:8px; background:var(--bg); font-size:12.5px; color:var(--ink-secondary);">
                    <strong>Kitchen Note:</strong> ${esc(ord.orderNote)}
                  </div>
                ` : ''}
              </div>
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderCheckoutModal(state, tableId, entries, subtotal) {
    const tax = Math.round(subtotal * (state.taxRate / 100) * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;

    return `
      <div class="modal-backdrop" data-backdrop-close="checkout">
        <div class="modal-card">
          <div class="modal-header">
            <h3>Confirm Order • Table ${tableId}</h3>
            <button type="button" class="icon-close" data-action="close-checkout" aria-label="Close">×</button>
          </div>

          <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:16px;">
            ${entries.map(({ item, qty, notes }) => `
              <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding-bottom:10px; border-bottom:1px dashed var(--border);">
                <div style="flex:1;">
                  <div style="font-weight:600; font-size:14.5px;">${esc(item.name)}</div>
                  ${notes ? `<div style="font-size:12px; color:var(--accent);">Note: ${esc(notes)}</div>` : ''}
                  <div style="font-size:12.5px; color:var(--ink-muted);" class="tabular">${formatMoney(item.price)} each</div>
                </div>
                <div class="qty-stepper" style="transform:scale(0.9);">
                  <button type="button" data-action="cart-dec" data-item-id="${item.id}">−</button>
                  <span class="tabular">${qty}</span>
                  <button type="button" data-action="cart-inc" data-item-id="${item.id}">+</button>
                </div>
                <div style="min-width:64px; text-align:right; font-weight:700;" class="tabular">
                  ${formatMoney(item.price * qty)}
                </div>
              </div>
            `).join('')}
          </div>

          <div class="form-field">
            <label for="guest-name-inp">Your Name (optional)</label>
            <input
              id="guest-name-inp"
              type="text"
              placeholder="e.g. Priya"
              value="${esc(ui.guestName)}"
              data-input="guest-name"
              data-focus-id="guest-name"
            />
          </div>

          <div class="form-field">
            <label for="order-note-inp">Special Instructions for Kitchen (optional)</label>
            <textarea
              id="order-note-inp"
              rows="2"
              placeholder="Allergies, serve starters first, extra chutney..."
              data-input="order-note"
              data-focus-id="order-note"
            >${esc(ui.orderNote)}</textarea>
          </div>

          <div class="invoice-totals">
            <div class="invoice-total-row">
              <span>Items Subtotal</span>
              <span class="tabular">${formatMoney(subtotal)}</span>
            </div>
            <div class="invoice-total-row">
              <span>GST (${state.taxRate}%)</span>
              <span class="tabular">${formatMoney(tax)}</span>
            </div>
            <div class="invoice-total-row grand">
              <span>Estimated Total</span>
              <span class="tabular">${formatMoney(total)}</span>
            </div>
          </div>

          <button
            type="button"
            class="btn btn-primary btn-lg"
            style="width:100%;"
            data-action="submit-order"
            data-table="${tableId}"
            ${ui.submittingOrder ? 'disabled' : ''}
          >
            ${ui.submittingOrder ? 'Sending to Kitchen…' : `Place Order to Kitchen • ${formatMoney(total)}`}
          </button>
          <p style="text-align:center; margin:10px 0 0; font-size:12px; color:var(--ink-muted);">
            Your order goes directly to our kitchen &amp; adds to Table ${tableId}'s bill.
          </p>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // VIEW 3: Kitchen Display System (/kitchen)
  // =========================================================================
  function renderKitchenView(state) {
    const activeOrders = state.orders.filter((o) => !o.billed && o.status !== 'cancelled');
    const pending = activeOrders.filter((o) => o.status === 'pending').sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const preparing = activeOrders.filter((o) => o.status === 'preparing').sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const ready = activeOrders.filter((o) => o.status === 'ready').sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const served = state.orders.filter((o) => o.status === 'served').slice(0, 12);

    // Aggregate batch prep counts for pending + preparing orders
    const prepCounts = new Map();
    [...pending, ...preparing].forEach((ord) => {
      ord.items.forEach((it) => {
        prepCounts.set(it.name, (prepCounts.get(it.name) || 0) + it.qty);
      });
    });
    const prepList = Array.from(prepCounts.entries()).sort((a, b) => b[1] - a[1]);

    return `
      ${renderTopBar(state)}
      <main class="kds-wrap">
        <div class="kds-toolbar">
          <div class="kds-title-group">
            <h1>Kitchen Display System (KDS)</h1>
            <p>Incoming orders from Tables 1–10 appear here automatically in real time.</p>
          </div>
          <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
            <button type="button" class="btn btn-outline btn-sm" data-action="toggle-mute">
              ${Sound.isMuted() ? '🔇 Sound Muted' : '🔔 Order Chime On'}
            </button>
            <button type="button" class="btn btn-outline btn-sm" data-action="toggle-kds-served">
              ${ui.kdsShowServed ? 'Hide Served History' : `Recently Served (${served.length})`}
            </button>
            <button type="button" class="btn btn-outline btn-sm" data-action="seed-demo">
              + Test Orders
            </button>
          </div>
        </div>

        <section class="kds-prep-bar">
          <span class="kds-prep-label">Active Prep Totals:</span>
          ${prepList.length === 0 ? `
            <span style="font-size:13px; color:var(--kds-muted);">All caught up — no dishes currently queued.</span>
          ` : prepList.map(([name, qty]) => `
            <span class="prep-chip">
              <strong>${qty}×</strong> ${esc(name)}
            </span>
          `).join('')}
        </section>

        <section class="kds-board">
          ${renderKdsColumn('New Orders', 'pending', pending)}
          ${renderKdsColumn('Preparing', 'preparing', preparing)}
          ${renderKdsColumn('Ready to Serve', 'ready', ready)}
        </section>

        ${ui.kdsShowServed ? `
          <section style="margin-top:26px; background:var(--kds-surface); border:1px solid var(--kds-border); border-radius:var(--radius-lg); padding:18px;">
            <h3 style="margin:0 0 12px; font-size:16px;">Recently Served Tickets</h3>
            ${served.length === 0 ? `<p style="color:var(--kds-muted); margin:0;">No served tickets yet.</p>` : `
              <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:12px;">
                ${served.map((o) => `
                  <div style="background:var(--kds-surface-2); border:1px solid var(--kds-border); border-radius:10px; padding:12px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                      <strong>Table ${o.tableId} • #${o.orderNumber}</strong>
                      <span style="font-size:12px; color:var(--kds-muted);">${formatTime(o.servedAt || o.updatedAt)}</span>
                    </div>
                    <div style="font-size:13px; color:var(--kds-muted);">
                      ${o.items.map((i) => `${i.qty}× ${esc(i.name)}`).join(', ')}
                    </div>
                  </div>
                `).join('')}
              </div>
            `}
          </section>
        ` : ''}
      </main>
    `;
  }

  function renderKdsColumn(title, statusKey, orders) {
    return `
      <div class="kds-col">
        <div class="kds-col-header">
          <div class="kds-col-title">
            <span class="kds-col-dot ${statusKey}"></span>
            ${title}
          </div>
          <span class="kds-count">${orders.length}</span>
        </div>
        <div class="kds-tickets">
          ${orders.length === 0 ? `
            <div class="kds-empty">No ${title.toLowerCase()} right now</div>
          ` : orders.map((ord) => {
            const urgent = elapsedMinutes(ord.createdAt) >= 12 && statusKey !== 'ready';
            const nextAction =
              statusKey === 'pending'
                ? { label: 'Start Preparing →', next: 'preparing', cls: 'btn-primary' }
                : statusKey === 'preparing'
                ? { label: 'Mark Ready ✓', next: 'ready', cls: 'btn-success' }
                : { label: 'Mark Served', next: 'served', cls: 'btn-outline' };

            return `
              <article class="kds-ticket status-${statusKey}">
                <div class="kds-ticket-head">
                  <div>
                    <div class="kds-table-badge">TABLE ${ord.tableId}</div>
                    <div class="kds-order-id">#${ord.orderNumber}${ord.guestName ? ` • ${esc(ord.guestName)}` : ''} • ${formatTime(ord.createdAt)}</div>
                  </div>
                  <span class="kds-timer ${urgent ? 'urgent' : ''}" data-timer-since="${esc(ord.createdAt)}">
                    ${formatElapsed(ord.createdAt)}
                  </span>
                </div>

                <div class="kds-ticket-body">
                  ${ord.items.map((it) => `
                    <div class="kds-item">
                      <span class="kds-qty">${it.qty}×</span>
                      <div style="flex:1;">
                        <div class="kds-item-name">
                          <span class="diet-mark ${it.veg ? '' : 'nonveg'}" style="display:inline-grid; vertical-align:middle; margin-right:6px;"></span>
                          ${esc(it.name)}
                        </div>
                        ${it.notes ? `<div class="kds-item-note">⚑ ${esc(it.notes)}</div>` : ''}
                      </div>
                    </div>
                  `).join('')}

                  ${ord.orderNote ? `
                    <div class="kds-order-note">
                      KITCHEN NOTE: ${esc(ord.orderNote)}
                    </div>
                  ` : ''}
                </div>

                <div class="kds-ticket-foot">
                  <button type="button" class="btn ${nextAction.cls}" data-action="kds-status" data-order-id="${ord.id}" data-status="${nextAction.next}">
                    ${nextAction.label}
                  </button>
                  ${statusKey === 'pending' ? `
                    <button type="button" class="btn btn-outline btn-sm" style="flex:0;" title="Cancel ticket" data-action="kds-status" data-order-id="${ord.id}" data-status="cancelled">✕</button>
                  ` : ''}
                </div>
              </article>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // =========================================================================
  // VIEW 4: Billing Counter / Cashier POS (/billing)
  // =========================================================================
  function renderBillingView(state) {
    const summaries = state.tables.map((t) => Store.getTableSummary(state, t.id));
    const occupiedCount = summaries.filter((s) => s.activeOrders.length > 0).length;
    const pendingRevenue = summaries.reduce((acc, s) => acc + s.grandTotal, 0);
    const collectedRevenue = state.bills.reduce((acc, b) => acc + Number(b.grandTotal || 0), 0);
    const avgTicket = state.bills.length > 0 ? collectedRevenue / state.bills.length : 0;

    const selectedSummary = Store.getTableSummary(state, ui.selectedBillingTable, ui.discountPercent);
    const recentOrders = state.orders.filter((o) => o.status !== 'cancelled').slice(0, 15);

    return `
      ${renderTopBar(state)}
      <main class="container">
        <div class="section-header">
          <div>
            <h1 class="section-title">Billing Counter &amp; Cashier POS</h1>
            <p class="section-subtitle">Orders from all 10 tables stream in live and consolidate by table for instant billing.</p>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" class="btn btn-outline btn-sm" data-action="toggle-mute">
              ${Sound.isMuted() ? '🔇 Sound Muted' : '🔔 Bill Alert On'}
            </button>
            <button type="button" class="btn ${ui.billingTab === 'active' ? 'btn-dark' : 'btn-outline'} btn-sm" data-action="set-billing-tab" data-tab="active">
              Live Tables (${occupiedCount})
            </button>
            <button type="button" class="btn ${ui.billingTab === 'history' ? 'btn-dark' : 'btn-outline'} btn-sm" data-action="set-billing-tab" data-tab="history">
              Paid Invoices (${state.bills.length})
            </button>
          </div>
        </div>

        <section class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Occupied Tables</div>
            <div class="kpi-value tabular">${occupiedCount} / 10</div>
            <div class="kpi-sub">${summaries.filter((s) => s.displayStatus === 'bill_requested').length} requesting bill</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Unsettled Tabs</div>
            <div class="kpi-value tabular">${formatMoney(pendingRevenue)}</div>
            <div class="kpi-sub">Active across dining floor</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Collected Today</div>
            <div class="kpi-value tabular">${formatMoney(collectedRevenue)}</div>
            <div class="kpi-sub">${state.bills.length} settled bills</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Average Check</div>
            <div class="kpi-value tabular">${state.bills.length > 0 ? formatMoney(avgTicket) : '—'}</div>
            <div class="kpi-sub">Per settled table</div>
          </div>
        </section>

        ${ui.billingTab === 'active' ? `
          <section class="billing-layout">
            <div>
              <div class="billing-tables-grid">
                ${summaries.map((s) => {
                  const isSel = s.table.id === ui.selectedBillingTable;
                  const billReq = s.displayStatus === 'bill_requested';
                  return `
                    <button
                      type="button"
                      class="pos-table-btn ${isSel ? 'selected' : ''} ${billReq ? 'has-bill-req' : ''}"
                      data-action="select-billing-table"
                      data-table="${s.table.id}"
                    >
                      <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                        <strong style="font-size:16px;">${esc(s.table.name)}</strong>
                        <span class="status-pill ${s.displayStatus}">${STATUS_LABELS[s.displayStatus]}</span>
                      </div>
                      <div style="display:flex; justify-content:space-between; align-items:baseline; width:100%;">
                        <span style="font-size:12.5px; color:var(--ink-muted);">
                          ${s.activeOrders.length > 0 ? `${s.activeOrders.length} round${s.activeOrders.length > 1 ? 's' : ''} • ${s.itemCount} items` : `${s.table.zone} • Empty`}
                        </span>
                        <strong style="font-size:16px;" class="tabular">
                          ${s.activeOrders.length > 0 ? formatMoney(s.grandTotal) : '—'}
                        </strong>
                      </div>
                    </button>
                  `;
                }).join('')}
              </div>

              <div class="live-feed-card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                  <h3 style="margin:0; font-family:var(--font-display); font-size:18px;">Live Incoming Order Feed</h3>
                  <span style="font-size:12px; color:var(--ink-muted);">Auto-updates in real time</span>
                </div>
                ${recentOrders.length === 0 ? `
                  <p style="margin:0; font-size:13.5px; color:var(--ink-muted);">Orders placed from table QR codes will stream here instantly.</p>
                ` : `
                  <div class="feed-list">
                    ${recentOrders.map((ord) => `
                      <div class="feed-row">
                        <div>
                          <strong>Table ${ord.tableId}</strong>
                          <span style="color:var(--ink-muted);">• #${ord.orderNumber} • ${formatTime(ord.createdAt)}</span>
                          <div style="font-size:12px; color:var(--ink-secondary);">
                            ${ord.items.map((i) => `${i.qty}× ${esc(i.name)}`).join(', ')}
                          </div>
                        </div>
                        <div style="text-align:right; flex-shrink:0;">
                          <div style="font-weight:700;" class="tabular">${formatMoney(ord.subtotal)}</div>
                          <span class="status-pill ${ord.billed ? 'served' : ord.status}" style="font-size:10px; padding:2px 7px;">
                            ${ord.billed ? 'Paid' : (STATUS_LABELS[ord.status] || ord.status)}
                          </span>
                        </div>
                      </div>
                    `).join('')}
                  </div>
                `}
              </div>
            </div>

            <aside class="pos-invoice-panel">
              ${renderInvoiceWorkbench(selectedSummary)}
            </aside>
          </section>
        ` : renderClosedBillsHistory(state)}
      </main>
    `;
  }

  function renderInvoiceWorkbench(summary) {
    const t = summary.table;
    if (summary.activeOrders.length === 0) {
      return `
        <div style="text-align:center; padding:36px 12px;">
          <div style="font-family:var(--font-display); font-size:22px; font-weight:600; margin-bottom:6px;">${esc(t.name)}</div>
          <span class="status-pill available" style="margin-bottom:14px;">Available</span>
          <p style="font-size:13.5px; color:var(--ink-secondary); margin:0 0 18px;">
            No active orders on ${esc(t.name)}. When guests scan this table's QR code and order, the live itemized bill will appear here.
          </p>
          <a href="/table/${t.id}" data-nav="/table/${t.id}" class="btn btn-outline btn-sm">Open ${esc(t.name)} Menu ↗</a>
        </div>
      `;
    }

    return `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:12px;">
        <div>
          <div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-muted);">
            Active Table Bill • ${esc(t.zone)}
          </div>
          <h2 style="font-family:var(--font-display); font-size:26px; margin:2px 0 0;">${esc(t.name)}</h2>
        </div>
        <span class="status-pill ${summary.displayStatus}">${STATUS_LABELS[summary.displayStatus]}</span>
      </div>

      <div style="font-size:12.5px; color:var(--ink-secondary); margin-bottom:10px;">
        Orders consolidated: ${summary.activeOrders.map((o) => `<strong>#${o.orderNumber}</strong> (${o.status})`).join(', ')}
      </div>

      <table class="invoice-table">
        <thead>
          <tr>
            <th>Item</th>
            <th style="text-align:center;">Qty</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          ${summary.consolidatedItems.map((it) => `
            <tr>
              <td>
                <div style="font-weight:600;">${esc(it.name)}</div>
                <div style="font-size:11.5px; color:var(--ink-muted);" class="tabular">${formatMoney(it.price)} each</div>
              </td>
              <td style="text-align:center; font-weight:700;" class="tabular">${it.qty}</td>
              <td style="font-weight:600;" class="tabular">${formatMoney(it.lineTotal)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="form-field">
        <label>Discount</label>
        <div class="pill-group">
          ${[0, 5, 10, 15].map((pct) => `
            <button type="button" class="pill-choice ${ui.discountPercent === pct ? 'active' : ''}" data-action="set-discount" data-pct="${pct}">
              ${pct === 0 ? 'None' : `${pct}% Off`}
            </button>
          `).join('')}
        </div>
      </div>

      <div class="form-field">
        <label>Payment Method</label>
        <div class="pill-group">
          ${['UPI', 'Card', 'Cash'].map((pm) => `
            <button type="button" class="pill-choice ${ui.paymentMethod === pm ? 'active' : ''}" data-action="set-payment" data-pm="${pm}">
              ${pm}
            </button>
          `).join('')}
        </div>
      </div>

      <div class="invoice-totals">
        <div class="invoice-total-row">
          <span>Subtotal</span>
          <span class="tabular">${formatMoney(summary.subtotal)}</span>
        </div>
        ${summary.discountAmount > 0 ? `
          <div class="invoice-total-row" style="color:var(--success);">
            <span>Discount (${summary.discountPercent}%)</span>
            <span class="tabular">−${formatMoney(summary.discountAmount)}</span>
          </div>
        ` : ''}
        <div class="invoice-total-row">
          <span>GST (${summary.taxRate}%)</span>
          <span class="tabular">${formatMoney(summary.taxAmount)}</span>
        </div>
        <div class="invoice-total-row grand">
          <span>Grand Total</span>
          <span class="tabular">${formatMoney(summary.grandTotal)}</span>
        </div>
      </div>

      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button type="button" class="btn btn-outline" style="flex:1;" data-action="print-active-bill" data-table="${t.id}">
          🖨 Print Receipt
        </button>
        <button
          type="button"
          class="btn btn-success"
          style="flex:1.4;"
          data-action="settle-bill"
          data-table="${t.id}"
          ${ui.settlingBill ? 'disabled' : ''}
        >
          ${ui.settlingBill ? 'Settling…' : `Collect ${formatMoney(summary.grandTotal)} & Clear`}
        </button>
      </div>
    `;
  }

  function renderClosedBillsHistory(state) {
    if (state.bills.length === 0) {
      return `
        <div class="live-feed-card" style="text-align:center; padding:48px 20px;">
          <h3 style="font-family:var(--font-display); margin:0 0 6px;">No settled invoices yet</h3>
          <p style="margin:0; color:var(--ink-secondary); font-size:14px;">Completed table payments will be archived here for accounting and reprinting.</p>
        </div>
      `;
    }

    return `
      <div class="live-feed-card">
        <table class="invoice-table">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Table</th>
              <th>Time</th>
              <th>Items</th>
              <th>Payment</th>
              <th>Total</th>
              <th>Receipt</th>
            </tr>
          </thead>
          <tbody>
            ${state.bills.map((b) => `
              <tr>
                <td><strong>${esc(b.id)}</strong></td>
                <td>${esc(b.tableName)}</td>
                <td>${formatTime(b.paidAt)}</td>
                <td>${b.items.reduce((s, i) => s + i.qty, 0)} items</td>
                <td><span class="status-pill available">${esc(b.paymentMethod)}</span></td>
                <td style="font-weight:700;" class="tabular">${formatMoney(b.grandTotal)}</td>
                <td>
                  <button type="button" class="btn btn-outline btn-sm" data-action="print-closed-bill" data-bill-id="${esc(b.id)}">
                    🖨 Reprint
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function printReceipt(receiptObj) {
    const area = document.getElementById('print-receipt-area');
    if (!area) return;
    const paidLabel = receiptObj.paidAt ? `PAID (${receiptObj.paymentMethod})` : 'PROFORMA BILL';
    area.innerHTML = `
      <div style="text-align:center; margin-bottom:10px;">
        <div style="font-size:16px; font-weight:700;">SAFFRON &amp; EMBER</div>
        <div>Artisan Kitchen &amp; Dining</div>
        <div style="margin-top:4px;">--------------------------------</div>
        <div><strong>${esc(receiptObj.tableName)}</strong> • ${esc(receiptObj.id || 'ACTIVE TAB')}</div>
        <div>${new Date(receiptObj.paidAt || Date.now()).toLocaleString()}</div>
        <div>Status: ${esc(paidLabel)}</div>
        <div>--------------------------------</div>
      </div>
      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        ${receiptObj.items.map((it) => `
          <tr>
            <td style="padding:3px 0;">${it.qty}x ${esc(it.name)}</td>
            <td style="text-align:right; padding:3px 0;">${formatMoney(it.lineTotal)}</td>
          </tr>
        `).join('')}
      </table>
      <div style="margin-top:8px;">--------------------------------</div>
      <div style="display:flex; justify-content:space-between;"><span>Subtotal</span><span>${formatMoney(receiptObj.subtotal)}</span></div>
      ${receiptObj.discountAmount > 0 ? `<div style="display:flex; justify-content:space-between;"><span>Discount (${receiptObj.discountPercent}%)</span><span>-${formatMoney(receiptObj.discountAmount)}</span></div>` : ''}
      <div style="display:flex; justify-content:space-between;"><span>GST (${receiptObj.taxRate}%)</span><span>${formatMoney(receiptObj.taxAmount)}</span></div>
      <div style="display:flex; justify-content:space-between; font-weight:700; font-size:14px; margin-top:6px;">
        <span>GRAND TOTAL</span><span>${formatMoney(receiptObj.grandTotal)}</span>
      </div>
      <div style="text-align:center; margin-top:14px;">Thank you for dining with us!</div>
    `;
    document.body.classList.add('printing-receipt');
    window.print();
    setTimeout(() => document.body.classList.remove('printing-receipt'), 400);
  }

  // =========================================================================
  // VIEW 5: Printable 10 Table QR Codes (/qr-codes)
  // =========================================================================
  function renderQrCodesView(state) {
    const info = Store.getServerInfo();
    const currentBase = getQrBaseUrl();

    return `
      ${renderTopBar(state)}
      <main class="container">
        <div class="section-header no-print">
          <div>
            <h1 class="section-title">Table QR Code Standees (Tables 1 – 10)</h1>
            <p class="section-subtitle">Print and place each card on its table. Phones on the same Wi-Fi scan directly into that table's menu.</p>
          </div>
          <button type="button" class="btn btn-primary" data-action="print-qr-sheet">
            🖨 Print All 10 Table Cards
          </button>
        </div>

        <section class="qr-toolbar no-print">
          <div class="qr-url-control">
            <label for="qr-base-url">Base URL encoded inside every QR code</label>
            <div class="qr-url-row">
              <input
                id="qr-base-url"
                type="text"
                value="${esc(currentBase)}"
                data-input="qr-base-url"
                data-focus-id="qr-base-url"
              />
              <button type="button" class="btn btn-outline btn-sm" data-action="set-qr-base" data-url="${esc(info.lanBaseUrl)}">
                Use Wi-Fi IP (${esc(info.lanIp)})
              </button>
              <button type="button" class="btn btn-outline btn-sm" data-action="set-qr-base" data-url="${esc(info.localBaseUrl)}">
                Use Localhost
              </button>
            </div>
          </div>
        </section>

        <section class="qr-grid">
          ${state.tables.map((t) => {
            const url = `${currentBase}/table/${t.id}`;
            const svg = QR.toSVG(url, { margin: 3 });
            return `
              <article class="qr-tent-card">
                <div class="qr-tent-brand">Saffron &amp; Ember</div>
                <div class="qr-tent-table">${esc(t.name)}</div>
                <div style="font-size:12px; color:var(--ink-muted); margin-top:-6px;">${esc(t.zone)} • ${t.seats} Guests</div>
                <div class="qr-frame">${svg}</div>
                <div class="qr-scan-cta">Scan to Order From Your Table</div>
                <div class="qr-url-caption">${esc(url)}</div>
                <a href="/table/${t.id}" data-nav="/table/${t.id}" class="btn btn-outline btn-sm no-print" style="width:100%;">
                  Test Table ${t.id} Menu →
                </a>
              </article>
            `;
          }).join('')}
        </section>
      </main>
    `;
  }

  // =========================================================================
  // Master Render & Event Delegation
  // =========================================================================
  function render() {
    const state = Store.getState();
    const root = document.getElementById('app');
    if (!root) return;

    if (!state) {
      root.innerHTML = `<div style="display:grid; place-items:center; min-height:100vh; font-family:var(--font-display); font-size:20px; color:var(--ink-secondary);">Connecting to Saffron &amp; Ember…</div>`;
      return;
    }

    document.body.classList.toggle('kds-mode', ui.route.view === 'kitchen');

    renderWithFocusPreserved(() => {
      switch (ui.route.view) {
        case 'table':
          root.innerHTML = renderCustomerView(state, ui.route.tableId);
          break;
        case 'kitchen':
          root.innerHTML = renderKitchenView(state);
          break;
        case 'billing':
          root.innerHTML = renderBillingView(state);
          break;
        case 'qr':
          root.innerHTML = renderQrCodesView(state);
          break;
        default:
          root.innerHTML = renderHubView(state);
      }
    });
  }

  // Click delegation
  document.addEventListener('click', async (ev) => {
    const backdropClose = ev.target && ev.target.getAttribute ? ev.target.getAttribute('data-backdrop-close') : null;
    if (backdropClose === 'qr') {
      ui.qrPreviewTableId = null;
      render();
      return;
    }
    if (backdropClose === 'checkout') {
      ui.checkoutOpen = false;
      render();
      return;
    }

    const navEl = ev.target.closest('[data-nav]');
    if (navEl && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey) {
      ev.preventDefault();
      navigate(navEl.getAttribute('data-nav'));
      return;
    }

    const actionEl = ev.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.getAttribute('data-action');

    try {
      if (action === 'open-qr-modal') {
        ui.qrPreviewTableId = Number(actionEl.getAttribute('data-table'));
        render();
      } else if (action === 'close-qr-modal') {
        ui.qrPreviewTableId = null;
        render();
      } else if (action === 'goto-bill') {
        ui.selectedBillingTable = Number(actionEl.getAttribute('data-table'));
        ui.billingTab = 'active';
        ui.discountPercent = 0;
        navigate('/billing');
      } else if (action === 'set-customer-tab') {
        ui.customerTab = actionEl.getAttribute('data-tab');
        render();
      } else if (action === 'toggle-veg') {
        ui.vegOnly = !ui.vegOnly;
        render();
      } else if (action === 'toggle-bestseller') {
        ui.bestsellerOnly = !ui.bestsellerOnly;
        render();
      } else if (action === 'set-category') {
        ui.categoryFilter = actionEl.getAttribute('data-cat');
        render();
      } else if (action === 'clear-menu-filters') {
        ui.search = '';
        ui.vegOnly = false;
        ui.bestsellerOnly = false;
        ui.categoryFilter = 'All';
        render();
      } else if (action === 'cart-add' || action === 'cart-inc') {
        const id = actionEl.getAttribute('data-item-id');
        const item = MENU_ITEMS.find((m) => m.id === id);
        if (!item) return;
        if (!ui.cart[id]) ui.cart[id] = { item, qty: 0, notes: '' };
        ui.cart[id].qty += 1;
        render();
      } else if (action === 'cart-dec') {
        const id = actionEl.getAttribute('data-item-id');
        if (ui.cart[id]) {
          ui.cart[id].qty -= 1;
          if (ui.cart[id].qty <= 0) delete ui.cart[id];
        }
        if (getCartTotals().count === 0) ui.checkoutOpen = false;
        render();
      } else if (action === 'open-checkout') {
        ui.checkoutOpen = true;
        render();
      } else if (action === 'close-checkout') {
        ui.checkoutOpen = false;
        render();
      } else if (action === 'submit-order') {
        const tableId = Number(actionEl.getAttribute('data-table'));
        const { entries } = getCartTotals();
        if (entries.length === 0) return;
        ui.submittingOrder = true;
        render();
        const items = entries.map(({ item, qty, notes }) => ({
          itemId: item.id,
          name: item.name,
          category: item.category,
          price: item.price,
          qty,
          veg: item.veg,
          notes: notes || ''
        }));
        const order = await Store.placeOrder({
          tableId,
          items,
          guestName: ui.guestName,
          orderNote: ui.orderNote
        });
        ui.cart = {};
        ui.orderNote = '';
        ui.checkoutOpen = false;
        ui.submittingOrder = false;
        ui.customerTab = 'orders';
        Sound.playSuccessTick();
        showToast(`Order #${order.orderNumber} sent to the kitchen!`, 'success');
        render();
      } else if (action === 'request-bill') {
        const tableId = Number(actionEl.getAttribute('data-table'));
        await Store.requestBill(tableId);
        showToast('Bill requested! Our staff will be right over.', 'accent');
      } else if (action === 'kds-status') {
        const orderId = actionEl.getAttribute('data-order-id');
        const status = actionEl.getAttribute('data-status');
        await Store.updateOrderStatus(orderId, status);
        Sound.playSuccessTick();
      } else if (action === 'toggle-mute') {
        const muted = Sound.toggleMute();
        showToast(muted ? 'Sound alerts muted' : 'Sound alerts enabled');
        render();
      } else if (action === 'toggle-kds-served') {
        ui.kdsShowServed = !ui.kdsShowServed;
        render();
      } else if (action === 'select-billing-table') {
        ui.selectedBillingTable = Number(actionEl.getAttribute('data-table'));
        ui.discountPercent = 0;
        render();
      } else if (action === 'set-billing-tab') {
        ui.billingTab = actionEl.getAttribute('data-tab');
        render();
      } else if (action === 'set-discount') {
        ui.discountPercent = Number(actionEl.getAttribute('data-pct'));
        render();
      } else if (action === 'set-payment') {
        ui.paymentMethod = actionEl.getAttribute('data-pm');
        render();
      } else if (action === 'print-active-bill') {
        const tableId = Number(actionEl.getAttribute('data-table'));
        const summary = Store.getTableSummary(Store.getState(), tableId, ui.discountPercent);
        printReceipt({
          id: `TAB-T${tableId}`,
          tableName: summary.table.name,
          items: summary.consolidatedItems,
          subtotal: summary.subtotal,
          discountPercent: summary.discountPercent,
          discountAmount: summary.discountAmount,
          taxRate: summary.taxRate,
          taxAmount: summary.taxAmount,
          grandTotal: summary.grandTotal
        });
      } else if (action === 'print-closed-bill') {
        const billId = actionEl.getAttribute('data-bill-id');
        const bill = Store.getState().bills.find((b) => b.id === billId);
        if (bill) printReceipt(bill);
      } else if (action === 'settle-bill') {
        const tableId = Number(actionEl.getAttribute('data-table'));
        ui.settlingBill = true;
        render();
        const bill = await Store.settleTable(tableId, {
          discountPercent: ui.discountPercent,
          paymentMethod: ui.paymentMethod
        });
        ui.settlingBill = false;
        ui.discountPercent = 0;
        Sound.playSuccessTick();
        showToast(`${bill.id} settled (${formatMoney(bill.grandTotal)} via ${bill.paymentMethod}). Table ${tableId} cleared!`, 'success');
        render();
      } else if (action === 'set-qr-base') {
        ui.customBaseUrl = actionEl.getAttribute('data-url');
        render();
      } else if (action === 'print-qr-sheet') {
        document.body.classList.remove('printing-receipt');
        window.print();
      } else if (action === 'seed-demo') {
        await Store.seedDemo();
        showToast('Sample orders added to Tables 2, 4 & 7!', 'accent');
      } else if (action === 'reset-all') {
        if (window.confirm('Reset all 10 tables, active orders, and today\'s bills?')) {
          await Store.resetAll();
          showToast('All tables reset cleanly');
        }
      }
    } catch (err) {
      ui.submittingOrder = false;
      ui.settlingBill = false;
      showToast(err.message || 'Something went wrong', 'accent');
      render();
    }
  });

  // Input delegation
  document.addEventListener('input', (ev) => {
    const inp = ev.target;
    const type = inp.getAttribute('data-input');
    if (!type) return;

    if (type === 'menu-search') {
      ui.search = inp.value;
      render();
    } else if (type === 'item-note') {
      const id = inp.getAttribute('data-item-id');
      if (ui.cart[id]) ui.cart[id].notes = inp.value;
    } else if (type === 'guest-name') {
      ui.guestName = inp.value;
    } else if (type === 'order-note') {
      ui.orderNote = inp.value;
    } else if (type === 'qr-base-url') {
      ui.customBaseUrl = inp.value;
      render();
    }
  });

  // Live 1-second timer updates for KDS without full DOM re-render
  setInterval(() => {
    if (ui.route.view !== 'kitchen') return;
    document.querySelectorAll('[data-timer-since]').forEach((el) => {
      const iso = el.getAttribute('data-timer-since');
      el.textContent = formatElapsed(iso);
      const isUrgent = elapsedMinutes(iso) >= 12 && !el.closest('.status-ready');
      el.classList.toggle('urgent', isUrgent);
    });
  }, 1000);

  // Subscribe to real-time Store updates
  Store.subscribe((state, eventType, payload) => {
    if (eventType === 'order_created' && payload && payload.order) {
      const ord = payload.order;
      if (ui.route.view === 'kitchen') {
        Sound.playNewOrderChime();
        showToast(`New Order #${ord.orderNumber} from Table ${ord.tableId}!`, 'accent');
      } else if (ui.route.view === 'billing') {
        Sound.playSuccessTick();
        showToast(`Order #${ord.orderNumber} added to Table ${ord.tableId}`, 'default');
      }
    } else if (eventType === 'bill_requested' && payload && payload.tableId) {
      if (ui.route.view === 'billing' || ui.route.view === 'hub') {
        Sound.playBillRequestChime();
        showToast(`Table ${payload.tableId} requested the bill!`, 'accent');
      }
    } else if (eventType === 'order_updated' && payload && payload.order) {
      const ord = payload.order;
      if (ui.route.view === 'table' && ui.route.tableId === ord.tableId) {
        if (ord.status === 'preparing') showToast(`Kitchen started preparing Order #${ord.orderNumber}!`, 'default');
        if (ord.status === 'ready') showToast(`Order #${ord.orderNumber} is ready and coming to Table ${ord.tableId}!`, 'success');
      }
    }
    render();
  });

  // Boot
  ui.route = parseRoute();
  render();
  Store.init();
})();
