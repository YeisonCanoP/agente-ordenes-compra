import type { OrdenCompra } from "../dominio/esquemas.ts"

/** Contrato con SAP (sección 7.4 del PRD). La implementación real se diseña en SOLUCION.md. */
export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null>
}
