import { afterAll, describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { cargarPrompt } from "../src/agent/prompt.ts"
import { OrdenCompraSchema, PaqueteSchema, ValidacionSchema } from "../src/dominio/esquemas.ts"
import * as oc from "../src/tools/oc.ts"
import type { Ctx } from "../src/tools/oc.ts"
import { interpretar } from "../src/tools/resultado.ts"
import { generarModulo } from "../scripts/modulo.ts"
import { RAIZ, directorioTemporal, limpiarTemporales } from "./ayuda.ts"

afterAll(limpiarTemporales)

type HerramientaSuelta = {
  description: string
  args: Record<string, unknown>
  execute(args: unknown, ctx: Ctx): Promise<string>
}

function esHerramienta(valor: unknown): valor is HerramientaSuelta {
  if (typeof valor !== "object" || valor === null) return false
  return (
    "description" in valor &&
    typeof valor.description === "string" &&
    "args" in valor &&
    typeof valor.args === "object" &&
    "execute" in valor &&
    typeof valor.execute === "function"
  )
}

/** Importa modulo/tools/oc.ts como lo haría otra plataforma: por ruta, sin el resto de la aplicación. */
async function herramientasDelModulo(): Promise<Record<string, HerramientaSuelta>> {
  const modulo: Record<string, unknown> = await import(join(RAIZ, "modulo", "tools", "oc.ts"))
  const herramientas: Record<string, HerramientaSuelta> = {}
  for (const [nombre, valor] of Object.entries(modulo)) {
    if (!esHerramienta(valor)) throw new Error(`El export "${nombre}" del módulo no es una herramienta`)
    herramientas[nombre] = valor
  }
  return herramientas
}

/** Quita el frontmatter (--- ... ---) y devuelve el cuerpo del Markdown. */
const cuerpo = (markdown: string): string => markdown.replace(/^---\n[\s\S]*?\n---\n/, "").trim()
const frontmatter = (markdown: string): string => /^---\n([\s\S]*?)\n---\n/.exec(markdown)?.[1] ?? ""

describe("módulo reutilizable (PRD 9.4)", () => {
  test("modulo/ está al día: coincide con lo que genera `bun run build:modulo`", async () => {
    const esperado = await generarModulo(RAIZ)
    expect(Object.keys(esperado).sort()).toEqual([
      "modulo/agent.md",
      "modulo/skill/ordenes-compra/SKILL.md",
      "modulo/tools/oc.ts",
    ])
    for (const [ruta, contenido] of Object.entries(esperado)) {
      const enDisco = await readFile(join(RAIZ, ruta), "utf8")
      expect(enDisco === contenido, `${ruta} está desactualizado: ejecuta \`bun run build:modulo\``).toBe(true)
    }
  })

  test("agent.md: frontmatter requerido y el mismo system prompt de la aplicación", async () => {
    const agente = await readFile(join(RAIZ, "modulo", "agent.md"), "utf8")
    const prompt = await readFile(join(RAIZ, "agent", "prompt.md"), "utf8")

    expect(frontmatter(agente)).toContain("description: ")
    expect(frontmatter(agente)).toContain("mode: primary")
    expect(frontmatter(agente)).toMatch(/permission:\n {2}edit: deny\n {2}bash: deny/)
    expect(cuerpo(agente)).toBe(prompt.trim())
    expect(await cargarPrompt(RAIZ)).toContain(cuerpo(agente))
  })

  test("SKILL.md: frontmatter requerido y el mismo conocimiento que consulta la aplicación", async () => {
    const skill = await readFile(join(RAIZ, "modulo", "skill", "ordenes-compra", "SKILL.md"), "utf8")
    const conocimiento = await readFile(join(RAIZ, "src", "knowledge", "ordenes-compra.md"), "utf8")

    expect(frontmatter(skill)).toContain("name: ordenes-compra")
    expect(frontmatter(skill)).toContain("description: ")
    expect(cuerpo(skill)).toBe(conocimiento.trim())
    expect(await cargarPrompt(RAIZ)).toContain(cuerpo(skill))
  })

  test("tools/oc.ts: mismos exports, descripciones y argumentos que src/tools/oc.ts", async () => {
    const delModulo = await herramientasDelModulo()
    const deLaApp: Record<string, HerramientaSuelta> = oc

    expect(Object.keys(delModulo).sort()).toEqual(Object.keys(deLaApp).sort())
    for (const [nombre, herramienta] of Object.entries(deLaApp)) {
      expect(delModulo[nombre]?.description).toBe(herramienta.description)
      expect(Object.keys(delModulo[nombre]?.args ?? {})).toEqual(Object.keys(herramienta.args))
    }
  })

  test("tools/oc.ts funciona sin el servidor: procesa sol-001 y bloquea sol-002", async () => {
    const { leer_paquete, validar, construir_payload, generar_evidencia, crear } = await herramientasDelModulo()
    if (!leer_paquete || !validar || !construir_payload || !generar_evidencia || !crear) {
      throw new Error("Al módulo le falta alguna herramienta")
    }
    const ctx: Ctx = { directory: await directorioTemporal(), sessionId: "otra-plataforma" }
    const Payload = z.object({ payload: OrdenCompraSchema })
    const Creada = z.object({ numero_oc: z.string(), idempotente: z.boolean() })
    const datos = <S extends z.ZodType>(esquema: S, salida: string): z.output<S> => {
      const resultado = interpretar(esquema, salida)
      if (!resultado.ok) throw new Error(resultado.error)
      return resultado.data
    }

    const caso = "sol-001"
    const paquete = datos(PaqueteSchema, await leer_paquete.execute({ caso }, ctx))
    const validacion = datos(ValidacionSchema, await validar.execute({ caso, paquete }, ctx))
    const { payload } = datos(
      Payload,
      await construir_payload.execute({ caso, paquete, derivados: validacion.derivados }, ctx),
    )
    await generar_evidencia.execute({ caso }, ctx)
    expect(datos(Creada, await crear.execute({ caso, payload }, ctx))).toEqual({
      numero_oc: "4500000001",
      idempotente: false,
    })

    const bloqueado = datos(PaqueteSchema, await leer_paquete.execute({ caso: "sol-002" }, ctx))
    const rechazo = datos(ValidacionSchema, await validar.execute({ caso: "sol-002", paquete: bloqueado }, ctx))
    expect(rechazo.apta).toBe(false)
    expect(rechazo.bloqueos.map((h) => h.regla)).toEqual(["RC1"])
  })
})
