import { z } from "zod"

/** Entero positivo leído de una variable de entorno; vacío o ausente usa el valor por defecto. */
const entero = (porDefecto: number) =>
  z.preprocess((valor) => (valor === "" ? undefined : valor), z.coerce.number().int().positive().default(porDefecto))

const textoOpcional = z.preprocess((valor) => (valor === "" ? undefined : valor), z.string().optional())

const EntornoSchema = z.object({
  OPENAI_API_KEY: textoOpcional,
  OPENAI_MODEL: z.preprocess((valor) => (valor === "" ? undefined : valor), z.string().default("gpt-4.1-mini")),
  LLM_TIMEOUT_MS: entero(60_000),
  MAX_TOKENS_RESPUESTA: entero(4_000),
  MAX_ITERACIONES: entero(25),
  MAX_TOKENS_SESION: entero(300_000),
  MAX_TOKENS_DIA: entero(3_000_000),
  ACCESS_KEY: textoOpcional,
  PORT: entero(3000),
})

export type Config = {
  llm: { apiKey: string | undefined; modelo: string; timeoutMs: number; maxTokensRespuesta: number }
  agente: { maxIteraciones: number; maxTokensSesion: number }
  /** Tope global de tokens por día y clave de acceso opcional al chat. */
  servidor: { maxTokensDia: number; claveAcceso: string | undefined }
  puerto: number
}

/** Lee la configuración del entorno. La clave del modelo solo vive aquí y en el adaptador LLM. */
export function leerConfig(entorno: Record<string, string | undefined> = process.env): Config {
  const e = EntornoSchema.parse(entorno)
  return {
    llm: {
      apiKey: e.OPENAI_API_KEY,
      modelo: e.OPENAI_MODEL,
      timeoutMs: e.LLM_TIMEOUT_MS,
      maxTokensRespuesta: e.MAX_TOKENS_RESPUESTA,
    },
    agente: { maxIteraciones: e.MAX_ITERACIONES, maxTokensSesion: e.MAX_TOKENS_SESION },
    servidor: { maxTokensDia: e.MAX_TOKENS_DIA, claveAcceso: e.ACCESS_KEY },
    puerto: e.PORT,
  }
}
