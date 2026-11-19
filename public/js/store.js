/**
 * Real-Time Restaurant Store Client
 * Uses HTTP REST + Server-Sent Events (SSE) when hosted by server.rb,
 * with seamless localStorage + BroadcastChannel fallback if opened statically.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'saffron_ember_pos_state_v1';
  const CHANNEL_NAME = 'saffron_ember_pos_sync_v1';

  let state = null;
  let serverInfo = {
    restaurantName: 'Saffron & Ember',
    lanIp: 'localhost',
    port: window.location.port || 8080,
    lanBaseUrl: window.location.origin === 'null' ? 'http://localhost:8080' : window.location.origin,
    localBaseUrl: window.location.origin === 'null' ? 'http://localhost:8080' : window.location.origin
  };
  let mode = 'detecting'; // 'server' | 'local'
  let connectionStatus = 'connecting'; // 'live' | 'reconnecting' | 'local'
  let eventSource = null;
  let bc = null;
  const listeners = new Set();

  function makeDefaultState() {
    const layout = [
      { id: 1,  name: 'Table 1',  seats: 2, zone: 'Window' },
      { id: 2,  name: 'Table 2',  seats: 2, zone: 'Window' },
      { id: 3,  name: 'Table 3',  seats: 2, zone: 'Window' },
      { id: 4,  name: 'Table 4',  seats: 4, zone: 'Main Hall' },
      { id: 5,  name: 'Table 5',  seats: 4, zone: 'Main Hall' },
      { id: 6,  name: 'Table 6',  seats: 4, zone: 'Main Hall' },
      { id: 7,  name: 'Table 7',  seats: 4, zone: 'Main Hall' },
      { id: 8,  name: 'Table 8',  seats: 6, zone: 'Courtyard' },
      { id: 9,  name: 'Table 9',  seats: 6, zone: 'Courtyard' },
      { id: 10, name: 'Table 10', seats: 8, zone: "Chef's Alcove" }
    ];
    return {
      restaurantName: 'Saffron & Ember',
      taxRate: 5.0,
      nextOrderNumber: 101,
      nextInvoiceNumber: 1001,
      tables: layout.map((t) => ({
        ...t,
        sessionId: `S${t.id}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
        billRequested: false,
        billRequestedAt: null
      })),
      orders: [],
      bills: []
    };
  }

  function notify(eventType = 'state_changed', payload = {}) {
    for (const fn of listeners) {
      try {
        fn(state, eventType, payload, connectionStatus);
      } catch (err) {
        console.error('Store listener error:', err);
      }
    }
  }

  // ---- Local Fallback Engine ----
  function loadLocalState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.tables) && parsed.tables.length === 10) {
          return parsed;
        }
      }
    } catch (_) {}
    const fresh = makeDefaultState();
    saveLocalState(fresh);
    return fresh;
  }

  function saveLocalState(nextState) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    } catch (_) {}
  }

  function setupLocalSync() {
    mode = 'local';
    connectionStatus = 'local';
    state = loadLocalState();

    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel(CHANNEL_NAME);
      bc.onmessage = (ev) => {
        if (ev.data && ev.data.state) {
          state = ev.data.state;
          notify(ev.data.type || 'sync', ev.data.payload || {});
        }
      };
    }

    window.addEventListener('storage', (ev) => {
      if (ev.key === STORAGE_KEY && ev.newValue) {
        try {
          state = JSON.parse(ev.newValue);
          notify('sync', {});
        } catch (_) {}
      }
    });

    notify('connected', {});
  }

  function commitLocal(eventType, payload = {}) {
    saveLocalState(state);
    if (bc) {
      bc.postMessage({ type: eventType, payload, state });
    }
    notify(eventType, payload);
  }

  // ---- Server Mode (REST + SSE) ----
  function connectSSE() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    eventSource = new EventSource('/api/events');
    eventSource.addEventListener('update', (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        connectionStatus = 'live';
        if (msg.state) state = msg.state;
        notify(msg.type || 'update', msg.payload || {});
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    });
    eventSource.onopen = () => {
      connectionStatus = 'live';
      notify('connection_status', {});
    };
    eventSource.onerror = () => {
      connectionStatus = 'reconnecting';
      notify('connection_status', {});
    };
  }

  async function apiRequest(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function init() {
    if (window.location.protocol.startsWith('http')) {
      try {
        const [st, info] = await Promise.all([
          apiRequest('/api/state'),
          apiRequest('/api/info').catch(() => serverInfo)
        ]);
        mode = 'server';
        state = st;
        if (info && info.lanBaseUrl) serverInfo = info;
        connectionStatus = 'live';
        connectSSE();
        notify('connected', {});
        return state;
      } catch (err) {
        console.warn('Backend API unavailable, falling back to local multi-tab sync:', err);
      }
    }
    setupLocalSync();
    return state;
  }

  // ---- Actions ----
  async function placeOrder({ tableId, items, guestName = '', orderNote = '' }) {
    if (mode === 'server') {
      const res = await apiRequest('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ tableId, items, guestName, orderNote })
      });
      return res.order;
    }

    const table = state.tables.find((t) => t.id === Number(tableId));
    if (!table) throw new Error('Invalid table');
    const now = new Date().toISOString();
    const orderNum = state.nextOrderNumber++;
    const subtotal = items.reduce((s, it) => s + Number(it.price) * Number(it.qty), 0);
    const order = {
      id: `ORD-${orderNum}`,
      orderNumber: orderNum,
      tableId: Number(tableId),
      tableName: table.name,
      sessionId: table.sessionId,
      guestName: guestName.trim(),
      orderNote: orderNote.trim(),
      items,
      subtotal: Math.round(subtotal * 100) / 100,
      status: 'pending',
      billed: false,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      readyAt: null,
      servedAt: null
    };
    state.orders.unshift(order);
    commitLocal('order_created', { order });
    return order;
  }

  async function updateOrderStatus(orderId, status) {
    if (mode === 'server') {
      const res = await apiRequest(`/api/orders/${encodeURIComponent(orderId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      return res.order;
    }

    const order = state.orders.find((o) => o.id === orderId);
    if (!order) throw new Error('Order not found');
    const now = new Date().toISOString();
    order.status = status;
    order.updatedAt = now;
    if (status === 'preparing' && !order.startedAt) order.startedAt = now;
    if (status === 'ready' && !order.readyAt) order.readyAt = now;
    if (status === 'served' && !order.servedAt) order.servedAt = now;
    commitLocal('order_updated', { order });
    return order;
  }

  async function requestBill(tableId) {
    if (mode === 'server') {
      const res = await apiRequest(`/api/tables/${Number(tableId)}/request-bill`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      return res.table;
    }

    const table = state.tables.find((t) => t.id === Number(tableId));
    if (!table) throw new Error('Table not found');
    table.billRequested = true;
    table.billRequestedAt = new Date().toISOString();
    commitLocal('bill_requested', { tableId: table.id, tableName: table.name });
    return table;
  }

  async function settleTable(tableId, { discountPercent = 0, paymentMethod = 'Card' }) {
    if (mode === 'server') {
      const res = await apiRequest(`/api/tables/${Number(tableId)}/settle`, {
        method: 'POST',
        body: JSON.stringify({ discountPercent, paymentMethod })
      });
      return res.bill;
    }

    const summary = getTableSummary(state, Number(tableId), discountPercent);
    if (summary.activeOrders.length === 0) throw new Error('No active orders to settle');
    const invNum = state.nextInvoiceNumber++;
    const now = new Date().toISOString();
    const table = state.tables.find((t) => t.id === Number(tableId));

    const bill = {
      id: `INV-${invNum}`,
      invoiceNumber: invNum,
      tableId: table.id,
      tableName: table.name,
      sessionId: table.sessionId,
      orderIds: summary.activeOrders.map((o) => o.id),
      items: summary.consolidatedItems,
      subtotal: summary.subtotal,
      discountPercent: summary.discountPercent,
      discountAmount: summary.discountAmount,
      taxRate: summary.taxRate,
      taxAmount: summary.taxAmount,
      grandTotal: summary.grandTotal,
      paymentMethod,
      paidAt: now
    };

    summary.activeOrders.forEach((o) => {
      o.billed = true;
      if (['pending', 'preparing', 'ready'].includes(o.status)) o.status = 'served';
      o.updatedAt = now;
    });

    state.bills.unshift(bill);
    table.billRequested = false;
    table.billRequestedAt = null;
    table.sessionId = `S${table.id}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
    commitLocal('bill_settled', { bill });
    return bill;
  }

  async function seedDemo() {
    if (mode === 'server') {
      const res = await apiRequest('/api/demo/seed', { method: 'POST', body: '{}' });
      state = res.state;
      return state;
    }
    const now = Date.now();
    const t2 = state.tables[1];
    const t4 = state.tables[3];
    const t7 = state.tables[6];
    const samples = [
      {
        table: t2, status: 'ready', minsAgo: 14, guest: 'Aarav', note: 'Serve chutney on the side',
        items: [
          { itemId: 'st-1', name: 'Charred Paneer Tikka', category: 'Starters', price: 340, qty: 1, veg: true, notes: 'Less spicy' },
          { itemId: 'dr-1', name: 'Kokum & Rose Cooler', category: 'Beverages', price: 180, qty: 2, veg: true, notes: '' }
        ]
      },
      {
        table: t4, status: 'preparing', minsAgo: 7, guest: 'Meera & Guests', note: 'Allergies: No peanuts',
        items: [
          { itemId: 'mn-1', name: 'Saffron Butter Chicken', category: 'Mains', price: 520, qty: 2, veg: false, notes: '' },
          { itemId: 'mn-2', name: '24-Hour Smoked Dal Makhani', category: 'Mains', price: 420, qty: 1, veg: true, notes: '' },
          { itemId: 'br-1', name: 'Blistered Garlic Naan', category: 'Breads & Rice', price: 110, qty: 4, veg: true, notes: 'Extra butter' }
        ]
      },
      {
        table: t7, status: 'pending', minsAgo: 2, guest: 'Rohan', note: '',
        items: [
          { itemId: 'st-3', name: 'Crispy Lotus Stem Honey Chili', category: 'Starters', price: 320, qty: 1, veg: true, notes: 'Extra crispy' },
          { itemId: 'wf-1', name: 'Truffle Wild Mushroom Flatbread', category: 'Wood-Fired', price: 490, qty: 1, veg: true, notes: '' },
          { itemId: 'ds-1', name: 'Warm Pistachio Gulab Jamun', category: 'Desserts', price: 260, qty: 2, veg: true, notes: 'Bring after mains' }
        ]
      }
    ];
    for (const s of samples) {
      const orderNum = state.nextOrderNumber++;
      const created = new Date(now - s.minsAgo * 60000).toISOString();
      const subtotal = s.items.reduce((sum, i) => sum + i.price * i.qty, 0);
      state.orders.unshift({
        id: `ORD-${orderNum}`,
        orderNumber: orderNum,
        tableId: s.table.id,
        tableName: s.table.name,
        sessionId: s.table.sessionId,
        guestName: s.guest,
        orderNote: s.note,
        items: s.items,
        subtotal,
        status: s.status,
        billed: false,
        createdAt: created,
        updatedAt: created,
        startedAt: ['preparing', 'ready'].includes(s.status) ? created : null,
        readyAt: s.status === 'ready' ? created : null,
        servedAt: null
      });
    }
    t2.billRequested = true;
    t2.billRequestedAt = new Date().toISOString();
    commitLocal('demo_seeded', {});
    return state;
  }

  async function resetAll() {
    if (mode === 'server') {
      const res = await apiRequest('/api/demo/reset', { method: 'POST', body: '{}' });
      state = res.state;
      return state;
    }
    state = makeDefaultState();
    commitLocal('system_reset', {});
    return state;
  }

  // ---- Selectors ----
  function getTableActiveOrders(st, tableId) {
    if (!st) return [];
    const table = st.tables.find((t) => t.id === Number(tableId));
    if (!table) return [];
    return st.orders.filter(
      (o) => o.tableId === table.id && o.sessionId === table.sessionId && !o.billed && o.status !== 'cancelled'
    );
  }

  function getTableSummary(st, tableId, discountPercent = 0) {
    const table = st ? st.tables.find((t) => t.id === Number(tableId)) : null;
    const activeOrders = getTableActiveOrders(st, tableId);
    const map = new Map();

    // Chronological consolidation
    [...activeOrders].reverse().forEach((ord) => {
      ord.items.forEach((it) => {
        const key = `${it.itemId}|${it.price}`;
        if (map.has(key)) {
          const entry = map.get(key);
          entry.qty += it.qty;
          entry.lineTotal = Math.round(entry.qty * entry.price * 100) / 100;
        } else {
          map.set(key, {
            itemId: it.itemId,
            name: it.name,
            price: it.price,
            qty: it.qty,
            lineTotal: Math.round(it.qty * it.price * 100) / 100
          });
        }
      });
    });

    const consolidatedItems = Array.from(map.values());
    const itemCount = consolidatedItems.reduce((s, i) => s + i.qty, 0);
    const subtotal = Math.round(consolidatedItems.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100;
    const discPct = Math.max(0, Math.min(100, Number(discountPercent) || 0));
    const discountAmount = Math.round(subtotal * (discPct / 100) * 100) / 100;
    const taxable = Math.round((subtotal - discountAmount) * 100) / 100;
    const taxRate = st ? Number(st.taxRate || 5) : 5;
    const taxAmount = Math.round(taxable * (taxRate / 100) * 100) / 100;
    const grandTotal = Math.round((taxable + taxAmount) * 100) / 100;

    let displayStatus = 'available';
    if (table && table.billRequested && activeOrders.length > 0) {
      displayStatus = 'bill_requested';
    } else if (activeOrders.some((o) => o.status === 'pending')) {
      displayStatus = 'pending';
    } else if (activeOrders.some((o) => o.status === 'preparing')) {
      displayStatus = 'preparing';
    } else if (activeOrders.some((o) => o.status === 'ready')) {
      displayStatus = 'ready';
    } else if (activeOrders.length > 0) {
      displayStatus = 'served';
    }

    return {
      table,
      activeOrders,
      consolidatedItems,
      itemCount,
      subtotal,
      discountPercent: discPct,
      discountAmount,
      taxRate,
      taxAmount,
      grandTotal,
      displayStatus
    };
  }

  global.RestaurantStore = {
    init,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getState: () => state,
    getServerInfo: () => serverInfo,
    getMode: () => mode,
    getConnectionStatus: () => connectionStatus,
    placeOrder,
    updateOrderStatus,
    requestBill,
    settleTable,
    seedDemo,
    resetAll,
    getTableActiveOrders,
    getTableSummary
  };
})(window);
