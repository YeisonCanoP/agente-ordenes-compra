/**
 * Chat de terminal para probar el agente sin el front. Necesita OPENAI_API_KEY en .env.
 * Uso: bun run chat
 */
import { dirname } from "node:path"
import { createInterface } from "node:readline/promises"
import { fileURLToPath } from "node:url"
import { ejecutarTurno } from "../src/agent/ciclo.ts"
import type { Dependencias } from "../src/agent/ciclo.ts"
import { cargarPrompt } from "../src/agent/prompt.ts"
import { Sesiones } from "../src/agent/sesiones.ts"
import { leerConfig } from "../src/config.ts"
import { OpenAiAdapter } from "../src/llm/openai.ts"

const directory = dirname(dirname(fileURLToPath(import.meta.url)))
const config = leerConfig()
const llm = new OpenAiAdapter(config.llm)
const deps: Dependencias = {
  llm,
  directory,
  promptSistema: await cargarPrompt(directory),
  limites: config.agente,
  alLlamar: (llamada) => console.log(`  🔧 ${llamada.nombre} → ${llamada.ok ? "ok" : "error"} · ${llamada.resumen}`),
}
const sesion = new Sesiones().obtener(`terminal-${Date.now()}`)
const consola = createInterface({ input: process.stdin, output: process.stdout })

console.log(`Agente de órdenes de compra · ${llm.proveedor} / ${llm.modelo}`)
console.log('Escribe tu mensaje (por ejemplo: Procesa la solicitud "sol-004") o "salir".\n')

consola.setPrompt("tú > ")
consola.prompt()
for await (const linea of consola) {
  const mensaje = linea.trim()
  if (mensaje === "" || mensaje.toLowerCase() === "salir") break
  const respuesta = await ejecutarTurno(sesion, mensaje, deps)
  console.log(`\nagente > ${respuesta.reply}\n`)
  if (respuesta.needsConfirmation) console.log("  ⚠️  El agente espera tu confirmación.\n")
  console.log(`  (tokens usados en la sesión: ${sesion.tokens})\n`)
  consola.prompt()
}
consola.close()
