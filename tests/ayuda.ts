import { chmod, cp, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import type { DefinicionHerramienta, LlmAdapter, Mensaje, RespuestaLlm } from "../src/llm/adapter.ts"

export const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)))
export const TOKENS = { entrada: 10, salida: 5 }

export type Paso = (mensajes: Mensaje[]) => RespuestaLlm

/** Modelo de mentira: responde lo que dicta el guion, un paso por cada llamada al "proveedor". */
export class LlmGuionado implements LlmAdapter {
  readonly proveedor = "prueba"
  readonly modelo = "guion"
  readonly herramientasRecibidas: number[] = []
  private readonly pasos: Paso[]

  constructor(pasos: Paso[]) {
    this.pasos = pasos
  }

  async enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLlm> {
    this.herramientasRecibidas.push(herramientas.length)
    const paso = this.pasos.shift()
    if (!paso) throw new Error("El guion se quedó sin pasos")
    return paso(mensajes)
  }

  agregar(...pasos: Paso[]): void {
    this.pasos.push(...pasos)
  }
}

let contador = 0

export const decir = (contenido: string): RespuestaLlm => ({ contenido, llamadas: [], tokens: TOKENS })

export const llamar = (nombre: string, argumentos: unknown): RespuestaLlm => ({
  contenido: "",
  llamadas: [{ id: `llamada-${++contador}`, nombre, argumentos: JSON.stringify(argumentos) }],
  tokens: TOKENS,
})

/** `data` del último resultado exitoso de una herramienta, tal como lo vería el modelo. */
export function dato(mensajes: Mensaje[], nombre: string): Record<string, unknown> {
  const mensaje = mensajes.findLast((m) => m.rol === "herramienta" && m.nombre === nombre)
  if (!mensaje) throw new Error(`El guion esperaba un resultado de ${nombre}`)
  return z.object({ data: z.record(z.string(), z.unknown()) }).parse(JSON.parse(mensaje.contenido)).data
}

export const crearCon =
  (caso: string, confirmado?: boolean): Paso =>
  (m) =>
    llamar("oc_crear", { caso, payload: dato(m, "oc_construir_payload").payload, confirmado })

/** Guion completo de una solicitud: leer → validar → construir → evidencia → crear. */
export const pasosHastaCrear = (caso: string, confirmado?: boolean): Paso[] => [
  () => llamar("oc_leer_paquete", { caso }),
  (m) => llamar("oc_validar", { caso, paquete: dato(m, "oc_leer_paquete") }),
  (m) =>
    llamar("oc_construir_payload", {
      caso,
      paquete: dato(m, "oc_leer_paquete"),
      derivados: dato(m, "oc_validar").derivados,
    }),
  () => llamar("oc_generar_evidencia", { caso }),
  crearCon(caso, confirmado),
]

const temporales: string[] = []

/** Carpeta temporal con una copia de los fixtures: cada test escribe en su propio out/. */
export async function directorioTemporal(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agente-oc-"))
  temporales.push(directory)
  await cp(join(RAIZ, "fixtures"), join(directory, "fixtures"), { recursive: true })
  await hacerEscribible(join(directory, "fixtures"))
  return directory
}

export async function limpiarTemporales(): Promise<void> {
  await Promise.all(temporales.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
}

/** Los fixtures pueden venir con carpetas de solo lectura; la copia debe poder modificarse y borrarse. */
async function hacerEscribible(carpeta: string): Promise<void> {
  await chmod(carpeta, 0o755)
  const entradas = await readdir(carpeta, { withFileTypes: true })
  await Promise.all(entradas.filter((e) => e.isDirectory()).map((e) => hacerEscribible(join(carpeta, e.name))))
}
