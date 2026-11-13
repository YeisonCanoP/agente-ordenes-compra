import type { OrdenCompra } from "../dominio/esquemas.ts"

/**
 * Contrato con SAP (sección 7.4 del PRD). La implementación real se diseña en SOLUCION.md.
 *
 * Es la interfaz del PRD con dos campos opcionales añadidos, compatibles con ella:
 *  - `reutilizada`: crearOrden devolvió una OC que ya existía para esa solicitud (no creó otra).
 *  - `fecha` en la búsqueda: permite reconstruir el recibo de una OC existente tras un fallo.
 */
export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string; reutilizada?: boolean }>
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string; fecha?: string } | null>
}
