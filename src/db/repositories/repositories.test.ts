import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../index';
import {
  categories as categoriesTable,
  products as productsTable,
  productVariants as productVariantsTable,
  posSessions as posSessionsTable,
  posTerminals as posTerminalsTable,
  sales as salesTable,
  saleItems as saleItemsTable,
  stockMovements as stockMovementsTable,
  returns as returnsTable,
  returnItems as returnItemsTable,
  stockAlerts as stockAlertsTable,
} from '../schema';
import {
  createCategory,
  listCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
} from './categories';
import {
  createProduct,
  listProducts,
  getProductById,
  updateProduct,
  deleteProduct,
} from './products';
import {
  createVariant,
  listVariantsByProductId,
  getVariantById,
  updateVariant,
  deleteVariant,
} from './variants';

describe('CRUD Repositories', () => {
  beforeEach(() => {
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
  });

  describe('Categories CRUD', () => {
    it('should create, list, get, update, and delete a category', async () => {
      // 1. Create
      const cat = await createCategory({ name: 'Clothing', type: 'clothing' });
      expect(cat.id).toBeDefined();
      expect(cat.name).toBe('Clothing');
      expect(cat.type).toBe('clothing');

      // 2. List
      const list = await listCategories();
      expect(list.length).toBe(1);
      expect(list[0]?.name).toBe('Clothing');

      // 3. Get by ID
      const fetched = await getCategoryById(cat.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.name).toBe('Clothing');

      // 4. Update
      const updated = await updateCategory(cat.id, { name: 'Apparel' });
      expect(updated.name).toBe('Apparel');

      // 5. Delete
      const deleted = await deleteCategory(cat.id);
      expect(deleted.id).toBe(cat.id);

      // Verify deletion
      const check = await getCategoryById(cat.id);
      expect(check).toBeNull();
    });

    it('should reject deleting a category if products reference it', async () => {
      const cat = await createCategory({ name: 'Shoes', type: 'accessory' });
      await createProduct({
        name: 'Sneakers',
        sku: 'SKU-SNEAKERS',
        categoryId: cat.id,
        basePrice: 5000,
      });

      await expect(deleteCategory(cat.id)).rejects.toThrow(
        `Cannot delete category with ID ${cat.id} because it is referenced by existing products.`
      );
    });
  });

  describe('Products CRUD', () => {
    it('should create, list, get, update, and delete a product', async () => {
      const cat = await createCategory({ name: 'Dresses', type: 'clothing' });

      // 1. Create
      const prod = await createProduct({
        name: 'Summer Dress',
        sku: 'SKU-DRESS-SUMMER',
        categoryId: cat.id,
        basePrice: 2999,
      });
      expect(prod.id).toBeDefined();
      expect(prod.name).toBe('Summer Dress');

      // 2. List (with optional category filter)
      const listAll = await listProducts();
      expect(listAll.length).toBe(1);

      const listFiltered = await listProducts({ categoryId: cat.id });
      expect(listFiltered.length).toBe(1);

      const listEmpty = await listProducts({ categoryId: 99999 });
      expect(listEmpty.length).toBe(0);

      // 3. Get by ID (includes variants)
      const fetched = await getProductById(prod.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.name).toBe('Summer Dress');
      expect(fetched?.variants).toEqual([]);

      // 4. Update
      const updated = await updateProduct(prod.id, { basePrice: 3499 });
      expect(updated.basePrice).toBe(3499);

      // 5. Delete
      const deleted = await deleteProduct(prod.id);
      expect(deleted.id).toBe(prod.id);
    });

    it('should reject creating or updating a product with a duplicate SKU', async () => {
      const cat = await createCategory({ name: 'Dresses', type: 'clothing' });
      await createProduct({
        name: 'Summer Dress',
        sku: 'SKU-DUPLICATE',
        categoryId: cat.id,
        basePrice: 2999,
      });

      // Try creating another product with the same SKU
      await expect(
        createProduct({
          name: 'Winter Dress',
          sku: 'SKU-DUPLICATE',
          categoryId: cat.id,
          basePrice: 3999,
        })
      ).rejects.toThrow('already in use');

      // Try updating an existing product's SKU to a duplicate one
      const prod2 = await createProduct({
        name: 'Spring Dress',
        sku: 'SKU-SPRING',
        categoryId: cat.id,
        basePrice: 1999,
      });

      await expect(
        updateProduct(prod2.id, { sku: 'SKU-DUPLICATE' })
      ).rejects.toThrow('already in use');
    });
  });

  describe('Product Variants CRUD', () => {
    it('should create, list, get, update, and delete a product variant', async () => {
      const cat = await createCategory({ name: 'Dresses', type: 'clothing' });
      const prod = await createProduct({
        name: 'Summer Dress',
        sku: 'SKU-DRESS-SUMMER',
        categoryId: cat.id,
        basePrice: 2999,
      });

      // 1. Create Variant
      const variant = await createVariant({
        productId: prod.id,
        sku: 'SKU-DRESS-SUMMER-SM',
        stock: 10,
        size: 'S',
        sizeType: 'letter',
        color: 'Red',
      });
      expect(variant.id).toBeDefined();
      expect(variant.productId).toBe(prod.id);
      expect(variant.stock).toBe(10);

      // 2. List variants by product_id
      const variantsList = await listVariantsByProductId(prod.id);
      expect(variantsList.length).toBe(1);
      expect(variantsList[0]?.sku).toBe('SKU-DRESS-SUMMER-SM');

      // Get by product ID should now include the variant
      const prodWithVariants = await getProductById(prod.id);
      expect(prodWithVariants?.variants.length).toBe(1);
      expect(prodWithVariants?.variants[0]?.id).toBe(variant.id);

      // 3. Get Variant by ID
      const fetched = await getVariantById(variant.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.sku).toBe('SKU-DRESS-SUMMER-SM');

      // 4. Update Variant
      const updated = await updateVariant(variant.id, { stock: 15 });
      expect(updated.stock).toBe(15);

      // 5. Delete Variant
      const deleted = await deleteVariant(variant.id);
      expect(deleted.id).toBe(variant.id);
    });

    it('should cascade delete variants when product is deleted', async () => {
      const cat = await createCategory({ name: 'Dresses', type: 'clothing' });
      const prod = await createProduct({
        name: 'Summer Dress',
        sku: 'SKU-DRESS-SUMMER',
        categoryId: cat.id,
        basePrice: 2999,
      });

      const variant = await createVariant({
        productId: prod.id,
        sku: 'SKU-DRESS-SUMMER-SM',
        stock: 10,
      });

      // Delete the product
      await deleteProduct(prod.id);

      // Check if variant has been deleted by SQLite Cascade
      const fetchedVariant = await getVariantById(variant.id);
      expect(fetchedVariant).toBeNull();
    });

    it('should reject variant creation with negative stock', async () => {
      const cat = await createCategory({ name: 'Dresses', type: 'clothing' });
      const prod = await createProduct({
        name: 'Summer Dress',
        sku: 'SKU-DRESS-SUMMER',
        categoryId: cat.id,
        basePrice: 2999,
      });

      await expect(
        createVariant({
          productId: prod.id,
          sku: 'SKU-DRESS-SUMMER-SM',
          stock: -5,
        })
      ).rejects.toThrow('Initial stock cannot be negative');
    });

    it('should reject creating or updating a variant with a duplicate SKU', async () => {
      const cat = await createCategory({ name: 'Dresses', type: 'clothing' });
      const prod = await createProduct({
        name: 'Summer Dress',
        sku: 'SKU-DRESS-SUMMER',
        categoryId: cat.id,
        basePrice: 2999,
      });

      // Product SKU: SKU-DRESS-SUMMER
      // Try to create variant with product's SKU
      await expect(
        createVariant({
          productId: prod.id,
          sku: 'SKU-DRESS-SUMMER',
          stock: 5,
        })
      ).rejects.toThrow('already in use');

      // Create a unique variant SKU
      const variant1 = await createVariant({
        productId: prod.id,
        sku: 'SKU-VARIANT-1',
        stock: 5,
      });

      // Create second variant
      const variant2 = await createVariant({
        productId: prod.id,
        sku: 'SKU-VARIANT-2',
        stock: 5,
      });

      // Try updating variant2's SKU to variant1's SKU
      await expect(
        updateVariant(variant2.id, { sku: 'SKU-VARIANT-1' })
      ).rejects.toThrow('already in use');
    });
  });
});
