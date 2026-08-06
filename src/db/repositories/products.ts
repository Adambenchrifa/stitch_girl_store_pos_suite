import { eq, and, or, like } from 'drizzle-orm';
import { db } from '../index';
import { products, productVariants, categories } from '../schema';

export interface CreateProductInput {
  name: string;
  sku: string;
  categoryId: number;
  brand?: string | null;
  description?: string | null;
  basePrice: number; // Stored in cents
}

export interface UpdateProductInput {
  name?: string;
  sku?: string;
  categoryId?: number;
  brand?: string | null;
  description?: string | null;
  basePrice?: number;
}

// Helper to check for duplicate SKU across both products and product variants
export async function isSkuDuplicate(sku: string, excludeProductId?: number, excludeVariantId?: number): Promise<boolean> {
  // Check products
  let productQuery = db.select().from(products).where(eq(products.sku, sku));
  const productWithSku = await productQuery.get();
  if (productWithSku && productWithSku.id !== excludeProductId) {
    return true;
  }

  // Check variants
  let variantQuery = db.select().from(productVariants).where(eq(productVariants.sku, sku));
  const variantWithSku = await variantQuery.get();
  if (variantWithSku && variantWithSku.id !== excludeVariantId) {
    return true;
  }

  return false;
}

export async function createProduct(input: CreateProductInput) {
  if (!input.name || !input.sku || !input.categoryId || input.basePrice === undefined) {
    throw new Error('Product name, sku, categoryId, and basePrice are required');
  }

  // Validate category exists
  const category = await db.select().from(categories).where(eq(categories.id, input.categoryId)).get();
  if (!category) {
    throw new Error(`Category with ID ${input.categoryId} does not exist`);
  }

  // Check unique SKU
  if (await isSkuDuplicate(input.sku)) {
    throw new Error(`The SKU "${input.sku}" is already in use by another product or variant.`);
  }

  const [inserted] = await db.insert(products).values(input).returning();
  if (!inserted) {
    throw new Error('Failed to create product');
  }
  return inserted;
}

export async function listProducts(filter?: { categoryId?: number }) {
  if (filter?.categoryId !== undefined) {
    return await db
      .select()
      .from(products)
      .where(eq(products.categoryId, filter.categoryId))
      .all();
  }
  return await db.select().from(products).all();
}

export async function getProductById(id: number) {
  const product = await db.select().from(products).where(eq(products.id, id)).get();
  if (!product) {
    return null;
  }

  const variants = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, id))
    .all();

  return {
    ...product,
    variants,
  };
}

export async function updateProduct(id: number, input: UpdateProductInput) {
  // If category is changing, validate that new category exists
  if (input.categoryId !== undefined) {
    const category = await db.select().from(categories).where(eq(categories.id, input.categoryId)).get();
    if (!category) {
      throw new Error(`Category with ID ${input.categoryId} does not exist`);
    }
  }

  // If SKU is changing, validate uniqueness
  if (input.sku !== undefined) {
    if (await isSkuDuplicate(input.sku, id)) {
      throw new Error(`The SKU "${input.sku}" is already in use by another product or variant.`);
    }
  }

  const [updated] = await db
    .update(products)
    .set(input)
    .where(eq(products.id, id))
    .returning();

  if (!updated) {
    throw new Error(`Product with ID ${id} not found`);
  }
  return updated;
}

export async function deleteProduct(id: number) {
  const [deleted] = await db
    .delete(products)
    .where(eq(products.id, id))
    .returning();

  if (!deleted) {
    throw new Error(`Product with ID ${id} not found`);
  }
  return deleted;
}

/**
 * Searches product variants by name (on product), SKU (on product), or SKU (on variant).
 * Case-insensitive in SQLite (using LIKE).
 * Calculates the effective price as variant's priceOverride, or product's basePrice as fallback.
 */
export async function searchVariantsByNameOrSku(query: string) {
  const searchTerm = `%${query}%`;

  const results = await db
    .select({
      id: productVariants.id,
      productId: productVariants.productId,
      sku: productVariants.sku,
      priceOverride: productVariants.priceOverride,
      stock: productVariants.stock,
      size: productVariants.size,
      sizeType: productVariants.sizeType,
      color: productVariants.color,
      imageUrl: productVariants.imageUrl,
      createdAt: productVariants.createdAt,
      product: {
        id: products.id,
        name: products.name,
        sku: products.sku,
        basePrice: products.basePrice,
        brand: products.brand,
        description: products.description,
        categoryId: products.categoryId,
      },
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(
      or(
        like(products.name, searchTerm),
        like(productVariants.sku, searchTerm),
        like(products.sku, searchTerm)
      )
    )
    .all();

  return results.map((row) => ({
    ...row,
    price: row.priceOverride !== null && row.priceOverride !== undefined ? row.priceOverride : row.product.basePrice,
  }));
}

/**
 * Lists product variants, optionally filtered by product ID.
 * Calculates the effective price as variant's priceOverride, or product's basePrice as fallback.
 */
export async function listVariants(productId?: number) {
  let queryBuilder = db
    .select({
      id: productVariants.id,
      productId: productVariants.productId,
      sku: productVariants.sku,
      priceOverride: productVariants.priceOverride,
      stock: productVariants.stock,
      size: productVariants.size,
      sizeType: productVariants.sizeType,
      color: productVariants.color,
      imageUrl: productVariants.imageUrl,
      createdAt: productVariants.createdAt,
      product: {
        id: products.id,
        name: products.name,
        sku: products.sku,
        basePrice: products.basePrice,
        brand: products.brand,
        description: products.description,
        categoryId: products.categoryId,
      },
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id));

  if (productId !== undefined) {
    queryBuilder = queryBuilder.where(eq(productVariants.productId, productId)) as any;
  }

  const results = await queryBuilder.all();

  return results.map((row) => ({
    ...row,
    price: row.priceOverride !== null && row.priceOverride !== undefined ? row.priceOverride : row.product.basePrice,
  }));
}
