import { afterAll, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { z } from "zod"
import { cargarPrompt } from "../src/agent/prompt.ts"
import { Sesiones } from "../src/agent/sesiones.ts"
import { crearManejador } from "../src/http/api.ts"
import { Presupuesto } from "../src/http/presupuesto.ts"
import { LlmGuionado, RAIZ, decir, directorioTemporal, limpiarTemporales, pasosHastaCrear } from "./ayuda.ts"
import type { Paso } from "./ayuda.ts"

afterAll(limpiarTemporales)

const SESION = "sesion-de-prueba"
const Turno = z.object({
  reply: z.string(),
  toolCalls: z.array(z.object({ nombre: z.string(), ok: z.boolean(), resumen: z.string() })),
  needsConfirmation: z.boolean(),
})
const ConError = z.object({ error: z.string() })

type Opciones = { claveAcceso?: string; maxTokensDia?: number }

async function api(pasos: Paso[], opciones: Opciones = {}) {
  const directory = await directorioTemporal()
  const manejar = crearManejador({
    deps: {
      llm: new LlmGuionado(pasos),
      directory,
      promptSistema: await cargarPrompt(RAIZ),
      limites: { maxIteraciones: 25, maxTokensSesion: 100_000 },
    },
    sesiones: new Sesiones(),
    presupuesto: new Presupuesto(opciones.maxTokensDia ?? 1_000_000),
    claveAcceso: opciones.claveAcceso,
    raizWeb: join(RAIZ, "web"),
  })
  const get = (ruta: string, cabeceras: Record<string, string> = {}) =>
    manejar(new Request(`http://localhost${ruta}`, { headers: cabeceras }))
  const chat = (cuerpo: unknown, cabeceras: Record<string, string> = {}) =>
    manejar(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabeceras },
        body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
      }),
    )
  return { get, chat }
}

const guionSol001 = (): Paso[] => [...pasosHastaCrear("sol-001"), () => decir("OC 4500000001 creada.")]
const errorDe = async (respuesta: Response) => ConError.parse(await respuesta.json()).error

describe("API del chat", () => {
  test("GET /api/health informa proveedor y modelo, sin claves", async () => {
    const { get } = await api([])
    const respuesta = await get("/api/health")
    expect(respuesta.status).toBe(200)
    expect(await respuesta.json()).toEqual({ ok: true, provider: "prueba", model: "guion", protegido: false })
  })

  test("POST /api/chat procesa un turno y GET /api/sessions/:id devuelve el historial", async () => {
    const { get, chat } = await api(guionSol001())
    const respuesta = await chat({ sessionId: SESION, message: 'Procesa la solicitud "sol-001"' })
    expect(respuesta.status).toBe(200)

    const turno = Turno.parse(await respuesta.json())
    expect(turno.reply).toBe("OC 4500000001 creada.")
    expect(turno.toolCalls).toHaveLength(5)
    expect(turno.needsConfirmation).toBe(false)

    const historial = await get(`/api/sessions/${SESION}`)
    expect(historial.status).toBe(200)
    expect(await historial.json()).toMatchObject({
      sessionId: SESION,
      needsConfirmation: false,
      historial: [
        { rol: "usuario", contenido: 'Procesa la solicitud "sol-001"' },
        { rol: "asistente", contenido: "OC 4500000001 creada." },
      ],
    })
  })

  test("con stream: true emite cada llamada a herramienta y un evento final", async () => {
    const { chat } = await api(guionSol001())
    const respuesta = await chat({ sessionId: SESION, message: "Procesa sol-001", stream: true })
    expect(respuesta.headers.get("Content-Type")).toContain("application/x-ndjson")

    const eventos = (await respuesta.text())
      .trim()
      .split("\n")
      .map((linea) => z.object({ tipo: z.string() }).loose().parse(JSON.parse(linea)))
    expect(eventos.map((e) => e.tipo)).toEqual([
      "herramienta",
      "herramienta",
      "herramienta",
      "herramienta",
      "herramienta",
      "final",
    ])
    expect(eventos.at(-1)).toMatchObject({ reply: "OC 4500000001 creada.", needsConfirmation: false })
  })

  test("rechaza cuerpos inválidos con 400 y un mensaje claro", async () => {
    const { chat } = await api([])
    expect(await errorDe(await chat("{ no es json"))).toContain("Solicitud inválida")
    expect(await errorDe(await chat({ sessionId: "../x", message: "hola" }))).toContain("sessionId")
    expect(await errorDe(await chat({ sessionId: SESION, message: "   " }))).toContain("no puede estar vacío")
    const largo = await chat({ sessionId: SESION, message: "a".repeat(4001) })
    expect(largo.status).toBe(400)
    expect(await errorDe(largo)).toContain("4000 caracteres")
  })

  test("sesión desconocida y rutas inexistentes responden 404", async () => {
    const { get } = await api([])
    expect((await get("/api/sessions/no-existe-esta")).status).toBe(404)
    expect((await get("/api/otra-cosa")).status).toBe(404)
    expect((await get("/.env")).status).toBe(404)
    expect((await get("/../.env")).status).toBe(404)
  })

  test("con clave de acceso, el chat exige la cabecera correcta", async () => {
    const { get, chat } = await api([() => decir("Hola.")], { claveAcceso: "clave-de-prueba" })
    const cuerpo = { sessionId: SESION, message: "Hola" }

    expect((await chat(cuerpo)).status).toBe(401)
    expect((await chat(cuerpo, { "x-clave-acceso": "incorrecta" })).status).toBe(401)
    expect((await get(`/api/sessions/${SESION}`)).status).toBe(401)
    expect((await chat(cuerpo, { "x-clave-acceso": "clave-de-prueba" })).status).toBe(200)
    expect(await (await get("/api/health")).json()).toMatchObject({ ok: true, protegido: true })
  })

  test("al agotar el tope diario de tokens responde 429 sin llamar al modelo", async () => {
    const { chat } = await api([() => decir("Hola.")], { maxTokensDia: 10 })
    expect((await chat({ sessionId: SESION, message: "Hola" })).status).toBe(200)

    const segundo = await chat({ sessionId: SESION, message: "Hola de nuevo" })
    expect(segundo.status).toBe(429)
    expect(await errorDe(segundo)).toContain("tope diario")
  })
})
