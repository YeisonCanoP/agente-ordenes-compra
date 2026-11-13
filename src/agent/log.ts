import { appendFile, mkdir } from "node:fs/promises"
import { rutaSalida } from "../dominio/archivos.ts"

export type EntradaLog = {
  sessionId: string
  herramienta: string
  argumentos: unknown
  ok: boolean
  resumen: string
  duracion_ms: number
}

/** Agrega una línea a out/log.jsonl por cada llamada a herramienta (CA4). Nunca interrumpe el turno. */
export async function registrarLlamada(directory: string, entrada: EntradaLog): Promise<void> {
  try {
    await mkdir(rutaSalida(directory), { recursive: true })
    const linea = JSON.stringify({ ts: new Date().toISOString(), ...entrada })
    await appendFile(rutaSalida(directory, "log.jsonl"), `${linea}\n`, "utf8")
  } catch (error) {
    console.error("No se pudo escribir out/log.jsonl:", error instanceof Error ? error.message : error)
  }
}
