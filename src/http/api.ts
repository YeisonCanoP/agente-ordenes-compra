import { timingSafeEqual } from "node:crypto"
import { z } from "zod"
import { ejecutarTurno } from "../agent/ciclo.ts"
import type { Dependencias, RespuestaTurno } from "../agent/ciclo.ts"
import { hayPendientes } from "../agent/confirmacion.ts"
import type { LlamadaVisible, Sesiones } from "../agent/sesiones.ts"
import { describirIssues } from "../dominio/archivos.ts"
import { servirEstatico } from "./estaticos.ts"
import type { Presupuesto } from "./presupuesto.ts"

export type Servicios = {
  deps: Dependencias
  sesiones: Sesiones
  presupuesto: Presupuesto
  /** Si está definida, el chat exige la cabecera x-clave-acceso. */
  claveAcceso: string | undefined
  /** Carpeta con index.html, app.js y estilos.css. */
  raizWeb: string
}

type AlLlamar = (llamada: LlamadaVisible) => void

const ID_SESION = "[A-Za-z0-9_-]{8,64}"
const RUTA_SESION = new RegExp(`^/api/sessions/(${ID_SESION})$`)

const CuerpoChat = z.object({
  sessionId: z
    .string()
    .regex(new RegExp(`^${ID_SESION}$`), "debe tener entre 8 y 64 caracteres (letras, números, guion o guion bajo)"),
  message: z.string().trim().min(1, "no puede estar vacío").max(4000, "no puede superar los 4000 caracteres"),
  stream: z.boolean().optional(),
})

/** API del chat (PRD 6.4). Es una función Request → Response: se prueba sin levantar un servidor. */
export function crearManejador(servicios: Servicios): (peticion: Request) => Promise<Response> {
  return async (peticion) => {
    try {
      return await enrutar(servicios, peticion)
    } catch (error) {
      console.error("Error no controlado en la API:", error instanceof Error ? error.message : error)
      return json(500, { error: "Error interno del servidor. Intenta de nuevo." })
    }
  }
}

async function enrutar(s: Servicios, peticion: Request): Promise<Response> {
  const { pathname } = new URL(peticion.url)
  const metodo = peticion.method
  if (!pathname.startsWith("/api/")) {
    return metodo === "GET" ? servirEstatico(s.raizWeb, pathname) : json(405, { error: "Método no permitido." })
  }
  if (metodo === "GET" && pathname === "/api/health") return salud(s)
  if (!autorizado(s, peticion)) {
    return json(401, { error: "Este chat está protegido. Ingresa la clave de acceso." })
  }
  if (metodo === "POST" && pathname === "/api/chat") return chat(s, peticion)
  const idSesion = RUTA_SESION.exec(pathname)?.[1]
  if (metodo === "GET" && idSesion) return historial(s, idSesion)
  return json(404, { error: "Ruta no encontrada." })
}

/** GET /api/health: proveedor y modelo, nunca la clave. */
function salud(s: Servicios): Response {
  const { proveedor, modelo } = s.deps.llm
  return json(200, { ok: true, provider: proveedor, model: modelo, protegido: s.claveAcceso !== undefined })
}

/** POST /api/chat: un turno del agente. Con `stream: true` emite cada llamada a herramienta en vivo. */
async function chat(s: Servicios, peticion: Request): Promise<Response> {
  const cuerpo = CuerpoChat.safeParse(await leerCuerpo(peticion))
  if (!cuerpo.success) return json(400, { error: `Solicitud inválida → ${describirIssues(cuerpo.error)}` })
  if (s.presupuesto.agotado()) {
    return json(429, { error: "El servicio alcanzó su tope diario de uso del modelo. Intenta de nuevo mañana." })
  }
  const { sessionId, message, stream } = cuerpo.data
  const turno = (alLlamar?: AlLlamar): Promise<RespuestaTurno> =>
    s.sesiones.enSerie(sessionId, async (sesion) => {
      const antes = sesion.tokens
      const respuesta = await ejecutarTurno(sesion, message, { ...s.deps, alLlamar })
      s.presupuesto.sumar(sesion.tokens - antes)
      return respuesta
    })
  return stream ? enVivo(turno) : json(200, await turno())
}

/** GET /api/sessions/:id: historial completo de la sesión. */
function historial(s: Servicios, id: string): Response {
  const sesion = s.sesiones.buscar(id)
  if (!sesion) return json(404, { error: "La sesión no existe o ya expiró." })
  return json(200, {
    sessionId: sesion.id,
    historial: sesion.historial,
    tokens: sesion.tokens,
    needsConfirmation: hayPendientes(sesion.pendientes),
  })
}

/** Respuesta NDJSON: una línea por evento ("herramienta" durante el turno y "final" al terminar). */
function enVivo(turno: (alLlamar: AlLlamar) => Promise<RespuestaTurno>): Response {
  const codificador = new TextEncoder()
  const cuerpo = new ReadableStream<Uint8Array>({
    async start(control) {
      const emitir = (evento: unknown): void => {
        try {
          control.enqueue(codificador.encode(`${JSON.stringify(evento)}\n`))
        } catch {
          // El cliente cerró la conexión; el turno termina igual y queda en el historial.
        }
      }
      try {
        const respuesta = await turno((llamada) => emitir({ tipo: "herramienta", llamada }))
        emitir({ tipo: "final", ...respuesta })
      } catch (error) {
        console.error("Error no controlado en el turno:", error instanceof Error ? error.message : error)
        emitir({ tipo: "error", error: "Error interno del servidor. Intenta de nuevo." })
      }
      try {
        control.close()
      } catch {
        // Ya estaba cerrado por el cliente.
      }
    },
  })
  return new Response(cuerpo, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  })
}

function autorizado(s: Servicios, peticion: Request): boolean {
  if (s.claveAcceso === undefined) return true
  const recibida = Buffer.from(peticion.headers.get("x-clave-acceso") ?? "")
  const esperada = Buffer.from(s.claveAcceso)
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada)
}

async function leerCuerpo(peticion: Request): Promise<unknown> {
  try {
    return await peticion.json()
  } catch {
    return null
  }
}

function json(estado: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  })
}
