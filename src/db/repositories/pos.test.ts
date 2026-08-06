import { describe, it, expect, beforeEach, vi } from 'vitest';
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
import { createProduct, searchVariantsByNameOrSku, listVariants } from './products';
import { createVariant } from './variants';
import { registerIpcHandlers } from '../../ipc/main';

describe('POS UI Repository Functions', () => {
  let categoryId: number;
  let productId1: number;
  let productId2: number;
  let variantId1: number;
  let variantId2: number;
  let variantId3: number;

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

    // Create a Category
    const cat = await createCategory({ name: 'Apparel', type: 'clothing' });
    categoryId = cat.id;

    // Create Products
    const prod1 = await createProduct({
      name: 'Denim Jacket',
      sku: 'JKT-DENIM',
      categoryId: categoryId,
      basePrice: 8000, // $80.00
    });
    productId1 = prod1.id;

    const prod2 = await createProduct({
      name: 'Leather Boots',
      sku: 'BTS-LEATHER',
      categoryId: categoryId,
      basePrice: 12000, // $120.00
    });
    productId2 = prod2.id;

    // Create Variants
    // Variant 1: uses parent basePrice as price fallback
    const v1 = await createVariant({
      productId: productId1,
      sku: 'JKT-DENIM-S-BLUE',
      stock: 15,
      size: 'S',
      color: 'Blue',
    });
    variantId1 = v1.id;

    // Variant 2: has price override
    const v2 = await createVariant({
      productId: productId1,
      sku: 'JKT-DENIM-M-BLUE',
      priceOverride: 8500, // $85.00
      stock: 12,
      size: 'M',
      color: 'Blue',
    });
    variantId2 = v2.id;

    // Variant 3: on second product, uses basePrice fallback
    const v3 = await createVariant({
      productId: productId2,
      sku: 'BTS-LTHR-9-BRN',
      stock: 8,
      size: '9',
      color: 'Brown',
    });
    variantId3 = v3.id;
  });

  describe('listVariants', () => {
    it('should list all variants with parent product info and fallback/override price computed', async () => {
      const results = await listVariants();
      expect(results.length).toBe(3);

      // JKT-DENIM-S-BLUE (Variant 1) should have fallback price of $80.00 (8000 cents)
      const r1 = results.find((v) => v.id === variantId1);
      expect(r1).toBeDefined();
      expect(r1?.sku).toBe('JKT-DENIM-S-BLUE');
      expect(r1?.price).toBe(8000);
      expect(r1?.product.name).toBe('Denim Jacket');
      expect(r1?.stock).toBe(15);

      // JKT-DENIM-M-BLUE (Variant 2) should have override price of $85.00 (8500 cents)
      const r2 = results.find((v) => v.id === variantId2);
      expect(r2).toBeDefined();
      expect(r2?.sku).toBe('JKT-DENIM-M-BLUE');
      expect(r2?.price).toBe(8500);
      expect(r2?.product.name).toBe('Denim Jacket');
      expect(r2?.stock).toBe(12);

      // BTS-LTHR-9-BRN (Variant 3) should have fallback price of $120.00 (12000 cents)
      const r3 = results.find((v) => v.id === variantId3);
      expect(r3).toBeDefined();
      expect(r3?.sku).toBe('BTS-LTHR-9-BRN');
      expect(r3?.price).toBe(12000);
      expect(r3?.product.name).toBe('Leather Boots');
    });

    it('should list variants filtered by product ID', async () => {
      const results = await listVariants(productId1);
      expect(results.length).toBe(2);
      expect(results.every((v) => v.productId === productId1)).toBe(true);

      const r1 = results.find((v) => v.id === variantId1);
      expect(r1).toBeDefined();

      const r2 = results.find((v) => v.id === variantId2);
      expect(r2).toBeDefined();
    });
  });

  describe('searchVariantsByNameOrSku', () => {
    it('should find variants matching query on product name (case-insensitive)', async () => {
      // search for "denim"
      const results = await searchVariantsByNameOrSku('denim');
      expect(results.length).toBe(2);
      expect(results.every((v) => v.product.name === 'Denim Jacket')).toBe(true);
    });

    it('should find variants matching query on variant SKU (case-insensitive)', async () => {
      // search for "LTHR" (part of BTS-LTHR-9-BRN)
      const results = await searchVariantsByNameOrSku('LTHR');
      expect(results.length).toBe(1);
      expect(results[0]?.id).toBe(variantId3);
      expect(results[0]?.sku).toBe('BTS-LTHR-9-BRN');
      expect(results[0]?.price).toBe(12000);
    });

    it('should find variants matching query on parent product SKU', async () => {
      // search for parent SKU "BTS-LEATHER"
      const results = await searchVariantsByNameOrSku('BTS-LEATHER');
      expect(results.length).toBe(1);
      expect(results[0]?.id).toBe(variantId3);
    });

    it('should return empty list if no match is found', async () => {
      const results = await searchVariantsByNameOrSku('NonExistentSomething');
      expect(results.length).toBe(0);
    });
  });

  describe('registerIpcHandlers Integration', () => {
    it('should register all three correct IPC handlers and call repository functions', async () => {
      const registeredHandlers: Record<string, Function> = {};
      const mockIpcMain = {
        handle: vi.fn((channel: string, callback: Function) => {
          registeredHandlers[channel] = callback;
        }),
      };

      // Register the handlers
      registerIpcHandlers(mockIpcMain);

      // Verify that handlers were registered for the three expected channels
      expect(mockIpcMain.handle).toHaveBeenCalledWith('products:listVariants', expect.any(Function));
      expect(mockIpcMain.handle).toHaveBeenCalledWith('products:searchByNameOrSku', expect.any(Function));
      expect(mockIpcMain.handle).toHaveBeenCalledWith('sales:create', expect.any(Function));

      // Test 'products:listVariants' handler call
      const listResult = await registeredHandlers['products:listVariants'](null, productId1);
      expect(listResult.length).toBe(2);
      expect(listResult[0].productId).toBe(productId1);

      // Test 'products:searchByNameOrSku' handler call
      const searchResult = await registeredHandlers['products:searchByNameOrSku'](null, 'Boots');
      expect(searchResult.length).toBe(1);
      expect(searchResult[0].id).toBe(variantId3);
    });
  });
});
