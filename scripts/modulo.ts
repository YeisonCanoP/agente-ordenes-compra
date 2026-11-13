import { readFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * Módulo reutilizable (PRD 9.4). Las tres piezas se generan desde los mismos archivos que usa la
 * aplicación, así que no pueden divergir: tests/modulo.test.ts falla si alguna queda desactualizada.
 *
 *   agent/prompt.md                 → modulo/agent.md
 *   src/tools/oc.ts (+ src/dominio) → modulo/tools/oc.ts
 *   src/knowledge/ordenes-compra.md → modulo/skill/ordenes-compra/SKILL.md
 */

const ENCABEZADO_AGENTE = `---
description: Prepara, valida y crea órdenes de compra en SAP a partir del paquete de una solicitud (correo, solicitud, cotización y aprobación), con confirmación humana antes de crear.
mode: primary
permission:
  edit: deny
  bash: deny
---
`

const ENCABEZADO_SKILL = `---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra de Periferia IT Group - piezas del paquete, flujo de las herramientas oc_*, reglas de control RC1 a RC10, OC retroactivas y log de control. Úsalo al procesar o explicar una solicitud de compra.
---
`

const AVISO_HERRAMIENTAS = `// @ts-nocheck
// GENERADO por \`bun run build:modulo\` a partir de src/tools/oc.ts. No editar a mano.
// Mismas herramientas que usa la aplicación, en un solo archivo y sin el servidor HTTP.
// Cada export es una herramienta: { description, args (zod), execute(args, ctx) }.
// Requiere el paquete \`zod\` (v4) y un runtime con los módulos node:fs, node:path y node:crypto.
`

/** Contenido esperado de cada archivo de modulo/, indexado por su ruta relativa. */
export async function generarModulo(directory: string): Promise<Record<string, string>> {
  const [prompt, conocimiento, herramientas] = await Promise.all([
    readFile(join(directory, "agent", "prompt.md"), "utf8"),
    readFile(join(directory, "src", "knowledge", "ordenes-compra.md"), "utf8"),
    empaquetarHerramientas(directory),
  ])
  return {
    "modulo/agent.md": `${ENCABEZADO_AGENTE}\n${prompt.trim()}\n`,
    "modulo/skill/ordenes-compra/SKILL.md": `${ENCABEZADO_SKILL}\n${conocimiento.trim()}\n`,
    "modulo/tools/oc.ts": `${AVISO_HERRAMIENTAS}\n${herramientas.trim()}\n`,
  }
}

/** Une src/tools/oc.ts y sus dependencias internas en un solo archivo; zod queda como import externo. */
async function empaquetarHerramientas(directory: string): Promise<string> {
  const resultado = await Bun.build({
    entrypoints: [join(directory, "src", "tools", "oc.ts")],
    root: directory,
    target: "node",
    format: "esm",
    external: ["zod"],
    minify: false,
  })
  const salida = resultado.outputs[0]
  if (!resultado.success || !salida) {
    throw new Error(`No se pudo empaquetar src/tools/oc.ts: ${resultado.logs.map(String).join("; ")}`)
  }
  return salida.text()
}
