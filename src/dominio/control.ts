import { appendFile, mkdir } from "node:fs/promises"
import { existe, rutaSalida } from "./archivos.ts"

export type FilaControl = {
  solicitud_id: string
  resultado: "creada" | "existente" | "pendiente" | "bloqueada"
  numero_oc: string | null
  retroactiva: boolean
  bloqueos: string[]
  confirmaciones: string[]
}

const ENCABEZADO = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts"

/** Agrega una fila a out/control.csv, el log que consume contabilidad y auditoría (HU-5). */
export async function registrarControl(directory: string, fila: FilaControl): Promise<void> {
  const ruta = rutaSalida(directory, "control.csv")
  const nuevo = !(await existe(ruta))
  await mkdir(rutaSalida(directory), { recursive: true })
  await appendFile(ruta, `${nuevo ? `${ENCABEZADO}\n` : ""}${aLinea(fila)}\n`, "utf8")
}

function aLinea(fila: FilaControl): string {
  return [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc ?? "",
    String(fila.retroactiva),
    fila.bloqueos.join("|"),
    fila.confirmaciones.join("|"),
    new Date().toISOString(),
  ]
    .map(celda)
    .join(",")
}

const celda = (valor: string): string => (/[",\n]/.test(valor) ? `"${valor.replaceAll('"', '""')}"` : valor)
