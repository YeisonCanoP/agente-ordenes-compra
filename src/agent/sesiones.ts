import type { Mensaje } from "../llm/adapter.ts"
import type { Pendientes } from "./confirmacion.ts"

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
  /** Conversación que se envía al modelo (sin el system prompt). */
  mensajes: Mensaje[]
  /** Conversación tal como se muestra en el chat. */
  historial: EntradaHistorial[]
  tokens: number
  pendientes: Pendientes
}

/** Sesiones en memoria (PRD 6.1: sin base de datos). Cada sesión procesa un turno a la vez. */
export class Sesiones {
  private readonly sesiones = new Map<string, Sesion>()
  private readonly colas = new Map<string, Promise<void>>()
  private readonly maximo: number

  /** Al superar `maximo` sesiones se descarta la más antigua: la memoria no crece sin límite. */
  constructor(maximo = 200) {
    this.maximo = maximo
  }

  obtener(id: string): Sesion {
    const existente = this.sesiones.get(id)
    if (existente) return existente
    const nueva: Sesion = { id, mensajes: [], historial: [], tokens: 0, pendientes: new Map() }
    this.sesiones.set(id, nueva)
    this.descartarAntiguas()
    return nueva
  }

  private descartarAntiguas(): void {
    for (const id of this.sesiones.keys()) {
      if (this.sesiones.size <= this.maximo) return
      this.sesiones.delete(id)
      this.colas.delete(id)
    }
  }

  buscar(id: string): Sesion | null {
    return this.sesiones.get(id) ?? null
  }

  /** Evita que dos mensajes simultáneos de la misma sesión mezclen sus historiales. */
  enSerie<T>(id: string, tarea: (sesion: Sesion) => Promise<T>): Promise<T> {
    const anterior = this.colas.get(id) ?? Promise.resolve()
    const resultado = anterior.then(() => tarea(this.obtener(id)))
    this.colas.set(
      id,
      resultado.then(
        () => undefined,
        () => undefined,
      ),
    )
    return resultado
  }
}
