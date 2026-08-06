import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { db } from '../index';
import { sales, saleItems, stockMovements, productVariants } from '../schema';
import { randomUUID } from 'crypto';

export interface CreateSaleLineItem {
  variantId: number;
  qty: number;
  price: number; // Price in cents at time of sale
}

export interface CreateSaleInput {
  terminalId: number;
  sessionId: number;
  customerId?: string | null;
  paymentMethod: string;
  items: CreateSaleLineItem[];
}

export interface ListSalesFilter {
  terminalId?: number;
  from?: string; // ISO date string
  to?: string;   // ISO date string
}

/**
 * Recomputes the stock for a product variant by summing all of its stock movements.
 * Returns the summed quantity, or 0 if there are no movements.
 * This is synchronous to be safely usable inside better-sqlite3 transactions.
 */
export function recomputeVariantStockSync(variantId: number, tx: any = db): number {
  const result = tx
    .select({
      sum: sql<number>`SUM(${stockMovements.signedQuantity})`,
    })
    .from(stockMovements)
    .where(eq(stockMovements.variantId, variantId))
    .get();

  return Number(result?.sum || 0);
}

/**
 * Async wrapper for recomputeVariantStock to match typical repository pattern.
 */
export async function recomputeVariantStock(variantId: number): Promise<number> {
  return recomputeVariantStockSync(variantId, db);
}

/**
 * Records a full sale in one atomic database transaction.
 * Generates client-side UUIDs, recomputes the total price server-side,
 * inserts stock movements, and updates the cached stock on each product variant.
 */
export async function createSale(input: CreateSaleInput) {
  if (!input.items || input.items.length === 0) {
    throw new Error('Sale must contain at least one item');
  }

  // better-sqlite3 transactions MUST be synchronous
  return db.transaction((tx) => {
    const saleId = randomUUID();
    const timestamp = new Date().toISOString();

    let computedTotal = 0;
    const saleItemsToInsert = [];
    const stockMovementsToInsert = [];
    const affectedVariantIds = new Set<number>();

    for (const item of input.items) {
      if (item.qty <= 0) {
        throw new Error('Item quantity must be greater than 0');
      }

      // Fetch variant to verify existence and retrieve product_id (synchronous select)
      const variant = tx
        .select()
        .from(productVariants)
        .where(eq(productVariants.id, item.variantId))
        .get();

      if (!variant) {
        throw new Error(`Product variant with ID ${item.variantId} does not exist`);
      }

      computedTotal += item.qty * item.price;

      const saleItemId = randomUUID();
      saleItemsToInsert.push({
        id: saleItemId,
        saleId: saleId,
        productId: variant.productId,
        variantId: item.variantId,
        qty: item.qty,
        price: item.price,
      });

      const movementId = randomUUID();
      stockMovementsToInsert.push({
        id: movementId,
        productId: variant.productId,
        variantId: item.variantId,
        signedQuantity: -item.qty, // stock going out is negative
        type: 'sale',
        referenceId: saleId,
        timestamp: timestamp,
      });

      affectedVariantIds.add(item.variantId);
    }

    // Insert sales row (synchronous insert)
    tx.insert(sales).values({
      id: saleId,
      terminalId: input.terminalId,
      sessionId: input.sessionId,
      customerId: input.customerId ?? null,
      total: computedTotal,
      paymentMethod: input.paymentMethod,
      timestamp: timestamp,
    }).run();

    // Insert sale items rows (synchronous insert)
    for (const item of saleItemsToInsert) {
      tx.insert(saleItems).values(item).run();
    }

    // Insert stock movements rows (synchronous insert)
    for (const movement of stockMovementsToInsert) {
      tx.insert(stockMovements).values(movement).run();
    }

    // NOTE ON STOCK ALERTS:
    // stock_alerts insertion is intentionally deferred here.
    // In the multi-terminal design, this is handled during sync reconciliation,
    // which is out of scope for the current single-device offline flow.

    // Update product variant cached stock by recomputing it from stock movements (synchronous)
    for (const variantId of affectedVariantIds) {
      const updatedStock = recomputeVariantStockSync(variantId, tx);
      tx
        .update(productVariants)
        .set({ stock: updatedStock })
        .where(eq(productVariants.id, variantId))
        .run();
    }

    // Retrieve and return the created sale with its items (synchronous select)
    const createdSale = tx
      .select()
      .from(sales)
      .where(eq(sales.id, saleId))
      .get();

    const createdItems = tx
      .select()
      .from(saleItems)
      .where(eq(saleItems.saleId, saleId))
      .all();

    return {
      ...createdSale,
      items: createdItems,
    };
  });
}

/**
 * Returns a sale with its line items included.
 */
export async function getSaleById(id: string) {
  const sale = await db
    .select()
    .from(sales)
    .where(eq(sales.id, id))
    .get();

  if (!sale) {
    return null;
  }

  const items = await db
    .select()
    .from(saleItems)
    .where(eq(saleItems.saleId, id))
    .all();

  return {
    ...sale,
    items,
  };
}

/**
 * Lists sales with optional filtering by terminalId and by date range on timestamp.
 */
export async function listSales(filter?: ListSalesFilter) {
  const conditions = [];

  if (filter?.terminalId !== undefined) {
    conditions.push(eq(sales.terminalId, filter.terminalId));
  }
  if (filter?.from !== undefined) {
    conditions.push(gte(sales.timestamp, filter.from));
  }
  if (filter?.to !== undefined) {
    conditions.push(lte(sales.timestamp, filter.to));
  }

  let query = db.select().from(sales);
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  return await query.all();
}
