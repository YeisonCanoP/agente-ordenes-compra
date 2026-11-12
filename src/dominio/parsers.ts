import { ErrorLegible } from "./archivos.ts"
import type { Cotizacion, Factura } from "./esquemas.ts"
import { normalizarNit, parsearMonto, sumarDias } from "./texto.ts"

const campo = (texto: string, patron: RegExp): string | null => patron.exec(texto)?.[1]?.trim() ?? null

export function parsearCotizacion(texto: string): Cotizacion {
  const lineaTotal = campo(texto, /^TOTAL[^:\n]*:\s*(.+)$/m)
  const nit = campo(texto, /^NIT:\s*(.+)$/m)
  return {
    proveedor: campo(texto, /^Proveedor:\s*(.+)$/m) ?? "",
    nit: nit ? normalizarNit(nit) : null,
    total: montoObligatorio(lineaTotal, "cotizacion.txt"),
    moneda: campo(lineaTotal ?? "", /^([A-Z]{3})\b/) ?? "COP",
    validez_hasta: validezHasta(texto),
    texto,
  }
}

/** Primera línea de la cotización: "COTIZACIÓN COT-TS-2026-0451" → "COT-TS-2026-0451". */
export function referenciaCotizacion(texto: string): string | null {
  return campo(texto, /^COTIZACI[ÓO]N\s+(\S+)/m)
}

export function parsearFactura(texto: string): Factura {
  const fecha = campo(texto, /^Fecha de emisi[óo]n:\s*(\d{4}-\d{2}-\d{2})/m)
  if (!fecha) throw new ErrorLegible("factura.txt no trae una fecha de emisión con formato AAAA-MM-DD.")
  return {
    numero: campo(texto, /No\.\s*(\S+)/) ?? "",
    fecha,
    total: montoObligatorio(campo(texto, /^TOTAL[^:\n]*:\s*(.+)$/m), "factura.txt"),
  }
}

/** El cuerpo aprueba si contiene "Aprobado" y no viene negado ("No aprobado"). */
export function esAprobado(cuerpo: string): boolean {
  const negado = /\bno\s+(?:est[aá]\s+|fue\s+|queda\s+)?aprobad[oa]\b/i.test(cuerpo)
  return /\baprobad[oa]\b/i.test(cuerpo) && !negado
}

function validezHasta(texto: string): string | null {
  const fecha = campo(texto, /^Fecha:\s*(\d{4}-\d{2}-\d{2})/m)
  const dias = campo(texto, /^Validez[^:\n]*:\s*(\d+)\s*d[ií]as/im)
  return fecha && dias ? sumarDias(fecha, Number(dias)) : null
}

function montoObligatorio(linea: string | null, archivo: string): number {
  const monto = linea === null ? null : parsearMonto(linea)
  if (monto === null) {
    throw new ErrorLegible(
      `${archivo} no trae un TOTAL numérico${linea ? ` (dice "${linea}")` : ""}. Pide al solicitante el documento corregido.`,
    )
  }
  return monto
}
