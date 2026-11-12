import { z } from "zod"
import { ErrorLegible, describirIssues } from "../dominio/archivos.ts"

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string; detalle?: unknown }

const ExitoSchema = z.object({ ok: z.literal(true), data: z.unknown() })
const FalloSchema = z.object({ ok: z.literal(false), error: z.string(), detalle: z.unknown().optional() })

export const exito = (data: unknown): string => JSON.stringify({ ok: true, data })

export const fallo = (error: string, detalle?: unknown): string =>
  JSON.stringify(detalle === undefined ? { ok: false, error } : { ok: false, error, detalle })

/** Garantiza que una herramienta nunca lance: todo error termina como { ok: false, error }. */
export async function protegido(tarea: () => Promise<string>): Promise<string> {
  try {
    return await tarea()
  } catch (error) {
    if (error instanceof ErrorLegible) return fallo(error.message)
    return fallo(`Error inesperado: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Valida los argumentos de una herramienta; el error le dice al modelo qué campo corregir. */
export function leerArgs<S extends z.ZodType>(esquema: S, args: unknown): z.output<S> {
  const resultado = esquema.safeParse(args)
  if (!resultado.success) {
    throw new ErrorLegible(`Argumentos inválidos → ${describirIssues(resultado.error)}`)
  }
  return resultado.data
}

/** Convierte el string que devuelve una herramienta en un Resultado tipado. */
export function interpretar<S extends z.ZodType>(datos: S, salida: string): Resultado<z.output<S>> {
  const crudo: unknown = JSON.parse(salida)
  const mal = FalloSchema.safeParse(crudo)
  if (mal.success) return mal.data
  const bien = ExitoSchema.safeParse(crudo)
  const data = bien.success ? datos.safeParse(bien.data.data) : null
  if (data?.success) return { ok: true, data: data.data }
  const motivo = data ? describirIssues(data.error) : "no es { ok, data } ni { ok, error }"
  return { ok: false, error: `Respuesta de herramienta con forma inesperada → ${motivo}` }
}
