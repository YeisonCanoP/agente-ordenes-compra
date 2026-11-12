import { z } from "zod"

z.config(z.locales.es())

const texto = z.string().min(1)
const fechaDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "debe tener formato AAAA-MM-DD")

export const SolicitudSchema = z.object({
  solicitud_id: texto,
  solicitante: texto,
  proveedor_nombre: texto,
  proveedor_nit: texto.optional(),
  descripcion: texto,
  centro_costo: texto,
  subarea: texto,
  cantidad: z.number().positive(),
  valor_unitario: z.number().positive(),
  valor_total: z.number().positive(),
  moneda: z.enum(["COP", "USD"]),
  indicador_iva: texto.optional(),
  condiciones_pago: texto.optional(),
  fecha_solicitud: fechaDia,
})

export const CotizacionSchema = z.object({
  proveedor: z.string(),
  nit: z.string().nullable(),
  total: z.number(),
  moneda: z.string(),
  validez_hasta: z.string().nullable(),
  texto: z.string(),
})

export const AprobacionSchema = z.object({
  de: texto,
  fecha: texto,
  aprobado: z.boolean(),
  texto: z.string(),
})

export const FacturaSchema = z.object({
  numero: z.string(),
  fecha: fechaDia,
  total: z.number(),
})

export const PaqueteSchema = z.object({
  correo: z.object({ id: texto, de: texto, asunto: z.string(), fecha: texto }),
  solicitud: SolicitudSchema,
  cotizacion: CotizacionSchema.nullable(),
  aprobacion: AprobacionSchema.nullable(),
  factura: FacturaSchema.nullable(),
})

export const HallazgoSchema = z.object({
  regla: z.string(),
  mensaje: z.string(),
  accion_sugerida: z.string(),
  valores: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
})

export const DerivadoSchema = z.object({
  valor: z.string(),
  fuente: z.string(),
  motivo: z.string(),
})

export const DerivadosSchema = z.object({
  proveedor_nit: DerivadoSchema.optional(),
  indicador_iva: DerivadoSchema.optional(),
  condiciones_pago: DerivadoSchema.optional(),
})

export const ValidacionSchema = z.object({
  apta: z.boolean(),
  bloqueos: z.array(HallazgoSchema),
  confirmaciones: z.array(HallazgoSchema),
  derivados: DerivadosSchema,
  retroactiva: z.boolean(),
})

export const PosicionSchema = z.object({
  numero: z.number().int().positive().multipleOf(10),
  descripcion: z.string().min(1).max(40),
  cantidad: z.number().positive(),
  unidad: z.enum(["UN", "H", "MES"]),
  precio_unitario: z.number().positive(),
  centro_costo: texto,
  subarea: texto,
  indicador_iva: texto,
})

export const OrdenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: texto,
    correo_id: texto,
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: texto, nit: texto, nombre: texto }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: texto,
  aprobador: z.object({
    email: texto,
    fecha_aprobacion: texto,
    evidencia_sha256: z.string().regex(/^[0-9a-f]{64}$/, "debe ser un sha256 en hexadecimal"),
  }),
  posiciones: z.array(PosicionSchema).min(1),
  excepciones: z.array(
    z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() }),
  ),
})

export type Solicitud = z.infer<typeof SolicitudSchema>
export type Cotizacion = z.infer<typeof CotizacionSchema>
export type Aprobacion = z.infer<typeof AprobacionSchema>
export type Factura = z.infer<typeof FacturaSchema>
export type Paquete = z.infer<typeof PaqueteSchema>
export type Hallazgo = z.infer<typeof HallazgoSchema>
export type Derivados = z.infer<typeof DerivadosSchema>
export type Validacion = z.infer<typeof ValidacionSchema>
export type OrdenCompra = z.infer<typeof OrdenCompraSchema>
