import { z } from "zod"

/**
 * Confirmación humana (CA3). La decisión no depende del modelo:
 *  1. Un caso queda pendiente cuando ya se le mostró a la analista (validado y apto).
 *  2. El backend clasifica el siguiente mensaje de la analista con reglas fijas, sin el modelo.
 *  3. `confirmado: true` solo se respeta si ese mensaje es una afirmación explícita y las
 *     excepciones del caso siguen siendo las mismas que se le mostraron.
 * Si el mensaje no es claramente afirmativo, la llamada se ejecuta sin confirmar y la herramienta
 * la rechaza: ante la duda, no se crea.
 */

/** Casos listos para crear que esperan respuesta de la analista: caso → reglas por confirmar. */
export type Pendientes = Map<string, string[]>

export type Respuesta = "afirmativa" | "negativa" | "otra"

const LARGO_MAXIMO_AFIRMACION = 80

const AFIRMA =
  /^(si|sip|claro|por supuesto|confirmo|confirmado|confirmada|dale|hagale|hazlo|hagalo|adelante|procede|proceda|procedamos|creala|crea la|crear la|de acuerdo|ok|okay|vale|listo|correcto|afirmativo|aprobado|apruebo|autorizo|autorizado)\b/
const NIEGA = /^(no|nop|negativo|cancela|cancelar|cancelalo|cancelala|rechazo|rechazada|rechazado|mejor no)\b|\b(no la crees|no lo hagas|no confirmo|dejala asi)\b/
/** "Si el valor..." es una condición, no un "sí". */
const CONDICIONA = /^si (el|la|los|las|es|esta|estan|hay|no|se|tiene|todo|algo|fuera|puedes|me)\b/
const DUDA =
  /\b(pero|creo|supongo|quiza|quizas|tal vez|depende|cambia|cambiar|modifica|modificar|corrige|excepto|salvo|antes|espera|todavia|aun|luego|despues)\b/

/** Minúsculas, sin tildes ni puntuación: "¡Sí, confirmo!" → "si confirmo". */
function normalizar(mensaje: string): string {
  return mensaje
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9?]+/g, " ")
    .trim()
}

/** Clasifica la respuesta de la analista con reglas fijas. Una pregunta nunca es una confirmación. */
export function clasificarRespuesta(mensaje: string): Respuesta {
  const texto = normalizar(mensaje)
  if (texto.includes("?")) return "otra"
  if (NIEGA.test(texto)) return "negativa"
  const esBreve = texto.length <= LARGO_MAXIMO_AFIRMACION
  const afirma = AFIRMA.test(texto) && !DUDA.test(texto) && !CONDICIONA.test(texto)
  return esBreve && afirma ? "afirmativa" : "otra"
}

/**
 * Inicio del turno: decide qué casos autoriza el mensaje de la analista.
 * Afirmativa → los pendientes quedan autorizados. Negativa → se descartan. Otra → siguen esperando.
 */
export function autorizarSegunRespuesta(mensaje: string, pendientes: Pendientes): Pendientes {
  const respuesta = clasificarRespuesta(mensaje)
  if (respuesta === "negativa") pendientes.clear()
  return respuesta === "afirmativa" ? new Map(pendientes) : new Map()
}

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

const mismasReglas = (a: string[] | undefined, b: string[] | undefined): boolean =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((regla, i) => regla === b[i])

/**
 * `confirmado: true` solo pasa si la analista autorizó ese caso en este turno y las excepciones
 * vigentes son las que se le mostraron. Si no, la llamada sigue sin confirmar.
 */
export function retirarConfirmacion(
  nombre: string,
  argumentos: unknown,
  autorizados: ReadonlyMap<string, string[]>,
  pendientes: Pendientes,
): unknown {
  if (nombre !== "oc_crear") return argumentos
  const conCaso = ConCaso.safeParse(argumentos)
  if (!conCaso.success || conCaso.data.confirmado !== true) return argumentos
  const { caso } = conCaso.data
  const vigente = mismasReglas(autorizados.get(caso), pendientes.get(caso))
  return vigente ? argumentos : { ...conCaso.data, confirmado: false }
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

export const hayPendientes = (pendientes: Pendientes): boolean => pendientes.size > 0
