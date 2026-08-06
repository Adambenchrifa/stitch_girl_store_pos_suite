import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../index';
import {
  categories as categoriesTable,
  products as productsTable,
  productVariants as productVariantsTable,
  stockMovements as stockMovementsTable,
  sales as salesTable,
  saleItems as saleItemsTable,
} from '../schema';
import { createCategory, deleteCategory, listCategories } from './categories';
import { createProduct, deleteProduct, listProductsWithVariants, getProductById } from './products';
import { createVariant } from './variants';
import { registerIpcHandlers } from '../../ipc/main';

describe('Products Management Flow Repository & IPC', () => {
  let categoryId: number;
  let productId1: number;
  let variantId1: number;

  beforeEach(async () => {
    // Clear tables in reverse dependency order
    db.delete(saleItemsTable).run();
    db.delete(salesTable).run();
    db.delete(stockMovementsTable).run();
    db.delete(productVariantsTable).run();
    db.delete(productsTable).run();
    db.delete(categoriesTable).run();

    // 1. Create category
    const cat = await createCategory({ name: 'Activewear', type: 'clothing' });
    categoryId = cat.id;

    // 2. Create product
    const prod = await createProduct({
      name: 'Running Shorts',
      sku: 'RUN-SHRT-01',
      categoryId: categoryId,
      basePrice: 4500, // $45.00
    });
    productId1 = prod.id;

    // 3. Create variant
    const variant = await createVariant({
      productId: productId1,
      sku: 'RUN-SHRT-01-S-BLK',
      stock: 20,
      size: 'S',
      color: 'Black',
    });
    variantId1 = variant.id;
  });

  describe('listProductsWithVariants', () => {
    it('should fetch all products grouped with their variants and category names', async () => {
      const results = await listProductsWithVariants();
      expect(results.length).toBe(1);

      const p = results[0];
      expect(p).toBeDefined();
      expect(p?.name).toBe('Running Shorts');
      expect(p?.categoryName).toBe('Activewear');
      expect(p?.variants.length).toBe(1);
      expect(p?.variants[0]?.sku).toBe('RUN-SHRT-01-S-BLK');
    });
  });

  describe('Category Referenced Constraint', () => {
    it('should reject deleting a category if existing products reference it', async () => {
      await expect(deleteCategory(categoryId)).rejects.toThrow(
        `Cannot delete category with ID ${categoryId} because it is referenced by existing products.`
      );
    });

    it('should allow deleting a category if no products reference it', async () => {
      const extraCat = await createCategory({ name: 'Shoes', type: 'clothing' });

      const initialCount = (await listCategories()).length;
      await deleteCategory(extraCat.id);

      const finalCount = (await listCategories()).length;
      expect(finalCount).toBe(initialCount - 1);
    });
  });

  describe('Product Creation SKU Conflict', () => {
    it('should reject creating a product with a duplicate SKU', async () => {
      await expect(
        createProduct({
          name: 'Conflict Shorts',
          sku: 'RUN-SHRT-01', // duplicate product SKU
          categoryId: categoryId,
          basePrice: 3000,
        })
      ).rejects.toThrow();

      await expect(
        createProduct({
          name: 'Conflict Variant SKU',
          sku: 'RUN-SHRT-01-S-BLK', // duplicate variant SKU
          categoryId: categoryId,
          basePrice: 3000,
        })
      ).rejects.toThrow();
    });
  });

  describe('Cascading Product Deletion', () => {
    it('should delete variants from product_variants when parent product is deleted', async () => {
      // Confirm variant exists
      const variantsBefore = await db
        .select()
        .from(productVariantsTable)
        .all();
      expect(variantsBefore.length).toBe(1);

      // Delete parent product
      await deleteProduct(productId1);

      // Confirm product is deleted
      const prod = await getProductById(productId1);
      expect(prod).toBeNull();

      // Confirm variant is cascaded deleted
      const variantsAfter = await db
        .select()
        .from(productVariantsTable)
        .all();
      expect(variantsAfter.length).toBe(0);
    });
  });

  describe('registerIpcHandlers Integration for Products Management', () => {
    it('should register products, variants, and categories handlers and invoke properly', async () => {
      const registeredHandlers: Record<string, Function> = {};
      const mockIpcMain = {
        handle: vi.fn((channel: string, callback: Function) => {
          registeredHandlers[channel] = callback;
        }),
      };

      registerIpcHandlers(mockIpcMain);

      // Verify channel handles are registered
      expect(mockIpcMain.handle).toHaveBeenCalledWith('products:list', expect.any(Function));
      expect(mockIpcMain.handle).toHaveBeenCalledWith('products:create', expect.any(Function));
      expect(mockIpcMain.handle).toHaveBeenCalledWith('products:delete', expect.any(Function));
      expect(mockIpcMain.handle).toHaveBeenCalledWith('variants:create', expect.any(Function));
      expect(mockIpcMain.handle).toHaveBeenCalledWith('variants:delete', expect.any(Function));
      expect(mockIpcMain.handle).toHaveBeenCalledWith('categories:list', expect.any(Function));
      expect(mockIpcMain.handle).toHaveBeenCalledWith('categories:delete', expect.any(Function));

      // Test 'products:list' handler
      const listResult = await registeredHandlers['products:list']();
      expect(listResult.length).toBe(1);
      expect(listResult[0].sku).toBe('RUN-SHRT-01');

      // Test 'categories:list' handler
      const catList = await registeredHandlers['categories:list']();
      expect(catList.length).toBe(1);
      expect(catList[0].name).toBe('Activewear');
    });
  });
});
