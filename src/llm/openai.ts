import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  RateLimitError,
} from "openai"
import type { Config } from "../config.ts"
import { ErrorLlm } from "./adapter.ts"
import type { DefinicionHerramienta, LlamadaHerramienta, LlmAdapter, Mensaje, RespuestaLlm } from "./adapter.ts"

type MensajeOpenAI = OpenAI.Chat.Completions.ChatCompletionMessageParam
type HerramientaOpenAI = OpenAI.Chat.Completions.ChatCompletionTool
type RespuestaOpenAI = OpenAI.Chat.Completions.ChatCompletion

/** Implementación de LlmAdapter sobre la API de Chat Completions de OpenAI. */
export class OpenAiAdapter implements LlmAdapter {
  readonly proveedor = "openai"
  readonly modelo: string
  private readonly config: Config["llm"]
  private cliente: OpenAI | null = null

  constructor(config: Config["llm"]) {
    this.config = config
    this.modelo = config.modelo
  }

  async enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLlm> {
    const cliente = this.obtenerCliente()
    try {
      const respuesta = await cliente.chat.completions.create({
        model: this.modelo,
        messages: mensajes.map(aMensajeOpenAI),
        max_completion_tokens: this.config.maxTokensRespuesta,
        ...(herramientas.length > 0 ? { tools: herramientas.map(aHerramientaOpenAI) } : {}),
      })
      return aRespuesta(respuesta)
    } catch (error) {
      throw traducirError(error, this.config.timeoutMs)
    }
  }

  /** El cliente se crea al primer uso: sin clave, el servidor arranca y /api/health responde. */
  private obtenerCliente(): OpenAI {
    if (this.cliente) return this.cliente
    if (!this.config.apiKey) {
      throw new ErrorLlm("El servidor no tiene configurada la clave del modelo (OPENAI_API_KEY).")
    }
    this.cliente = new OpenAI({ apiKey: this.config.apiKey, timeout: this.config.timeoutMs, maxRetries: 1 })
    return this.cliente
  }
}

function aMensajeOpenAI(mensaje: Mensaje): MensajeOpenAI {
  switch (mensaje.rol) {
    case "sistema":
      return { role: "system", content: mensaje.contenido }
    case "usuario":
      return { role: "user", content: mensaje.contenido }
    case "herramienta":
      return { role: "tool", tool_call_id: mensaje.idLlamada, content: mensaje.contenido }
    case "asistente":
      return {
        role: "assistant",
        content: mensaje.contenido || null,
        ...(mensaje.llamadas.length > 0 ? { tool_calls: mensaje.llamadas.map(aLlamadaOpenAI) } : {}),
      }
  }
}

function aLlamadaOpenAI(llamada: LlamadaHerramienta): OpenAI.Chat.Completions.ChatCompletionMessageToolCall {
  return { id: llamada.id, type: "function", function: { name: llamada.nombre, arguments: llamada.argumentos } }
}

function aHerramientaOpenAI(herramienta: DefinicionHerramienta): HerramientaOpenAI {
  return {
    type: "function",
    function: { name: herramienta.nombre, description: herramienta.descripcion, parameters: herramienta.parametros },
  }
}

function aRespuesta(respuesta: RespuestaOpenAI): RespuestaLlm {
  const mensaje = respuesta.choices[0]?.message
  const llamadas = (mensaje?.tool_calls ?? []).flatMap((llamada): LlamadaHerramienta[] =>
    llamada.type === "function"
      ? [{ id: llamada.id, nombre: llamada.function.name, argumentos: llamada.function.arguments }]
      : [],
  )
  return {
    contenido: mensaje?.content ?? "",
    llamadas,
    tokens: { entrada: respuesta.usage?.prompt_tokens ?? 0, salida: respuesta.usage?.completion_tokens ?? 0 },
  }
}

/** Convierte el error del SDK en un mensaje claro. No reenvía el texto del proveedor: puede citar la clave. */
function traducirError(error: unknown, timeoutMs: number): ErrorLlm {
  if (error instanceof ErrorLlm) return error
  if (error instanceof APIConnectionTimeoutError) {
    return new ErrorLlm(`El modelo no respondió en ${Math.round(timeoutMs / 1000)} segundos. Intenta de nuevo.`)
  }
  if (error instanceof AuthenticationError) {
    return new ErrorLlm("El proveedor del modelo rechazó la clave configurada en el servidor.")
  }
  if (error instanceof RateLimitError) {
    return new ErrorLlm("El proveedor del modelo está limitando las solicitudes o la cuenta no tiene saldo. Intenta en unos segundos.")
  }
  if (error instanceof APIConnectionError) {
    return new ErrorLlm("No se pudo conectar con el proveedor del modelo. Revisa la conexión e intenta de nuevo.")
  }
  if (error instanceof APIError) {
    const pista = error.status === 404 ? " Verifica el nombre del modelo (OPENAI_MODEL)." : ""
    return new ErrorLlm(`El proveedor del modelo devolvió un error (HTTP ${error.status ?? "desconocido"}).${pista}`)
  }
  return new ErrorLlm("Ocurrió un error inesperado al llamar al modelo.")
}
