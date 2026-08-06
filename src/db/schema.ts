import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// 0. CATEGORIES
export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'clothing' | 'accessory'
});

// 1. PRODUCTS
export const products = sqliteTable('products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  sku: text('sku').unique().notNull(),
  categoryId: integer('category_id')
    .notNull()
    .references(() => categories.id),
  brand: text('brand'),
  description: text('description'),
  basePrice: integer('base_price').notNull(), // stored in cents — fallback price used when a variant's price_override is null
  createdAt: text('created_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

// 2. PRODUCT VARIANTS
export const productVariants = sqliteTable('product_variants', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  sku: text('sku').unique().notNull(),
  priceOverride: integer('price_override'), // stored in cents
  /**
   * recomputed from stock_movements — do not write to this directly from application code outside the recompute function.
   */
  stock: integer('stock').notNull().default(0),
  size: text('size'),
  sizeType: text('size_type'), // 'letter' | 'numeric' | 'one_size' — display/filter hint only, does not constrain the `size` value
  color: text('color'),
  imageUrl: text('image_url'), // one image per color/variant
  createdAt: text('created_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

// 3. POS TERMINALS
export const posTerminals = sqliteTable('pos_terminals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').unique().notNull(),
  status: text('status').notNull().default('active'), // active, inactive
  createdAt: text('created_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

// 4. POS SESSIONS
export const posSessions = sqliteTable('pos_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  terminalId: integer('terminal_id')
    .notNull()
    .references(() => posTerminals.id),
  openedAt: text('opened_at').notNull(),
  closedAt: text('closed_at'),
  openingBalance: integer('opening_balance').notNull(), // stored in cents
  closingBalance: integer('closing_balance'), // stored in cents
  status: text('status').notNull().default('open'), // open, closed
});

// 5. SALES
export const sales = sqliteTable('sales', {
  id: text('id').primaryKey(), // Client-generated UUID (never server auto-increment)
  terminalId: integer('terminal_id')
    .notNull()
    .references(() => posTerminals.id),
  sessionId: integer('session_id')
    .notNull()
    .references(() => posSessions.id),
  customerId: text('customer_id'),
  total: integer('total').notNull(), // stored in cents
  paymentMethod: text('payment_method').notNull(),
  timestamp: text('timestamp').notNull(),
});

// 6. SALE ITEMS
export const saleItems = sqliteTable('sale_items', {
  id: text('id').primaryKey(), // Client-generated UUID (never server auto-increment)
  saleId: text('sale_id')
    .notNull()
    .references(() => sales.id, { onDelete: 'cascade' }),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id),
  variantId: integer('variant_id')
    .notNull()
    .references(() => productVariants.id),
  qty: integer('qty').notNull(),
  price: integer('price').notNull(), // price at time of sale, stored in cents
});

// 7. RETURNS
export const returns = sqliteTable('returns', {
  id: text('id').primaryKey(), // Client-generated UUID (never server auto-increment)
  saleId: text('sale_id')
    .notNull()
    .references(() => sales.id),
  reason: text('reason').notNull(),
  refundMethod: text('refund_method').notNull(),
  restockReason: text('restock_reason'), // enum: resellable, damaged, other
  timestamp: text('timestamp').notNull(),
});

// 8. RETURN ITEMS
export const returnItems = sqliteTable('return_items', {
  id: text('id').primaryKey(), // Client-generated UUID (never server auto-increment)
  returnId: text('return_id')
    .notNull()
    .references(() => returns.id, { onDelete: 'cascade' }),
  saleItemId: text('sale_item_id')
    .notNull()
    .references(() => saleItems.id),
  quantity: integer('quantity').notNull(),
  restockDecision: text('restock_decision').notNull(), // resellable, damaged, other
});

// 9. STOCK MOVEMENTS
export const stockMovements = sqliteTable('stock_movements', {
  id: text('id').primaryKey(), // Client-generated UUID (never server auto-increment)
  productId: integer('product_id')
    .notNull()
    .references(() => products.id),
  variantId: integer('variant_id')
    .notNull()
    .references(() => productVariants.id),
  signedQuantity: integer('signed_quantity').notNull(), // positive for stock in, negative for stock out
  type: text('type').notNull(), // sale, return, manual adjustment, etc.
  referenceId: text('reference_id'), // ID of sale, return, or return_item
  timestamp: text('timestamp').notNull(),
});

// 10. STOCK ALERTS
export const stockAlerts = sqliteTable('stock_alerts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id),
  variantId: integer('variant_id')
    .notNull()
    .references(() => productVariants.id),
  alertType: text('alert_type').notNull(), // negative_stock, low_stock
  quantity: integer('quantity').notNull(),
  createdAt: text('created_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});
