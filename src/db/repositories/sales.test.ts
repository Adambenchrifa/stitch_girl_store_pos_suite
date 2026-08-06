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
import {
  createSale,
  getSaleById,
  listSales,
  recomputeVariantStock,
} from './sales';
import { eq } from 'drizzle-orm';

describe('Sales Flow Repository', () => {
  let categoryId: number;
  let productId: number;
  let variantId1: number;
  let variantId2: number;
  let terminalId: number;
  let sessionId: number;

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

    // 1. Create a category
    const cat = await createCategory({ name: 'Accessories', type: 'accessory' });
    categoryId = cat.id;

    // 2. Create a product
    const prod = await createProduct({
      name: 'Super Ring',
      sku: 'SKU-RING',
      categoryId: categoryId,
      basePrice: 1500, // 15.00
    });
    productId = prod.id;

    // 3. Create variants
    const v1 = await createVariant({
      productId: productId,
      sku: 'SKU-RING-GOLD-6',
      stock: 10,
      size: '6',
      color: 'Gold',
    });
    variantId1 = v1.id;

    const v2 = await createVariant({
      productId: productId,
      sku: 'SKU-RING-SILVER-7',
      stock: 5,
      size: '7',
      color: 'Silver',
    });
    variantId2 = v2.id;

    // 4. Create a POS terminal
    const terminal = await db
      .insert(posTerminalsTable)
      .values({
        name: 'Terminal Alpha',
        status: 'active',
      })
      .returning()
      .get();
    terminalId = terminal.id;

    // 5. Create a POS session
    const session = await db
      .insert(posSessionsTable)
      .values({
        terminalId: terminalId,
        openedAt: new Date().toISOString(),
        openingBalance: 10000,
        status: 'open',
      })
      .returning()
      .get();
    sessionId = session.id;
  });

  it('should successfully create a normal sale and verify atomic steps', async () => {
    // Create a sale for 2 of Variant 1 and 1 of Variant 2
    const sale = await createSale({
      terminalId,
      sessionId,
      paymentMethod: 'cash',
      items: [
        { variantId: variantId1, qty: 2, price: 1200 }, // selling below basePrice/override is fine
        { variantId: variantId2, qty: 1, price: 1500 },
      ],
    });

    expect(sale.id).toBeDefined();
    expect(typeof sale.id).toBe('string'); // client-side generated UUID
    expect(sale.total).toBe(2 * 1200 + 1 * 1500); // 3900 cents
    expect(sale.items.length).toBe(2);

    // Verify stock_movements were generated with correct negative signed_quantity
    const movements = await db
      .select()
      .from(stockMovementsTable)
      .where(eq(stockMovementsTable.referenceId, sale.id))
      .all();
    expect(movements.length).toBe(2);

    const m1 = movements.find((m) => m.variantId === variantId1);
    expect(m1).toBeDefined();
    expect(m1?.signedQuantity).toBe(-2);
    expect(m1?.type).toBe('sale');

    const m2 = movements.find((m) => m.variantId === variantId2);
    expect(m2).toBeDefined();
    expect(m2?.signedQuantity).toBe(-1);
    expect(m2?.type).toBe('sale');

    // Verify variants cached stock got updated correctly via recomputing
    const updatedV1 = await getVariantById(variantId1);
    const updatedV2 = await getVariantById(variantId2);

    // Note: Since creation initial stock was 10, the new stock must be 8
    // We expect the variants table was updated using the recompute logic.
    // However, wait! Did the initial variant creation insert a stock movement, or did it write to product_variants.stock directly?
    // Let's check: in product_variants, `stock: input.stock ?? 0` is set directly, but no initial stock movement is created by CRUD.
    // If the recomputeVariantStock function only sums stockMovements, then variantId1's stock would be -2 (since there was no initial stock movement).
    // Let's verify this behavior or if initial stock should also be verified/recomputed.
    // Indeed, if product_variants.stock is always recomputed from stock_movements, any manual initial stock or manual adjustments should also be in stock_movements!
    // But our variants CRUD doesn't write to stock_movements. That is fine, our createSale recomputes by summing all movements,
    // so let's verify if that results in -2 or whatever the movements sum to.
    // Wait, the requirement says: "Updates product_variants.stock for each affected variant by recomputing it from stock_movements (sum of all signed_quantity for that variant)".
    // So the new stock is indeed purely the sum of all signed_quantity for that variant.
    // Since only 1 sale movement exists (-2), the recomputed stock is -2.
    // Let's assert exactly that to match the requirements.
    expect(updatedV1?.stock).toBe(-2);
    expect(updatedV2?.stock).toBe(-1);
  });

  it('should allow overselling (stock goes negative) without blocking', async () => {
    const sale = await createSale({
      terminalId,
      sessionId,
      paymentMethod: 'card',
      items: [
        { variantId: variantId1, qty: 50, price: 1000 },
      ],
    });

    expect(sale).toBeDefined();
    expect(sale.total).toBe(50 * 1000);

    const updatedV1 = await getVariantById(variantId1);
    expect(updatedV1?.stock).toBe(-50);
  });

  it('should perform stock recomputation correctly', async () => {
    // Insert some manual mock movements first to check that they are summed correctly by recomputeVariantStock
    await db.insert(stockMovementsTable).values([
      {
        id: 'manual-1',
        productId,
        variantId: variantId1,
        signedQuantity: 15,
        type: 'manual_adjustment',
        timestamp: new Date().toISOString(),
      },
      {
        id: 'manual-2',
        productId,
        variantId: variantId1,
        signedQuantity: -3,
        type: 'sale',
        timestamp: new Date().toISOString(),
      },
    ]);

    const stockSum = await recomputeVariantStock(variantId1);
    expect(stockSum).toBe(12); // 15 - 3

    // Now, perform a sale through createSale
    await createSale({
      terminalId,
      sessionId,
      paymentMethod: 'cash',
      items: [
        { variantId: variantId1, qty: 5, price: 1000 },
      ],
    });

    const updatedV1 = await getVariantById(variantId1);
    expect(updatedV1?.stock).toBe(7); // 12 - 5 = 7
  });

  it('should rollback the entire transaction on failure (such as invalid variant ID)', async () => {
    const initialSalesCount = (await listSales()).length;

    // Attempting to create a sale where one variant is invalid
    await expect(
      createSale({
        terminalId,
        sessionId,
        paymentMethod: 'cash',
        items: [
          { variantId: variantId1, qty: 2, price: 1000 },
          { variantId: 999999, qty: 1, price: 1000 }, // invalid variantId
        ],
      })
    ).rejects.toThrow();

    // Verify no sale was created
    const finalSales = await listSales();
    expect(finalSales.length).toBe(initialSalesCount);

    // Verify no stock movements were added
    const movements = await db.select().from(stockMovementsTable).all();
    expect(movements.length).toBe(0);

    // Verify stock was not modified
    const updatedV1 = await getVariantById(variantId1);
    expect(updatedV1?.stock).toBe(10); // restored/not modified during rollback because it failed before commit
  });

  it('should fetch sale by ID with its line items included', async () => {
    const sale = await createSale({
      terminalId,
      sessionId,
      paymentMethod: 'cash',
      items: [
        { variantId: variantId1, qty: 2, price: 1200 },
      ],
    });

    const fetched = await getSaleById(sale.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(sale.id);
    expect(fetched?.items.length).toBe(1);
    expect(fetched?.items[0]?.variantId).toBe(variantId1);
    expect(fetched?.items[0]?.qty).toBe(2);
    expect(fetched?.items[0]?.price).toBe(1200);

    // If fetched with an invalid ID, should return null
    const nonExistent = await getSaleById('non-existent-uuid');
    expect(nonExistent).toBeNull();
  });

  it('should list sales with terminalId and date range filters', async () => {
    // Create sales at different times / with different terminals
    const sale1 = await createSale({
      terminalId,
      sessionId,
      paymentMethod: 'cash',
      items: [{ variantId: variantId1, qty: 1, price: 1000 }],
    });

    // Create another terminal and session for second sale
    const secondTerminal = await db
      .insert(posTerminalsTable)
      .values({
        name: 'Terminal Beta',
        status: 'active',
      })
      .returning()
      .get();

    const secondSession = await db
      .insert(posSessionsTable)
      .values({
        terminalId: secondTerminal.id,
        openedAt: new Date().toISOString(),
        openingBalance: 5000,
        status: 'open',
      })
      .returning()
      .get();

    const sale2 = await createSale({
      terminalId: secondTerminal.id,
      sessionId: secondSession.id,
      paymentMethod: 'card',
      items: [{ variantId: variantId1, qty: 2, price: 1500 }],
    });

    // List all sales
    const allSales = await listSales();
    expect(allSales.length).toBe(2);

    // Filter by terminal ID
    const terminal1Sales = await listSales({ terminalId });
    expect(terminal1Sales.length).toBe(1);
    expect(terminal1Sales[0]?.id).toBe(sale1.id);

    const terminal2Sales = await listSales({ terminalId: secondTerminal.id });
    expect(terminal2Sales.length).toBe(1);
    expect(terminal2Sales[0]?.id).toBe(sale2.id);

    // Filter by date range (from / to on timestamp)
    const timestamp1 = sale1.timestamp;
    const timestamp2 = sale2.timestamp;

    // Both should be in range
    const inRange = await listSales({
      from: new Date(Date.now() - 60000).toISOString(),
      to: new Date(Date.now() + 60000).toISOString(),
    });
    expect(inRange.length).toBe(2);

    // Just sale1
    const onlySale1 = await listSales({
      from: new Date(Date.now() - 60000).toISOString(),
      to: timestamp1,
    });
    expect(onlySale1.length).toBe(1);
    expect(onlySale1[0]?.id).toBe(sale1.id);

    // Future range should return empty
    const futureSales = await listSales({
      from: new Date(Date.now() + 60000).toISOString(),
    });
    expect(futureSales.length).toBe(0);
  });
});
