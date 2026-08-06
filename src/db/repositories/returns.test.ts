import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../index';
import {
  categories as categoriesTable,
  products as productsTable,
  productVariants as productVariantsTable,
  posTerminals as posTerminalsTable,
  posSessions as posSessionsTable,
  sales as salesTable,
  saleItems as saleItemsTable,
  stockMovements as stockMovementsTable,
  returns as returnsTable,
  returnItems as returnItemsTable,
  stockAlerts as stockAlertsTable,
} from '../schema';
import { createCategory } from './categories';
import { createProduct } from './products';
import { createVariant, getVariantById } from './variants';
import { createSale } from './sales';
import { createReturn, getReturnById, listReturns } from './returns';
import { eq } from 'drizzle-orm';

describe('Returns Flow Repository', () => {
  let categoryId: number;
  let productId: number;
  let variantId1: number;
  let variantId2: number;
  let terminalId: number;
  let sessionId: number;
  let saleId: string;
  let saleItemId1: string;
  let saleItemId2: string;

  beforeEach(async () => {
    // Clear tables in reverse dependency order
    db.delete(stockAlertsTable).run();
    db.delete(returnItemsTable).run();
    db.delete(returnsTable).run();
    db.delete(stockMovementsTable).run();
    db.delete(saleItemsTable).run();
    db.delete(salesTable).run();
    db.delete(posSessionsTable).run();
    db.delete(posTerminalsTable).run();
    db.delete(productVariantsTable).run();
    db.delete(productsTable).run();
    db.delete(categoriesTable).run();

    // 1. Create category
    const cat = await createCategory({ name: 'Clothing', type: 'clothing' });
    categoryId = cat.id;

    // 2. Create product
    const prod = await createProduct({
      name: 'Cool Jacket',
      sku: 'SKU-JACKET',
      categoryId: categoryId,
      basePrice: 5000,
    });
    productId = prod.id;

    // 3. Create variants
    const v1 = await createVariant({
      productId: productId,
      sku: 'SKU-JACKET-M',
      stock: 0,
      size: 'M',
      color: 'Blue',
    });
    variantId1 = v1.id;

    const v2 = await createVariant({
      productId: productId,
      sku: 'SKU-JACKET-L',
      stock: 0,
      size: 'L',
      color: 'Blue',
    });
    variantId2 = v2.id;

    // 4. Create POS terminal
    const terminal = await db
      .insert(posTerminalsTable)
      .values({ name: 'Terminal Main', status: 'active' })
      .returning()
      .get();
    terminalId = terminal.id;

    // 5. Create POS session
    const session = await db
      .insert(posSessionsTable)
      .values({
        terminalId,
        openedAt: new Date().toISOString(),
        openingBalance: 20000,
        status: 'open',
      })
      .returning()
      .get();
    sessionId = session.id;

    // 6. Create a Sale
    const sale = await createSale({
      terminalId,
      sessionId,
      paymentMethod: 'cash',
      items: [
        { variantId: variantId1, qty: 5, price: 4500 }, // Total: 22500
        { variantId: variantId2, qty: 2, price: 4800 }, // Total: 9600
      ],
    });

    saleId = sale.id;
    saleItemId1 = sale.items.find((item: any) => item.variantId === variantId1).id;
    saleItemId2 = sale.items.find((item: any) => item.variantId === variantId2).id;

    // Ensure initial stock is updated based on sale movements
    // variantId1 was 0, now should be -5
    // variantId2 was 0, now should be -2
    expect((await getVariantById(variantId1))?.stock).toBe(-5);
    expect((await getVariantById(variantId2))?.stock).toBe(-2);
  });

  it('should process a total return (all items resalable) and correctly restock product variants', async () => {
    const returnRecord = await createReturn(saleId, [
      { saleItemId: saleItemId1, quantity: 5, restockDecision: 'resalable' },
      { saleItemId: saleItemId2, quantity: 2, restockDecision: 'resellable' },
    ], 'Customer changed their mind', 'cash');

    expect(returnRecord).toBeDefined();
    expect(returnRecord.id).toBeDefined();
    expect(returnRecord.refundAmount).toBe(5 * 4500 + 2 * 4800); // 32100 cents
    expect(returnRecord.items.length).toBe(2);

    // Verify stock movements
    const movements = await db
      .select()
      .from(stockMovementsTable)
      .where(eq(stockMovementsTable.referenceId, returnRecord.id))
      .all();
    expect(movements.length).toBe(2);

    const m1 = movements.find((m) => m.variantId === variantId1);
    expect(m1).toBeDefined();
    expect(m1?.signedQuantity).toBe(5);
    expect(m1?.type).toBe('return');

    const m2 = movements.find((m) => m.variantId === variantId2);
    expect(m2).toBeDefined();
    expect(m2?.signedQuantity).toBe(2);
    expect(m2?.type).toBe('return');

    // Verify product_variants stock got recomputed and updated correctly
    expect((await getVariantById(variantId1))?.stock).toBe(0); // -5 + 5
    expect((await getVariantById(variantId2))?.stock).toBe(0); // -2 + 2
  });

  it('should process a partial return and handle subsequent partial returns correctly', async () => {
    // 1. First partial return
    const firstReturn = await createReturn(saleId, [
      { saleItemId: saleItemId1, quantity: 2, restockDecision: 'resalable' },
    ], 'Sizing issue');

    expect(firstReturn.refundAmount).toBe(2 * 4500); // 9000 cents
    expect((await getVariantById(variantId1))?.stock).toBe(-3); // -5 + 2 = -3

    // 2. Second partial return of same item
    const secondReturn = await createReturn(saleId, [
      { saleItemId: saleItemId1, quantity: 2, restockDecision: 'resalable' },
    ], 'Still too big');

    expect(secondReturn.refundAmount).toBe(2 * 4500); // 9000 cents
    expect((await getVariantById(variantId1))?.stock).toBe(-1); // -3 + 2 = -1

    // 3. Attempt to return more than sold (5 sold, 4 already returned, trying to return 2)
    await expect(
      createReturn(saleId, [
        { saleItemId: saleItemId1, quantity: 2, restockDecision: 'resalable' },
      ])
    ).rejects.toThrow();

    // 4. Return the exact remaining quantity
    const finalReturn = await createReturn(saleId, [
      { saleItemId: saleItemId1, quantity: 1, restockDecision: 'resalable' },
    ]);
    expect(finalReturn.refundAmount).toBe(1 * 4500);
    expect((await getVariantById(variantId1))?.stock).toBe(0); // -1 + 1 = 0
  });

  it('should process a return with non-restockable reason/motif and NOT update stock', async () => {
    const returnRecord = await createReturn(saleId, [
      { saleItemId: saleItemId1, quantity: 3, restockDecision: 'defective' },
      { saleItemId: saleItemId2, quantity: 1, restockDecision: 'damaged' },
    ], 'Damaged goods', 'card');

    expect(returnRecord.refundAmount).toBe(3 * 4500 + 1 * 4800); // 18300 cents

    // Verify stock movements: there should be NO stock movements because both decisions are non-restockable
    const movements = await db
      .select()
      .from(stockMovementsTable)
      .where(eq(stockMovementsTable.referenceId, returnRecord.id))
      .all();
    expect(movements.length).toBe(0);

    // Verify stocks have NOT changed
    expect((await getVariantById(variantId1))?.stock).toBe(-5);
    expect((await getVariantById(variantId2))?.stock).toBe(-2);
  });

  it('should process mixed restock decisions correctly', async () => {
    const returnRecord = await createReturn(saleId, [
      { saleItemId: saleItemId1, quantity: 2, restockDecision: 'resalable' }, // 2 returned to shelf
      { saleItemId: saleItemId1, quantity: 1, restockDecision: 'damaged' },   // 1 discarded
    ], 'Mixed return quality');

    expect(returnRecord.refundAmount).toBe(3 * 4500); // Refunded 3 items regardless of restock decision

    // Verify stock movements: only the resalable ones should create movements
    const movements = await db
      .select()
      .from(stockMovementsTable)
      .where(eq(stockMovementsTable.referenceId, returnRecord.id))
      .all();
    expect(movements.length).toBe(1);
    expect(movements[0].signedQuantity).toBe(2);
    expect(movements[0].variantId).toBe(variantId1);

    // Stock for variantId1 should be updated by +2
    expect((await getVariantById(variantId1))?.stock).toBe(-3); // -5 + 2 = -3
  });

  it('should reject a return if quantity exceeds original sold quantity minus already returned', async () => {
    // Return 3 first
    await createReturn(saleId, [
      { saleItemId: saleItemId1, quantity: 3, restockDecision: 'resalable' },
    ]);

    // Attempting to return 3 more should fail (only 2 left)
    await expect(
      createReturn(saleId, [
        { saleItemId: saleItemId1, quantity: 3, restockDecision: 'resalable' },
      ])
    ).rejects.toThrow();
  });

  it('should reject a return if sale does not exist or sale item does not exist', async () => {
    // 1. Invalid sale ID
    await expect(
      createReturn('invalid-sale-uuid', [
        { saleItemId: saleItemId1, quantity: 1, restockDecision: 'resalable' },
      ])
    ).rejects.toThrow();

    // 2. Invalid sale item ID
    await expect(
      createReturn(saleId, [
        { saleItemId: 'invalid-sale-item-uuid', quantity: 1, restockDecision: 'resalable' },
      ])
    ).rejects.toThrow();
  });

  it('should fetch a return by ID with its items and computed refundAmount', async () => {
    const created = await createReturn(saleId, [
      { saleItemId: saleItemId1, quantity: 2, restockDecision: 'resalable' },
    ], 'Refund please', 'store_credit');

    const fetched = await getReturnById(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.refundAmount).toBe(2 * 4500);
    expect(fetched?.refundMethod).toBe('store_credit');
    expect(fetched?.items.length).toBe(1);
    expect(fetched?.items[0].price).toBe(4500);
    expect(fetched?.items[0].quantity).toBe(2);
    expect(fetched?.items[0].restockDecision).toBe('resalable');

    // Non-existent ID
    const nonExistent = await getReturnById('non-existent-uuid');
    expect(nonExistent).toBeNull();
  });

  it('should list returns with terminal, date range, and sale filters', async () => {
    const returnRecord1 = await createReturn(saleId, [
      { saleItemId: saleItemId1, quantity: 1, restockDecision: 'resalable' },
    ]);

    // Create a second terminal and session and sale
    const secondTerminal = await db
      .insert(posTerminalsTable)
      .values({ name: 'Terminal Auxiliary', status: 'active' })
      .returning()
      .get();

    const secondSession = await db
      .insert(posSessionsTable)
      .values({
        terminalId: secondTerminal.id,
        openedAt: new Date().toISOString(),
        openingBalance: 15000,
        status: 'open',
      })
      .returning()
      .get();

    const sale2 = await createSale({
      terminalId: secondTerminal.id,
      sessionId: secondSession.id,
      paymentMethod: 'card',
      items: [{ variantId: variantId1, qty: 1, price: 4500 }],
    });

    const sale2Item = sale2.items[0].id;
    const returnRecord2 = await createReturn(sale2.id, [
      { saleItemId: sale2Item, quantity: 1, restockDecision: 'resalable' },
    ]);

    // 1. List all returns
    const all = await listReturns();
    expect(all.length).toBe(2);

    // 2. Filter by terminalId
    const terminal1Returns = await listReturns({ terminalId });
    expect(terminal1Returns.length).toBe(1);
    expect(terminal1Returns[0].id).toBe(returnRecord1.id);

    const terminal2Returns = await listReturns({ terminalId: secondTerminal.id });
    expect(terminal2Returns.length).toBe(1);
    expect(terminal2Returns[0].id).toBe(returnRecord2.id);

    // 3. Filter by saleId
    const sale2Returns = await listReturns({ saleId: sale2.id });
    expect(sale2Returns.length).toBe(1);
    expect(sale2Returns[0].id).toBe(returnRecord2.id);

    // 4. Filter by date range
    const futureReturns = await listReturns({
      from: new Date(Date.now() + 60000).toISOString(),
    });
    expect(futureReturns.length).toBe(0);

    const pastReturns = await listReturns({
      from: new Date(Date.now() - 60000).toISOString(),
      to: new Date(Date.now() + 60000).toISOString(),
    });
    expect(pastReturns.length).toBe(2);
  });
});
