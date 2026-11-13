import { appendFile, mkdir } from "node:fs/promises"
import { rutaSalida } from "../dominio/archivos.ts"

export type EntradaLog =
  | {
      tipo: "herramienta"
      sessionId: string
      herramienta: string
      argumentos: unknown
      ok: boolean
      resumen: string
      duracion_ms: number
    }
  /** La analista confirmó de forma explícita los casos y excepciones que se le mostraron. */
  | { tipo: "confirmacion"; sessionId: string; mensaje: string; casos: Record<string, string[]> }

/** Agrega una línea a out/log.jsonl (CA4). Nunca interrumpe el turno. */
export async function registrarEvento(directory: string, entrada: EntradaLog): Promise<void> {
  try {
    await mkdir(rutaSalida(directory), { recursive: true })
    const linea = JSON.stringify({ ts: new Date().toISOString(), ...entrada })
    await appendFile(rutaSalida(directory, "log.jsonl"), `${linea}\n`, "utf8")
  } catch (error) {
    console.error("No se pudo escribir out/log.jsonl:", error instanceof Error ? error.message : error)
  }
}
