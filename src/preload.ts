import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  products: {
    listVariants: (productId?: number) => ipcRenderer.invoke('products:listVariants', productId),
    searchByNameOrSku: (query: string) => ipcRenderer.invoke('products:searchByNameOrSku', query),
  },
  sales: {
    create: (input: any) => ipcRenderer.invoke('sales:create', input),
  },
});
