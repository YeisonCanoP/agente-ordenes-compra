/**
 * Interfaz propia del proveedor de modelo (PRD 6.1). El ciclo del agente solo conoce estos tipos:
 * cambiar de proveedor es escribir otra implementación de LlmAdapter, sin tocar el ciclo.
 */

/** Llamada a herramienta pedida por el modelo. `argumentos` es el JSON crudo, sin validar. */
export type LlamadaHerramienta = { id: string; nombre: string; argumentos: string }

export type Mensaje =
  | { rol: "sistema"; contenido: string }
  | { rol: "usuario"; contenido: string }
  | { rol: "asistente"; contenido: string; llamadas: LlamadaHerramienta[] }
  | { rol: "herramienta"; idLlamada: string; nombre: string; contenido: string }

/** `parametros` es un JSON Schema de tipo objeto. */
export type DefinicionHerramienta = {
  nombre: string
  descripcion: string
  parametros: Record<string, unknown>
}

export type RespuestaLlm = {
  contenido: string
  llamadas: LlamadaHerramienta[]
  tokens: { entrada: number; salida: number }
}

export interface LlmAdapter {
  readonly proveedor: string
  readonly modelo: string
  enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLlm>
}

/** Error del proveedor con un mensaje apto para mostrarse en el chat. Nunca incluye la clave. */
export class ErrorLlm extends Error {}
