# Girl Store POS Suite — Architecture

This document is the source of truth for technical and design decisions in the POS module.
**Read this before implementing any feature.** Do not deviate from these decisions without
explicit approval — they were chosen deliberately to solve specific problems (multi-terminal
sync, offline reliability, variant tracking).

---

## 1. Design System

Based on Carbon-style enterprise design ("Productive Clarity"): clean, systematic, accessible,
built for data-dense UIs.

### Colors
- Primary: `#0f62fe` — buttons, links, active states
- Background: `#ffffff`
- Gray scale: `#f4f4f4` → `#161616` for layered hierarchy
- Success: `#198038` — positive states, confirmations
- Danger: `#da1e28` — destructive actions, errors, low stock alerts
- Semantic color roles only — never decorative

### Typography
- Font family: IBM Plex Sans (single family across the app)
- Hierarchy via weight (300/400/600), not size
- Body: 14px · Labels: 12px · Headings: 20–32px
- 8px spacing grid, strictly followed

### Elevation & Components
- Minimal shadows: Level 1 `0 2px 6px rgba(0,0,0,0.1)`, Level 2 `0 4px 12px rgba(0,0,0,0.12)`
- Prefer `border-bottom: 1px solid #e0e0e0` over shadows for separation
- Buttons: Primary = solid blue, Secondary = outlined, Ghost = text only, 48px min touch target
- Cards: `#f4f4f4` background, no border-radius, 16px padding
- Inputs: bottom-border style, 40px height, `#f4f4f4` background
- Tables: zebra striping with `#f4f4f4` alternating rows
- WCAG AA minimum contrast on all text

---

## 2. Core Principle: Offline-First, Multi-Terminal

The POS must work with **zero internet connection** and support **multiple cashier terminals**
selling from the **same shared stock** simultaneously. This is the hardest constraint in the
system and drives every decision below.

### 2.1 Client-side storage
- Each terminal keeps a local database (IndexedDB via Dexie.js, or SQLite via WASM).
- The local DB mirrors the products/variants/prices needed to operate offline.

### 2.2 ID strategy: client-generated UUIDs
- Every new record created on a terminal (sale, sale_item, return) gets a **UUID generated on
  the client**, never a server-assigned auto-increment ID.
- This avoids ID collisions when multiple offline terminals sync later.

### 2.3 Outbox pattern (sync queue)
- Every local write (sale, return, stock adjustment) is appended to a local `sync_queue` table
  before anything else happens.
- When connectivity returns, queued operations are sent to the server **in the order they were
  created**, and processed **idempotently** (the server must ignore an operation whose UUID it
  has already applied — this handles retries after network drops).

### 2.4 Conflict resolution strategy: "Allow, then reconcile"
- Terminals **do not block a sale** waiting for a live stock check.
- If two terminals sell the last unit of the same variant while both offline, the stock is
  allowed to go negative locally.
- On sync, if a product/variant's stock would go negative, the sale is still accepted, but a
  row is created in `stock_alerts` for manual review by the store owner. **The sale is never
  rejected retroactively.**
- Rationale: simpler to build, matches real-world small/medium boutique volume, and a human can
  resolve rare oversell cases faster than the system can prevent them all.
- (Not chosen, for future consideration only: per-terminal stock reservation caps for rare
  high-value items, or LAN-based real-time sync between terminals in the same physical store.)

---

## 3. Data Model (Drizzle ORM)

Core tables for the POS module:

| Table | Purpose |
|---|---|
| `products` | Base product info (name, SKU, category, brand, description) |
| `product_variants` | Size/color combinations, each with its own SKU, price override, stock |
| `pos_terminals` | One row per cashier device/terminal |
| `pos_sessions` | Cash drawer open/close sessions per terminal |
| `sales` | Sale header: id (UUID), terminal_id, customer_id, total, payment method, timestamp |
| `sale_items` | Line items: sale_id, product_id, variant_id, qty, price at time of sale |
| `returns` | Return header: linked to original sale_id, reason, refund method |
| `return_items` | Which sale_items were returned, quantity, restock decision |
| `stock_movements` | Every stock change (sale, return, manual adjustment), signed quantity |
| `stock_alerts` | Negative-stock or low-stock flags created during sync reconciliation |
| `sync_queue` | Local-only table (client-side): pending operations awaiting sync |

Key rules:
- `sale_items.variant_id` is **required** whenever the product has variants — never optional.
- `stock_movements` is the single source of truth for current stock; `product_variants.stock`
  is a cached/denormalized value recomputed from movements, not edited directly.
- Returns create a **restock_reason** (resellable / damaged / other) and only increment stock
  back if the item is marked resellable.

---

## 4. Screens (exported from Stitch, Carbon design system)

Completed and reviewed:
- Splash, Login, Dashboard
- Point of Sale (with variant selector modal)
- Products management, Inventory (with expandable variant rows)
- Add Product modal (with variants table: size, color, SKU, price override, stock)
- Customer Receipt (shows variant per line item)
- Sale Successful screen
- Returns: Search Order, Returns: Process Items (with restock reason)

Not yet designed / reviewed:
- Customers, Sales history, Expenses, Reports/Analytics, User Management, Settings

---

## 5. Working with Jules (async coding agent)

- Architectural decisions in this document are **final** — do not let Jules re-decide the
  conflict resolution strategy, ID strategy, or sync pattern.
- Break work into small, single-purpose GitHub Issues (one Issue = one reviewable PR):
  1. Drizzle schema for the tables above
  2. CRUD endpoints for products/variants
  3. Sync endpoint that consumes `sync_queue` operations idempotently
  4. POS terminal UI wiring (connect Stitch-exported screens to real data)
  5. Returns flow wiring (restock logic per `restock_reason`)
- Every Issue should explicitly state assumptions (e.g. "assume stock may go negative — do not
  block the sale, just log to `stock_alerts`") so Jules doesn't invent its own logic.
- Review every PR specifically for: idempotency, UUID generation happening client-side (not
  server-side), and correct ordering of synced operations.
