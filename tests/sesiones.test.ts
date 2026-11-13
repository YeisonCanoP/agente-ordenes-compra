import { describe, expect, test } from "bun:test"
import { MAX_ENTRADAS_HISTORIAL, Sesiones, agregarAlHistorial } from "../src/agent/sesiones.ts"

describe("sesiones en memoria", () => {
  test("al superar el máximo se descarta la sesión usada hace más tiempo", () => {
    const sesiones = new Sesiones(2)
    sesiones.obtener("sesion-a")
    sesiones.obtener("sesion-b")
    sesiones.obtener("sesion-a")
    sesiones.obtener("sesion-c")

    expect(sesiones.buscar("sesion-b")).toBeNull()
    expect(sesiones.buscar("sesion-a")).not.toBeNull()
    expect(sesiones.buscar("sesion-c")).not.toBeNull()
  })

  test("nunca se descarta una sesión con un turno en curso", async () => {
    const sesiones = new Sesiones(1)
    let terminar: () => void = () => undefined
    const enCurso = sesiones.ejecutar("sesion-activa", () => new Promise<void>((resolver) => (terminar = resolver)))

    sesiones.obtener("sesion-nueva")
    expect(sesiones.estaOcupada("sesion-activa")).toBe(true)
    expect(sesiones.buscar("sesion-activa")).not.toBeNull()
    expect(sesiones.turnosActivos).toBe(1)

    terminar()
    await enCurso
    expect(sesiones.turnosActivos).toBe(0)
  })

  test("el historial visible conserva solo las entradas más recientes", () => {
    const sesion = new Sesiones().obtener("sesion-larga")
    for (let i = 0; i < MAX_ENTRADAS_HISTORIAL + 25; i++) {
      agregarAlHistorial(sesion, { rol: "usuario", contenido: `mensaje ${i}`, ts: "2026-01-01T00:00:00Z" })
    }
    expect(sesion.historial).toHaveLength(MAX_ENTRADAS_HISTORIAL)
    expect(sesion.historial.at(-1)?.contenido).toBe(`mensaje ${MAX_ENTRADAS_HISTORIAL + 24}`)
  })
})
