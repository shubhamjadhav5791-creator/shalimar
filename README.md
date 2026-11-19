# Saffron & Ember — 10-Table QR Ordering, Kitchen Display & Billing POS

A complete, zero-dependency real-time restaurant ordering website supporting **10 tables (`Table 1` – `Table 10`)**. Customers scan the unique QR code at their table to place orders directly to the **Kitchen Display System (KDS)** and **Billing Counter POS** simultaneously.

## Quick Start (macOS)

Run the built-in Ruby server (no installs or packages required):

```bash
/usr/bin/ruby server.rb
```

Or double-click **`start.command`** in Finder.

## Views & URLs

- **Live 10-Table Floor Plan & Hub**: `http://localhost:8080/`
- **Customer QR Table Menus (1–10)**: `http://localhost:8080/table/1` … `http://localhost:8080/table/10`
- **Kitchen Display System (KDS)**: `http://localhost:8080/kitchen`
- **Billing Counter / Cashier POS**: `http://localhost:8080/billing`
- **Printable Table QR Standees**: `http://localhost:8080/qr-codes`

## Scanning QR Codes From Real Phones

When the server starts, it detects your Mac's local Wi-Fi IP (e.g., `http://192.168.1.x:8080`) and automatically encodes that address into all 10 table QR codes on `/qr-codes`. Any smartphone connected to the same Wi-Fi network can scan a table's QR code and immediately send live orders straight to the Kitchen Display and Billing Counter.

## Features

- **10 Dedicated Table QR Menus**: Mobile-first categorized menu with Veg / Chef's Special filters, search, per-item cooking notes, general kitchen instructions, live 4-stage order tracker, and one-tap **Request Bill** button.
- **Real-Time Kitchen Display System (`/kitchen`)**: High-contrast dark pass screen with audio chime notifications, aggregated batch-prep counter bar, live elapsed timers, 3-stage Kanban board (`New Orders` → `Preparing` → `Ready to Serve`), and served history.
- **Billing Counter POS (`/billing`)**: Consolidates multiple order rounds per table automatically, pulses when a table requests its bill, supports discounts (`0% / 5% / 10% / 15%`), GST calculation, payment methods (`UPI / Card / Cash`), thermal receipt printing, table clearing, and settled invoice archive.
- **Persistent State**: Automatically saved to `data/store.json`.
