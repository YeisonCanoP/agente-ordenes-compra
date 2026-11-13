import { appendFile, mkdir } from "node:fs/promises"
import { z } from "zod"
import { ErrorLegible, leerTexto, rutaSalida } from "../dominio/archivos.ts"
import { OrdenCompraSchema } from "../dominio/esquemas.ts"
import type { OrdenCompra } from "../dominio/esquemas.ts"
import { cargarMaestros } from "../dominio/maestros.ts"
import { normalizarNit } from "../dominio/texto.ts"
import type { SapAdapter } from "./adapter.ts"

const PRIMER_NUMERO = 4500000001

const RegistroSchema = z.object({ numero_oc: z.string(), fecha: z.string(), orden: OrdenCompraSchema })
type Registro = z.infer<typeof RegistroSchema>

/** SAP simulado: las órdenes viven en out/sap/ordenes.jsonl, una por línea. */
export class SapMock implements SapAdapter {
  /** Serializa las escrituras para que dos creaciones simultáneas no repitan número. */
  private static cola: Promise<void> = Promise.resolve()
  private readonly directory: string

  constructor(directory: string) {
    this.directory = directory
  }

  async consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const { proveedores } = await cargarMaestros(this.directory)
    const proveedor = proveedores.find((p) => p.nit === normalizarNit(nit))
    return proveedor ? { codigo_sap: proveedor.codigo_sap, activo: proveedor.activo } : null
  }

  /** Crea la OC o, si la solicitud ya tiene una, devuelve esa misma con `reutilizada: true`. */
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string; reutilizada: boolean }> {
    return this.enSerie(async () => {
      const registros = await this.leerRegistros()
      const previo = registros.find((r) => r.orden.referencia.solicitud_id === orden.referencia.solicitud_id)
      if (previo) return { numero_oc: previo.numero_oc, fecha: previo.fecha, reutilizada: true }

      const registro: Registro = {
        numero_oc: String(PRIMER_NUMERO + registros.length),
        fecha: new Date().toISOString(),
        orden,
      }
      await mkdir(rutaSalida(this.directory, "sap"), { recursive: true })
      await appendFile(this.rutaOrdenes(), `${JSON.stringify(registro)}\n`, "utf8")
      return { numero_oc: registro.numero_oc, fecha: registro.fecha, reutilizada: false }
    })
  }

  async buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string; fecha: string } | null> {
    const registros = await this.leerRegistros()
    const registro = registros.find((r) => r.orden.referencia.solicitud_id === solicitud_id)
    return registro ? { numero_oc: registro.numero_oc, fecha: registro.fecha } : null
  }

  private rutaOrdenes(): string {
    return rutaSalida(this.directory, "sap", "ordenes.jsonl")
  }

  private async leerRegistros(): Promise<Registro[]> {
    const contenido = await leerTexto(this.rutaOrdenes())
    if (contenido === null) return []
    return contenido
      .split("\n")
      .filter((linea) => linea.trim() !== "")
      .map((linea, indice) => parsearRegistro(linea, indice + 1))
  }

  private enSerie<T>(tarea: () => Promise<T>): Promise<T> {
    const resultado = SapMock.cola.then(tarea)
    SapMock.cola = resultado.then(
      () => undefined,
      () => undefined,
    )
    return resultado
  }
}

function parsearRegistro(linea: string, numeroLinea: number): Registro {
  try {
    return RegistroSchema.parse(JSON.parse(linea))
  } catch {
    throw new ErrorLegible(`out/sap/ordenes.jsonl está dañado en la línea ${numeroLinea}; no se puede consultar el SAP simulado.`)
  }
}
