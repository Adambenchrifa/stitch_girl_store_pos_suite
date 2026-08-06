import {
  listVariants,
  searchVariantsByNameOrSku,
  listProductsWithVariants,
  createProduct,
  updateProduct,
  deleteProduct
} from '../db/repositories/products';
import { createSale } from '../db/repositories/sales';
import {
  createVariant,
  updateVariant,
  deleteVariant
} from '../db/repositories/variants';
import {
  listCategories,
  deleteCategory
} from '../db/repositories/categories';

/**
 * Registers the Electron IPC main handlers for POS operations.
 * This is decoupled from direct Electron compile-time imports
 * to facilitate running in standard testing/Node environments without Electron installed.
 *
 * @param ipcMain The Electron `ipcMain` object (passed from the main process)
 */
export function registerIpcHandlers(ipcMain: {
  handle: (channel: string, listener: (event: any, ...args: any[]) => any) => void;
}) {
  // --- POINT OF SALE (Issue #6) ---

  // 1. products:listVariants
  ipcMain.handle('products:listVariants', async (_event: any, productId?: number) => {
    try {
      return await listVariants(productId);
    } catch (error: any) {
      console.error('Error in products:listVariants IPC handler:', error);
      throw error;
    }
  });

  // 2. products:searchByNameOrSku
  ipcMain.handle('products:searchByNameOrSku', async (_event: any, query: string) => {
    try {
      return await searchVariantsByNameOrSku(query);
    } catch (error: any) {
      console.error('Error in products:searchByNameOrSku IPC handler:', error);
      throw error;
    }
  });

  // 3. sales:create
  ipcMain.handle('sales:create', async (_event: any, input: any) => {
    try {
      return await createSale(input);
    } catch (error: any) {
      console.error('Error in sales:create IPC handler:', error);
      throw error;
    }
  });

  // --- PRODUCTS MANAGEMENT (Issue #7) ---

  // 4. products:list
  ipcMain.handle('products:list', async () => {
    try {
      return await listProductsWithVariants();
    } catch (error: any) {
      console.error('Error in products:list IPC handler:', error);
      throw error;
    }
  });

  // 5. products:create
  ipcMain.handle('products:create', async (_event: any, input: any) => {
    try {
      return await createProduct(input);
    } catch (error: any) {
      console.error('Error in products:create IPC handler:', error);
      throw error;
    }
  });

  // 6. products:update
  ipcMain.handle('products:update', async (_event: any, id: number, input: any) => {
    try {
      return await updateProduct(id, input);
    } catch (error: any) {
      console.error('Error in products:update IPC handler:', error);
      throw error;
    }
  });

  // 7. products:delete
  ipcMain.handle('products:delete', async (_event: any, id: number) => {
    try {
      return await deleteProduct(id);
    } catch (error: any) {
      console.error('Error in products:delete IPC handler:', error);
      throw error;
    }
  });

  // 8. variants:create
  ipcMain.handle('variants:create', async (_event: any, input: any) => {
    try {
      return await createVariant(input);
    } catch (error: any) {
      console.error('Error in variants:create IPC handler:', error);
      throw error;
    }
  });

  // 9. variants:update
  ipcMain.handle('variants:update', async (_event: any, id: number, input: any) => {
    try {
      return await updateVariant(id, input);
    } catch (error: any) {
      console.error('Error in variants:update IPC handler:', error);
      throw error;
    }
  });

  // 10. variants:delete
  ipcMain.handle('variants:delete', async (_event: any, id: number) => {
    try {
      return await deleteVariant(id);
    } catch (error: any) {
      console.error('Error in variants:delete IPC handler:', error);
      throw error;
    }
  });

  // 11. categories:list
  ipcMain.handle('categories:list', async () => {
    try {
      return await listCategories();
    } catch (error: any) {
      console.error('Error in categories:list IPC handler:', error);
      throw error;
    }
  });

  // 12. categories:delete
  ipcMain.handle('categories:delete', async (_event: any, id: number) => {
    try {
      return await deleteCategory(id);
    } catch (error: any) {
      console.error('Error in categories:delete IPC handler:', error);
      throw error;
    }
  });
}
