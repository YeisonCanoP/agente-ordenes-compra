import type { Mensaje } from "../llm/adapter.ts"
import type { Pendientes } from "./confirmacion.ts"
import type { Resultados } from "./enlaces.ts"

/** Llamada a herramienta tal como la ve la analista en el chat (CA4). */
export type LlamadaVisible = {
  id: string
  nombre: string
  argumentos: unknown
  ok: boolean
  resumen: string
  resultado: unknown
}

export type EntradaHistorial =
  | { rol: "usuario"; contenido: string; ts: string }
  | { rol: "asistente"; contenido: string; toolCalls: LlamadaVisible[]; needsConfirmation: boolean; ts: string }

export type Sesion = {
  id: string
  /** Conversación que se envía al modelo (sin el system prompt). Crece solo mientras haya tokens. */
  mensajes: Mensaje[]
  /** Conversación tal como se muestra en el chat. */
  historial: EntradaHistorial[]
  tokens: number
  pendientes: Pendientes
  /** Resultados de herramientas que el ciclo enlaza con las llamadas siguientes. */
  resultados: Resultados
}

/** Entradas que conserva el historial visible de una sesión; las más antiguas se descartan. */
export const MAX_ENTRADAS_HISTORIAL = 60

export function agregarAlHistorial(sesion: Sesion, entrada: EntradaHistorial): void {
  sesion.historial.push(entrada)
  if (sesion.historial.length > MAX_ENTRADAS_HISTORIAL) {
    sesion.historial.splice(0, sesion.historial.length - MAX_ENTRADAS_HISTORIAL)
  }
}

/**
 * Sesiones en memoria (PRD 6.1: sin base de datos; se pierden al reiniciar el proceso).
 * La memoria está acotada: máximo de sesiones, historial recortado y un turno a la vez por sesión.
 */
export class Sesiones {
  private readonly sesiones = new Map<string, Sesion>()
  private readonly ocupadas = new Set<string>()
  private readonly maximo: number

  constructor(maximo = 50) {
    this.maximo = maximo
  }

  /** Devuelve la sesión (creándola si no existe) y la marca como la usada más recientemente. */
  obtener(id: string): Sesion {
    const sesion = this.sesiones.get(id) ?? {
      id,
      mensajes: [],
      historial: [],
      tokens: 0,
      pendientes: new Map(),
      resultados: new Map(),
    }
    this.sesiones.delete(id)
    this.sesiones.set(id, sesion)
    this.descartarInactivas()
    return sesion
  }

  buscar(id: string): Sesion | null {
    return this.sesiones.get(id) ?? null
  }

  estaOcupada(id: string): boolean {
    return this.ocupadas.has(id)
  }

  get turnosActivos(): number {
    return this.ocupadas.size
  }

  /** Ejecuta un turno marcando la sesión como ocupada: no admite otro mensaje hasta que termine. */
  async ejecutar<T>(id: string, tarea: (sesion: Sesion) => Promise<T>): Promise<T> {
    this.ocupadas.add(id)
    try {
      return await tarea(this.obtener(id))
    } finally {
      this.ocupadas.delete(id)
    }
  }

  /** Al superar el máximo se descartan las sesiones menos usadas, nunca una con un turno en curso. */
  private descartarInactivas(): void {
    for (const id of this.sesiones.keys()) {
      if (this.sesiones.size <= this.maximo) return
      if (!this.ocupadas.has(id)) this.sesiones.delete(id)
    }
  }
}
