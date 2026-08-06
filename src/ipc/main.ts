import { listVariants, searchVariantsByNameOrSku } from '../db/repositories/products';
import { createSale } from '../db/repositories/sales';

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
}
