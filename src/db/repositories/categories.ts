import { eq } from 'drizzle-orm';
import { db } from '../index';
import { categories, products } from '../schema';

export interface CreateCategoryInput {
  name: string;
  type: 'clothing' | 'accessory';
}

export interface UpdateCategoryInput {
  name?: string;
  type?: 'clothing' | 'accessory';
}

export async function createCategory(input: CreateCategoryInput) {
  if (!input.name || !input.type) {
    throw new Error('Category name and type are required');
  }
  const [inserted] = await db.insert(categories).values(input).returning();
  if (!inserted) {
    throw new Error('Failed to create category');
  }
  return inserted;
}

export async function listCategories() {
  return await db.select().from(categories).all();
}

export async function getCategoryById(id: number) {
  const result = await db.select().from(categories).where(eq(categories.id, id)).get();
  return result || null;
}

export async function updateCategory(id: number, input: UpdateCategoryInput) {
  const [updated] = await db
    .update(categories)
    .set(input)
    .where(eq(categories.id, id))
    .returning();
  if (!updated) {
    throw new Error(`Category with ID ${id} not found`);
  }
  return updated;
}

export async function deleteCategory(id: number) {
  // Reject if products reference this category
  const linkedProduct = await db
    .select()
    .from(products)
    .where(eq(products.categoryId, id))
    .get();

  if (linkedProduct) {
    throw new Error(`Cannot delete category with ID ${id} because it is referenced by existing products.`);
  }

  const [deleted] = await db
    .delete(categories)
    .where(eq(categories.id, id))
    .returning();
  if (!deleted) {
    throw new Error(`Category with ID ${id} not found`);
  }
  return deleted;
}
