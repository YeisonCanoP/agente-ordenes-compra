import { z } from "zod"
import { ErrorLlm } from "../llm/adapter.ts"
import type { DefinicionHerramienta, LlamadaHerramienta, LlmAdapter, RespuestaLlm } from "../llm/adapter.ts"
import { fallo } from "../tools/resultado.ts"
import { actualizarPendientes, autorizarSegunRespuesta, hayPendientes, retirarConfirmacion } from "./confirmacion.ts"
import type { Pendientes } from "./confirmacion.ts"
import { enlazar, recordar } from "./enlaces.ts"
import { definiciones, ejecutarHerramienta } from "./herramientas.ts"
import { registrarEvento } from "./log.ts"
import { resumir } from "./resumen.ts"
import type { LlamadaVisible, Sesion } from "./sesiones.ts"

export type Dependencias = {
  llm: LlmAdapter
  /** Raíz del proyecto: las herramientas resuelven fixtures/ y out/ desde aquí. */
  directory: string
  promptSistema: string
  limites: { maxIteraciones: number; maxTokensSesion: number }
  /** Aviso en vivo de cada llamada a herramienta (para streaming). */
  alLlamar?: (llamada: LlamadaVisible) => void
}

export type RespuestaTurno = { reply: string; toolCalls: LlamadaVisible[]; needsConfirmation: boolean }

type Turno = { sesion: Sesion; deps: Dependencias; autorizados: Pendientes; toolCalls: LlamadaVisible[] }

const ConOk = z.looseObject({ ok: z.boolean() })
const SIN_TEXTO = "(El modelo no devolvió texto. Intenta reformular tu mensaje.)"

/** Un turno del chat: mensaje de la analista → modelo ↔ herramientas → respuesta (PRD 6.3). */
export async function ejecutarTurno(sesion: Sesion, mensaje: string, deps: Dependencias): Promise<RespuestaTurno> {
  sesion.historial.push({ rol: "usuario", contenido: mensaje, ts: new Date().toISOString() })
  const autorizados = autorizarSegunRespuesta(mensaje, sesion.pendientes)
  if (autorizados.size > 0) {
    const casos = Object.fromEntries(autorizados)
    await registrarEvento(deps.directory, { tipo: "confirmacion", sessionId: sesion.id, mensaje, casos })
  }
  const turno: Turno = { sesion, deps, autorizados, toolCalls: [] }
  const reply = sinPresupuesto(turno) ?? (await conversar(turno, mensaje))

  const needsConfirmation = hayPendientes(sesion.pendientes)
  const { toolCalls } = turno
  sesion.historial.push({ rol: "asistente", contenido: reply, toolCalls, needsConfirmation, ts: new Date().toISOString() })
  return { reply, toolCalls, needsConfirmation }
}

async function conversar(turno: Turno, mensaje: string): Promise<string> {
  const { sesion, deps } = turno
  sesion.mensajes.push({ rol: "usuario", contenido: mensaje })

  for (let iteracion = 0; iteracion < deps.limites.maxIteraciones; iteracion++) {
    const agotado = iteracion > 0 ? sinPresupuesto(turno) : null
    if (agotado) return agotado

    const respuesta = await consultar(turno, definiciones)
    if (typeof respuesta === "string") return respuesta
    sesion.mensajes.push({ rol: "asistente", contenido: respuesta.contenido, llamadas: respuesta.llamadas })
    if (respuesta.llamadas.length === 0) return respuesta.contenido || SIN_TEXTO

    for (const llamada of respuesta.llamadas) await ejecutarLlamada(turno, llamada)
  }
  return cerrarPorTope(turno)
}

/** Llama al modelo. Un fallo del proveedor se devuelve como texto para el chat: la sesión no muere (CA5). */
async function consultar(turno: Turno, herramientas: DefinicionHerramienta[]): Promise<RespuestaLlm | string> {
  const { sesion, deps } = turno
  try {
    const respuesta = await deps.llm.enviar(
      [{ rol: "sistema", contenido: deps.promptSistema }, ...sesion.mensajes],
      herramientas,
    )
    sesion.tokens += respuesta.tokens.entrada + respuesta.tokens.salida
    return respuesta
  } catch (error) {
    if (!(error instanceof ErrorLlm)) console.error("Error inesperado del adaptador LLM:", error)
    const motivo = error instanceof ErrorLlm ? error.message : "Ocurrió un error inesperado al llamar al modelo."
    return `No pude obtener respuesta del modelo. ${motivo} Tu sesión sigue activa: puedes volver a intentarlo.${hechoHastaAhora(turno)}`
  }
}

/** Ejecuta una llamada y la deja en el historial del modelo, en el chat y en out/log.jsonl (CA4). */
async function ejecutarLlamada(turno: Turno, llamada: LlamadaHerramienta): Promise<void> {
  const { sesion, deps } = turno
  const inicio = Date.now()
  const crudos = parsearArgumentos(llamada.argumentos)
  const recibidos = retirarConfirmacion(llamada.nombre, crudos, turno.autorizados, sesion.pendientes)
  const enlazado = enlazar(llamada.nombre, recibidos, sesion.resultados)
  const argumentos = "falta" in enlazado ? recibidos : enlazado.argumentos
  const salida = await ejecutarOExplicar(turno, llamada.nombre, argumentos, "falta" in enlazado ? enlazado.falta : null)

  const resultado: unknown = JSON.parse(salida)
  recordar(sesion.resultados, llamada.nombre, argumentos, resultado)
  actualizarPendientes(sesion.pendientes, llamada.nombre, argumentos, resultado)
  sesion.mensajes.push({ rol: "herramienta", idLlamada: llamada.id, nombre: llamada.nombre, contenido: salida })

  const ok = ConOk.safeParse(resultado).data?.ok === true
  const visible: LlamadaVisible = {
    id: llamada.id,
    nombre: llamada.nombre,
    argumentos: argumentos ?? llamada.argumentos,
    ok,
    resumen: resumir(llamada.nombre, resultado),
    resultado,
  }
  turno.toolCalls.push(visible)
  await registrarEvento(deps.directory, {
    tipo: "herramienta",
    sessionId: sesion.id,
    herramienta: visible.nombre,
    argumentos: visible.argumentos,
    ok,
    resumen: visible.resumen,
    duracion_ms: Date.now() - inicio,
  })
  deps.alLlamar?.(visible)
}

async function ejecutarOExplicar(turno: Turno, nombre: string, argumentos: unknown, falta: string | null): Promise<string> {
  if (argumentos === undefined) return fallo(`Los argumentos de ${nombre} no son un JSON válido. Corrige y vuelve a llamar.`)
  if (falta) return fallo(falta)
  return ejecutarHerramienta(nombre, argumentos, { directory: turno.deps.directory, sessionId: turno.sesion.id })
}

/** CA1: al llegar al tope, el agente responde con lo que tiene y lo que falta, sin más herramientas. */
async function cerrarPorTope(turno: Turno): Promise<string> {
  const { sesion, deps } = turno
  const tope = deps.limites.maxIteraciones
  sesion.mensajes.push({
    rol: "sistema",
    contenido: `Alcanzaste el tope de ${tope} iteraciones de este turno. Responde ahora, sin llamar herramientas: resume qué lograste y qué falta por hacer.`,
  })
  const respuesta = await consultar(turno, [])
  const texto =
    typeof respuesta === "string" || !respuesta.contenido
      ? `Alcancé el tope de ${tope} iteraciones en este turno y me detuve.${hechoHastaAhora(turno)} Escribe "continúa" para seguir.`
      : respuesta.contenido
  sesion.mensajes.push({ rol: "asistente", contenido: texto, llamadas: [] })
  return texto
}

/** Tope de costo por sesión (PRD 8): un usuario no puede gastar la clave sin límite. */
function sinPresupuesto(turno: Turno): string | null {
  const { sesion, deps } = turno
  if (sesion.tokens < deps.limites.maxTokensSesion) return null
  return `Esta sesión alcanzó su tope de ${deps.limites.maxTokensSesion} tokens. Inicia una sesión nueva para continuar.${hechoHastaAhora(turno)}`
}

function hechoHastaAhora(turno: Turno): string {
  if (turno.toolCalls.length === 0) return ""
  const pasos = turno.toolCalls.map((l) => `${l.nombre} (${l.ok ? "ok" : "con error"})`).join(", ")
  return ` En este turno se ejecutó: ${pasos}.`
}

function parsearArgumentos(crudo: string): unknown {
  try {
    const valor: unknown = JSON.parse(crudo || "{}")
    return valor ?? undefined
  } catch {
    return undefined
  }
}
