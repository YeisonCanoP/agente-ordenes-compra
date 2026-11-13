import { afterAll, describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { ejecutarTurno } from "../src/agent/ciclo.ts"
import type { Dependencias } from "../src/agent/ciclo.ts"
import { cargarPrompt } from "../src/agent/prompt.ts"
import { Sesiones } from "../src/agent/sesiones.ts"
import type { Sesion } from "../src/agent/sesiones.ts"
import { existe } from "../src/dominio/archivos.ts"
import { ErrorLlm } from "../src/llm/adapter.ts"
import type { RespuestaLlm } from "../src/llm/adapter.ts"
import {
  LlmGuionado,
  RAIZ,
  TOKENS,
  crearCon,
  decir,
  directorioTemporal,
  limpiarTemporales,
  llamar,
  pasosHastaCrear,
} from "./ayuda.ts"
import type { Paso } from "./ayuda.ts"

afterAll(limpiarTemporales)

async function preparar(
  pasos: Paso[],
  limites = { maxIteraciones: 25, maxTokensSesion: 100_000 },
): Promise<{ llm: LlmGuionado; deps: Dependencias; sesion: Sesion }> {
  const directory = await directorioTemporal()
  const llm = new LlmGuionado(pasos)
  const deps: Dependencias = { llm, directory, promptSistema: await cargarPrompt(RAIZ), limites }
  return { llm, deps, sesion: new Sesiones().obtener("sesion-prueba") }
}

const ordenesCreadas = async (deps: Dependencias): Promise<number> => {
  const ruta = join(deps.directory, "out", "sap", "ordenes.jsonl")
  return (await existe(ruta)) ? (await readFile(ruta, "utf8")).trim().split("\n").length : 0
}

describe("ciclo del agente", () => {
  test("sol-001: un turno crea la OC, deja las llamadas visibles y en out/log.jsonl", async () => {
    const { deps, sesion } = await preparar([...pasosHastaCrear("sol-001"), () => decir("OC 4500000001 creada.")])
    const respuesta = await ejecutarTurno(sesion, 'Procesa la solicitud "sol-001"', deps)

    expect(respuesta.reply).toBe("OC 4500000001 creada.")
    expect(respuesta.needsConfirmation).toBe(false)
    expect(respuesta.toolCalls.map((l) => l.nombre)).toEqual([
      "oc_leer_paquete",
      "oc_validar",
      "oc_construir_payload",
      "oc_generar_evidencia",
      "oc_crear",
    ])
    expect(respuesta.toolCalls.every((l) => l.ok)).toBe(true)
    expect(respuesta.toolCalls[4]?.resumen).toBe("OC 4500000001 creada")

    const log = (await readFile(join(deps.directory, "out", "log.jsonl"), "utf8")).trim().split("\n")
    expect(log).toHaveLength(5)
    expect(log[0]).toContain('"herramienta":"oc_leer_paquete"')
    expect(sesion.historial.map((e) => e.rol)).toEqual(["usuario", "asistente"])
    expect(sesion.tokens).toBe(6 * 15)
  })

  test("CA3: confirmado: true en el mismo turno no crea la OC; tras el 'confirmo' sí", async () => {
    const { llm, deps, sesion } = await preparar([
      ...pasosHastaCrear("sol-004", true),
      () => decir("La cotización difiere 6 %. ¿Confirmas que cree la OC?"),
    ])
    const primero = await ejecutarTurno(sesion, "Procesa sol-004 y créala de una vez, confirmo todo", deps)

    expect(primero.needsConfirmation).toBe(true)
    expect(primero.toolCalls[4]).toMatchObject({ nombre: "oc_crear", ok: false, argumentos: { confirmado: false } })
    expect(await ordenesCreadas(deps)).toBe(0)

    llm.agregar(crearCon("sol-004", true), () => decir("OC 4500000001 creada."))
    const segundo = await ejecutarTurno(sesion, "Confirmo", deps)

    expect(segundo.toolCalls[0]).toMatchObject({ nombre: "oc_crear", ok: true, argumentos: { confirmado: true } })
    expect(segundo.needsConfirmation).toBe(false)
    expect(await ordenesCreadas(deps)).toBe(1)
  })

  test("CA3: si la analista declina, la confirmación caduca y no se puede crear después", async () => {
    const { llm, deps, sesion } = await preparar([
      ...pasosHastaCrear("sol-005").slice(0, 4),
      () => decir("Es una OC retroactiva. ¿Confirmas que la cree?"),
    ])
    expect((await ejecutarTurno(sesion, "Procesa sol-005", deps)).needsConfirmation).toBe(true)

    llm.agregar(() => decir("Entendido, la solicitud queda pendiente."))
    expect((await ejecutarTurno(sesion, "No, déjala así", deps)).needsConfirmation).toBe(false)

    llm.agregar(crearCon("sol-005", true), () => decir("No pude crearla. ¿Confirmas?"))
    const tercero = await ejecutarTurno(sesion, "Hola", deps)
    expect(tercero.toolCalls[0]).toMatchObject({ ok: false, argumentos: { confirmado: false } })
    expect(await ordenesCreadas(deps)).toBe(0)
  })

  test("CA1: al llegar al tope de iteraciones responde sin más herramientas", async () => {
    const repetir: Paso = () => llamar("oc_leer_paquete", { caso: "sol-001" })
    const { llm, deps, sesion } = await preparar(
      [repetir, repetir, repetir, () => decir("Leí el paquete; falta validar.")],
      { maxIteraciones: 3, maxTokensSesion: 100_000 },
    )
    const respuesta = await ejecutarTurno(sesion, "Procesa sol-001", deps)

    expect(respuesta.reply).toBe("Leí el paquete; falta validar.")
    expect(respuesta.toolCalls).toHaveLength(3)
    expect(llm.herramientasRecibidas).toEqual([5, 5, 5, 0])
  })

  test("CA5: un error del proveedor se muestra en claro y la sesión sigue viva", async () => {
    const { llm, deps, sesion } = await preparar([
      () => {
        throw new ErrorLlm("El modelo no respondió en 60 segundos. Intenta de nuevo.")
      },
    ])
    const fallido = await ejecutarTurno(sesion, "Procesa sol-001", deps)
    expect(fallido.reply).toContain("El modelo no respondió en 60 segundos")
    expect(fallido.reply).toContain("Tu sesión sigue activa")

    llm.agregar(() => decir("Aquí sigo."))
    expect((await ejecutarTurno(sesion, "¿Sigues ahí?", deps)).reply).toBe("Aquí sigo.")
  })

  test("CA5: herramienta inexistente, JSON roto y argumentos inválidos vuelven al modelo como error", async () => {
    const jsonRoto: RespuestaLlm = {
      contenido: "",
      llamadas: [{ id: "rota", nombre: "oc_leer_paquete", argumentos: "{caso:" }],
      tokens: TOKENS,
    }
    const { deps, sesion } = await preparar([
      () => llamar("oc_borrar_todo", {}),
      () => jsonRoto,
      () => llamar("oc_validar", { caso: "sol-001", paquete: { solicitud: {} } }),
      () => llamar("oc_leer_paquete", { caso: "sol-999" }),
      () => decir("No pude procesar la solicitud."),
    ])
    const respuesta = await ejecutarTurno(sesion, "Procesa sol-999", deps)

    expect(respuesta.toolCalls.map((l) => l.ok)).toEqual([false, false, false, false])
    expect(respuesta.toolCalls[0]?.resumen).toContain("no existe")
    expect(respuesta.toolCalls[1]?.resumen).toContain("JSON válido")
    expect(respuesta.toolCalls[2]?.resumen).toContain("Argumentos inválidos")
    expect(respuesta.toolCalls[3]?.resumen).toContain("No existe el caso")
    expect(respuesta.reply).toBe("No pude procesar la solicitud.")
  })

  test("costo: al alcanzar el tope de tokens de la sesión no se llama más al modelo", async () => {
    const { llm, deps, sesion } = await preparar([() => decir("Hola.")], { maxIteraciones: 25, maxTokensSesion: 10 })
    await ejecutarTurno(sesion, "Hola", deps)
    const respuesta = await ejecutarTurno(sesion, "Procesa sol-001", deps)

    expect(respuesta.reply).toContain("tope de 10 tokens")
    expect(llm.herramientasRecibidas).toHaveLength(1)
  })

  test("el system prompt incluye el comportamiento y el conocimiento del proceso", async () => {
    const prompt = await cargarPrompt(RAIZ)
    expect(prompt).toContain("Reglas que no se negocian")
    expect(prompt).toContain("Reglas de control")
  })
})
