import { eq, and, gte, lte } from 'drizzle-orm';
import { db } from '../index';
import { returns, returnItems, stockMovements, productVariants, sales, saleItems } from '../schema';
import { recomputeVariantStockSync } from './sales';
import { randomUUID } from 'crypto';

export interface CreateReturnItemInput {
  id?: string;
  saleItemId: string;
  quantity: number;
  restockDecision: string; // resellable, resalable, defective, damaged, other
}

export interface ListReturnsFilter {
  terminalId?: number;
  saleId?: string;
  from?: string; // ISO timestamp
  to?: string;   // ISO timestamp
}

/**
 * Creates a return record in one atomic database transaction.
 * Performs validation, inserts returns + return_items, generates positive stock_movements
 * for resalable/resellable items, and recomputes stock for affected variants.
 */
export async function createReturn(
  saleId: string,
  items: CreateReturnItemInput[],
  reason?: string,
  refundMethod?: string
) {
  if (!items || items.length === 0) {
    throw new Error('Return must contain at least one item');
  }

  return db.transaction((tx) => {
    // 1. Verify sale exists
    const sale = tx
      .select()
      .from(sales)
      .where(eq(sales.id, saleId))
      .get();

    if (!sale) {
      throw new Error(`Sale with ID ${saleId} does not exist`);
    }

    const returnId = randomUUID();
    const timestamp = new Date().toISOString();

    const returnItemsToInsert = [];
    const stockMovementsToInsert = [];
    const affectedVariantIds = new Set<number>();
    let computedRefundAmount = 0;

    // Track requested quantity per saleItemId in this single return transaction
    // to handle duplicates/cumulative checks properly.
    const requestedQtyMap = new Map<string, number>();
    for (const item of items) {
      if (item.quantity <= 0) {
        throw new Error('Return quantity must be greater than 0');
      }
      requestedQtyMap.set(
        item.saleItemId,
        (requestedQtyMap.get(item.saleItemId) || 0) + item.quantity
      );
    }

    // 2. Process and validate each return item
    for (const item of items) {
      // Fetch corresponding sale item to get price, original quantity, and variant info
      const saleItem = tx
        .select()
        .from(saleItems)
        .where(and(eq(saleItems.id, item.saleItemId), eq(saleItems.saleId, saleId)))
        .get();

      if (!saleItem) {
        throw new Error(`Sale item with ID ${item.saleItemId} does not exist for sale ${saleId}`);
      }

      // Query previously returned quantities for this sale item
      const previousReturnItems = tx
        .select()
        .from(returnItems)
        .where(eq(returnItems.saleItemId, item.saleItemId))
        .all();

      const previouslyReturned = previousReturnItems.reduce((sum, ri) => sum + ri.quantity, 0);
      const remaining = saleItem.qty - previouslyReturned;
      const totalRequestedForThisItem = requestedQtyMap.get(item.saleItemId) || 0;

      if (totalRequestedForThisItem > remaining) {
        throw new Error(
          `Cannot return quantity ${totalRequestedForThisItem} for sale item ${item.saleItemId}. Only ${remaining} remaining (sold: ${saleItem.qty}, already returned: ${previouslyReturned}).`
        );
      }

      // Calculate refund amount
      computedRefundAmount += item.quantity * saleItem.price;

      const returnItemId = item.id || randomUUID();
      returnItemsToInsert.push({
        id: returnItemId,
        returnId: returnId,
        saleItemId: item.saleItemId,
        quantity: item.quantity,
        restockDecision: item.restockDecision,
      });

      const isResalable =
        item.restockDecision.toLowerCase() === 'resalable' ||
        item.restockDecision.toLowerCase() === 'resellable';

      if (isResalable) {
        stockMovementsToInsert.push({
          id: randomUUID(),
          productId: saleItem.productId,
          variantId: saleItem.variantId,
          signedQuantity: item.quantity, // positive for stock returned to shelves
          type: 'return',
          referenceId: returnId,
          timestamp: timestamp,
        });
        affectedVariantIds.add(saleItem.variantId);
      }
    }

    // 3. Insert returns record
    // In returns table, we map restockReason as the general return's main restock decision
    tx.insert(returns).values({
      id: returnId,
      saleId: saleId,
      reason: reason || 'Customer Return',
      refundMethod: refundMethod || sale.paymentMethod || 'cash',
      restockReason: items[0]?.restockDecision || 'other',
      timestamp: timestamp,
    }).run();

    // 4. Insert return items
    for (const ri of returnItemsToInsert) {
      tx.insert(returnItems).values(ri).run();
    }

    // 5. Insert stock movements
    for (const sm of stockMovementsToInsert) {
      tx.insert(stockMovements).values(sm).run();
    }

    // 6. Recompute and update stock for affected variants
    for (const variantId of affectedVariantIds) {
      const updatedStock = recomputeVariantStockSync(variantId, tx);
      tx.update(productVariants)
        .set({ stock: updatedStock })
        .where(eq(productVariants.id, variantId))
        .run();
    }

    // 7. Retrieve and return the created return record with its items and computed refundAmount
    const createdReturn = tx
      .select({
        id: returns.id,
        saleId: returns.saleId,
        reason: returns.reason,
        refundMethod: returns.refundMethod,
        restockReason: returns.restockReason,
        timestamp: returns.timestamp,
      })
      .from(returns)
      .where(eq(returns.id, returnId))
      .get();

    const createdItems = tx
      .select()
      .from(returnItems)
      .where(eq(returnItems.returnId, returnId))
      .all();

    return {
      ...createdReturn,
      items: createdItems,
      refundAmount: computedRefundAmount,
    };
  });
}

/**
 * Retrieves a return with its return items and computed refundAmount.
 */
export async function getReturnById(id: string) {
  const r = await db
    .select({
      id: returns.id,
      saleId: returns.saleId,
      reason: returns.reason,
      refundMethod: returns.refundMethod,
      restockReason: returns.restockReason,
      timestamp: returns.timestamp,
    })
    .from(returns)
    .where(eq(returns.id, id))
    .get();

  if (!r) {
    return null;
  }

  const items = await db
    .select()
    .from(returnItems)
    .where(eq(returnItems.returnId, id))
    .all();

  let refundAmount = 0;
  const itemsWithPrice = [];

  for (const item of items) {
    const saleItem = await db
      .select()
      .from(saleItems)
      .where(eq(saleItems.id, item.saleItemId))
      .get();
    const price = saleItem ? saleItem.price : 0;
    refundAmount += item.quantity * price;
    itemsWithPrice.push({
      ...item,
      price,
    });
  }

  return {
    ...r,
    items: itemsWithPrice,
    refundAmount,
  };
}

/**
 * Lists returns with optional filtering by terminalId, saleId, and date range on timestamp.
 * Returns consistent objects matching the returns table columns.
 */
export async function listReturns(filter?: ListReturnsFilter) {
  const conditions = [];

  if (filter?.saleId !== undefined) {
    conditions.push(eq(returns.saleId, filter.saleId));
  }
  if (filter?.from !== undefined) {
    conditions.push(gte(returns.timestamp, filter.from));
  }
  if (filter?.to !== undefined) {
    conditions.push(lte(returns.timestamp, filter.to));
  }

  const selectFields = {
    id: returns.id,
    saleId: returns.saleId,
    reason: returns.reason,
    refundMethod: returns.refundMethod,
    restockReason: returns.restockReason,
    timestamp: returns.timestamp,
  };

  let query: any;

  if (filter?.terminalId !== undefined) {
    // Join returns with sales to filter by terminalId
    query = db
      .select(selectFields)
      .from(returns)
      .innerJoin(sales, eq(returns.saleId, sales.id));

    conditions.push(eq(sales.terminalId, filter.terminalId));
  } else {
    query = db.select(selectFields).from(returns);
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  return await query.all();
}
