import { z } from "zod"

/**
 * Confirmación humana (CA3). El modelo no decide solo cuándo una OC está confirmada:
 * `confirmado: true` solo se respeta si el caso ya estaba pendiente al empezar el turno,
 * es decir, si la analista escribió un mensaje después de que se le presentó la confirmación.
 */

/** Casos listos para crear que esperan respuesta de la analista: caso → reglas por confirmar. */
export type Pendientes = Map<string, string[]>

const ConCaso = z.looseObject({ caso: z.string() })
const Hallazgos = z.array(z.looseObject({ regla: z.string() }))
const ValidacionOk = z.looseObject({
  ok: z.literal(true),
  data: z.looseObject({ apta: z.boolean(), confirmaciones: Hallazgos }),
})
const CrearPendiente = z.looseObject({
  ok: z.literal(false),
  detalle: z.looseObject({ confirmaciones: Hallazgos }),
})
const Exito = z.looseObject({ ok: z.literal(true) })

/** Si el modelo envía `confirmado: true` para un caso no autorizado, la llamada se ejecuta sin confirmar. */
export function retirarConfirmacion(nombre: string, argumentos: unknown, autorizados: ReadonlySet<string>): unknown {
  if (nombre !== "oc_crear") return argumentos
  const conCaso = ConCaso.safeParse(argumentos)
  if (!conCaso.success || conCaso.data.confirmado !== true) return argumentos
  return autorizados.has(conCaso.data.caso) ? argumentos : { ...conCaso.data, confirmado: false }
}

/** Mantiene la lista de casos que esperan confirmación según el resultado de cada herramienta. */
export function actualizarPendientes(
  pendientes: Pendientes,
  nombre: string,
  argumentos: unknown,
  resultado: unknown,
): void {
  const conCaso = ConCaso.safeParse(argumentos)
  if (!conCaso.success) return
  const { caso } = conCaso.data
  if (nombre === "oc_validar") return trasValidar(pendientes, caso, resultado)
  if (nombre === "oc_crear") return trasCrear(pendientes, caso, resultado)
}

function trasValidar(pendientes: Pendientes, caso: string, resultado: unknown): void {
  const validacion = ValidacionOk.safeParse(resultado)
  if (!validacion.success) return
  if (!validacion.data.data.apta) {
    pendientes.delete(caso)
  } else {
    pendientes.set(caso, validacion.data.data.confirmaciones.map((h) => h.regla))
  }
}

function trasCrear(pendientes: Pendientes, caso: string, resultado: unknown): void {
  if (Exito.safeParse(resultado).success) {
    pendientes.delete(caso)
    return
  }
  const pendiente = CrearPendiente.safeParse(resultado)
  if (pendiente.success) pendientes.set(caso, pendiente.data.detalle.confirmaciones.map((h) => h.regla))
}

/**
 * Cierre del turno (CA3): hay confirmación pendiente si queda un caso por crear y el agente terminó
 * con una pregunta. Si no preguntó (la analista declinó o cambió de tema), los pendientes caducan.
 */
export function cerrarPendientes(pendientes: Pendientes, respuesta: string): boolean {
  if (!respuesta.includes("?")) pendientes.clear()
  return pendientes.size > 0
}

export const hayPendientes = (pendientes: Pendientes): boolean => pendientes.size > 0
