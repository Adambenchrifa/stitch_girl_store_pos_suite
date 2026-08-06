import { eq } from 'drizzle-orm';
import { db } from '../index';
import { productVariants, products } from '../schema';
import { isSkuDuplicate } from './products';

export interface CreateVariantInput {
  productId: number;
  sku: string;
  priceOverride?: number | null;
  stock?: number;
  size?: string | null;
  sizeType?: 'letter' | 'numeric' | 'one_size' | null;
  color?: string | null;
  imageUrl?: string | null;
}

export interface UpdateVariantInput {
  sku?: string;
  priceOverride?: number | null;
  stock?: number;
  size?: string | null;
  sizeType?: 'letter' | 'numeric' | 'one_size' | null;
  color?: string | null;
  imageUrl?: string | null;
}

export async function createVariant(input: CreateVariantInput) {
  if (!input.productId || !input.sku) {
    throw new Error('Variant productId and sku are required');
  }

  // Stock must NOT be set below 0 directly at creation
  if (input.stock !== undefined && input.stock < 0) {
    throw new Error('Initial stock cannot be negative');
  }

  // Validate parent product exists
  const product = await db.select().from(products).where(eq(products.id, input.productId)).get();
  if (!product) {
    throw new Error(`Product with ID ${input.productId} does not exist`);
  }

  // Check unique SKU
  if (await isSkuDuplicate(input.sku)) {
    throw new Error(`The SKU "${input.sku}" is already in use by another product or variant.`);
  }

  const [inserted] = await db.insert(productVariants).values({
    productId: input.productId,
    sku: input.sku,
    priceOverride: input.priceOverride ?? null,
    stock: input.stock ?? 0,
    size: input.size ?? null,
    sizeType: input.sizeType ?? null,
    color: input.color ?? null,
    imageUrl: input.imageUrl ?? null,
  }).returning();

  if (!inserted) {
    throw new Error('Failed to create product variant');
  }
  return inserted;
}

export async function listVariantsByProductId(productId: number) {
  return await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .all();
}

export async function getVariantById(id: number) {
  const result = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.id, id))
    .get();
  return result || null;
}

/**
 * Updates a product variant.
 * Note: Updating `product_variants.stock` directly through this CRUD layer should be limited
 * to initial stock entry / manual corrections. Stock changes from sales/returns must go through
 * `stock_movements`, not this update function, once that logic exists.
 */
export async function updateVariant(id: number, input: UpdateVariantInput) {
  // If SKU is changing, validate uniqueness
  if (input.sku !== undefined) {
    if (await isSkuDuplicate(input.sku, undefined, id)) {
      throw new Error(`The SKU "${input.sku}" is already in use by another product or variant.`);
    }
  }

  const [updated] = await db
    .update(productVariants)
    .set(input)
    .where(eq(productVariants.id, id))
    .returning();

  if (!updated) {
    throw new Error(`Product variant with ID ${id} not found`);
  }
  return updated;
}

export async function deleteVariant(id: number) {
  const [deleted] = await db
    .delete(productVariants)
    .where(eq(productVariants.id, id))
    .returning();

  if (!deleted) {
    throw new Error(`Product variant with ID ${id} not found`);
  }
  return deleted;
}
