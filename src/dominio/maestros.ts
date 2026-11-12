import { z } from "zod"
import { ErrorLegible, leerJson, rutaMaestro } from "./archivos.ts"

const ProveedorSchema = z.object({
  codigo_sap: z.string(),
  nit: z.string(),
  nombre: z.string(),
  condiciones_pago_default: z.string(),
  indicador_iva_default: z.string(),
  activo: z.boolean(),
})

const AprobadorSchema = z.object({
  email: z.string(),
  nombre: z.string().optional(),
  tope: z.number(),
})

const CentroCostoSchema = z.object({
  centro_costo: z.string(),
  nombre: z.string().optional(),
  subareas: z.array(z.string()),
  aprobadores: z.array(AprobadorSchema),
})

const IndicadorIvaSchema = z.object({ codigo: z.string(), descripcion: z.string(), tasa: z.number() })
const CondicionPagoSchema = z.object({ codigo: z.string(), descripcion: z.string(), dias: z.number() })

export type Proveedor = z.infer<typeof ProveedorSchema>
export type Aprobador = z.infer<typeof AprobadorSchema>
export type CentroCosto = z.infer<typeof CentroCostoSchema>

export type Maestros = {
  proveedores: Proveedor[]
  centros: CentroCosto[]
  indicadoresIva: z.infer<typeof IndicadorIvaSchema>[]
  condicionesPago: z.infer<typeof CondicionPagoSchema>[]
}

export async function cargarMaestros(directory: string): Promise<Maestros> {
  const [proveedores, centros, indicadoresIva, condicionesPago] = await Promise.all([
    cargar(directory, "proveedores.json", z.array(ProveedorSchema)),
    cargar(directory, "centros-costo.json", z.array(CentroCostoSchema)),
    cargar(directory, "indicadores-iva.json", z.array(IndicadorIvaSchema)),
    cargar(directory, "condiciones-pago.json", z.array(CondicionPagoSchema)),
  ])
  return { proveedores, centros, indicadoresIva, condicionesPago }
}

async function cargar<S extends z.ZodType>(
  directory: string,
  archivo: string,
  esquema: S,
): Promise<z.output<S>> {
  const datos = await leerJson(rutaMaestro(directory, archivo), esquema, `maestros/${archivo}`)
  if (datos === null) throw new ErrorLegible(`Falta el maestro ${archivo} en fixtures/reto-03/maestros/.`)
  return datos
}
