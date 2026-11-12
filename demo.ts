/**
 * Verificación sin modelo (PRD 6.6): procesa los 6 casos llamando directamente a las herramientas.
 * No necesita clave de ningún proveedor. Uso: bun run demo.ts
 */
import { readdir, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { OrdenCompraSchema, PaqueteSchema, ValidacionSchema } from "./src/dominio/esquemas.ts"
import type { Hallazgo, OrdenCompra, Validacion } from "./src/dominio/esquemas.ts"
import { construir_payload, crear, generar_evidencia, leer_paquete, validar } from "./src/tools/oc.ts"
import type { Ctx } from "./src/tools/oc.ts"
import { interpretar } from "./src/tools/resultado.ts"

const PayloadSchema = z.object({ payload: OrdenCompraSchema, trazabilidad: z.string() })
const EvidenciaSchema = z.object({ ruta: z.string(), sha256: z.string() })
const CreadaSchema = z.object({
  numero_oc: z.string(),
  fecha: z.string(),
  idempotente: z.boolean(),
  evidencia: z.string(),
})

/** Casos en los que la demo simula que la analista responde "confirmo". */
const CONFIRMAR = new Set(["sol-004"])
/** Caso que se ejecuta dos veces para mostrar la idempotencia. */
const REPETIR = "sol-001"

const ctx: Ctx = { directory: dirname(fileURLToPath(import.meta.url)), sessionId: "demo" }
const resumen: string[] = []

await rm(join(ctx.directory, "out"), { recursive: true, force: true })
const casos = (await readdir(join(ctx.directory, "fixtures", "reto-03", "solicitudes"))).sort()

for (const caso of casos) await procesar(caso)

console.log(`\n━━ Idempotencia: ${REPETIR} por segunda vez ━━`)
await procesar(REPETIR)

console.log("\n━━ Resumen ━━")
for (const linea of resumen) console.log(`  ${linea}`)
console.log("\nLog de control: out/control.csv · Órdenes: out/sap/ordenes.jsonl")

async function procesar(caso: string): Promise<void> {
  console.log(`\n━━ ${caso} ━━`)
  const leido = interpretar(PaqueteSchema, await leer_paquete.execute({ caso }, ctx))
  if (!leido.ok) return anotar(caso, `ERROR · ${leido.error}`)

  const validado = interpretar(ValidacionSchema, await validar.execute({ caso, paquete: leido.data }, ctx))
  if (!validado.ok) return anotar(caso, `ERROR · ${validado.error}`)
  imprimirValidacion(validado.data)
  if (!validado.data.apta) return anotar(caso, `BLOQUEADA · ${reglas(validado.data.bloqueos)}`)

  const construido = interpretar(
    PayloadSchema,
    await construir_payload.execute({ caso, paquete: leido.data, derivados: validado.data.derivados }, ctx),
  )
  if (!construido.ok) return anotar(caso, `ERROR · ${construido.error}`)
  imprimirPayload(construido.data.payload)

  const evidencia = interpretar(EvidenciaSchema, await generar_evidencia.execute({ caso }, ctx))
  if (!evidencia.ok) return anotar(caso, `ERROR · ${evidencia.error}`)
  console.log(`  evidencia: ${evidencia.data.ruta} (sha256 ${evidencia.data.sha256.slice(0, 12)}…)`)

  await crearOrden(caso, construido.data.payload, validado.data)
}

/** Primer intento sin confirmar; si queda pendiente y el caso está en CONFIRMAR, se confirma. */
async function crearOrden(caso: string, payload: OrdenCompra, validacion: Validacion): Promise<void> {
  const intento = interpretar(CreadaSchema, await crear.execute({ caso, payload }, ctx))
  if (intento.ok) return anotarCreada(caso, intento.data)
  console.log(`  crear (sin confirmar): rechazada → ${intento.error}`)
  if (!CONFIRMAR.has(caso)) return anotar(caso, `PENDIENTE · requiere confirmación (${reglas(validacion.confirmaciones)})`)

  console.log('  la analista responde "confirmo" → crear con confirmado: true')
  const confirmada = interpretar(CreadaSchema, await crear.execute({ caso, payload, confirmado: true }, ctx))
  if (!confirmada.ok) return anotar(caso, `ERROR · ${confirmada.error}`)
  anotarCreada(caso, confirmada.data, ` · confirmada (${reglas(validacion.confirmaciones)})`)
}

function imprimirValidacion(v: Validacion): void {
  console.log(`  apta: ${v.apta ? "sí" : "no"} · retroactiva: ${v.retroactiva ? "sí" : "no"}`)
  imprimirHallazgos("bloqueos", v.bloqueos)
  imprimirHallazgos("confirmaciones", v.confirmaciones)
  for (const [campo, d] of Object.entries(v.derivados)) {
    console.log(`  derivado: ${campo} = ${d.valor} (${d.fuente})`)
  }
}

function imprimirHallazgos(titulo: string, hallazgos: Hallazgo[]): void {
  if (hallazgos.length === 0) return console.log(`  ${titulo}: ninguno`)
  console.log(`  ${titulo}:`)
  for (const h of hallazgos) {
    console.log(`    [${h.regla}] ${h.mensaje}`)
    console.log(`           acción: ${h.accion_sugerida}`)
  }
}

function imprimirPayload(orden: OrdenCompra): void {
  const { proveedor, moneda, condiciones_pago } = orden
  console.log(`  payload: proveedor ${proveedor.codigo_sap} ${proveedor.nombre} · ${moneda} · pago ${condiciones_pago}`)
  for (const p of orden.posiciones) {
    console.log(
      `    pos ${p.numero}: "${p.descripcion}" · ${p.cantidad} ${p.unidad} × ${p.precio_unitario} · ${p.centro_costo}/${p.subarea} · IVA ${p.indicador_iva}`,
    )
  }
}

function anotarCreada(caso: string, creada: z.infer<typeof CreadaSchema>, nota = ""): void {
  const tipo = creada.idempotente ? "OC EXISTENTE (idempotente: true)" : "OC CREADA"
  anotar(caso, `${tipo} · ${creada.numero_oc}${nota} · evidencia ${creada.evidencia}`)
}

function anotar(caso: string, linea: string): void {
  console.log(`  resultado: ${linea}`)
  resumen.push(`${caso}  ${linea}`)
}

function reglas(hallazgos: Hallazgo[]): string {
  return hallazgos.map((h) => h.regla).join(", ")
}
