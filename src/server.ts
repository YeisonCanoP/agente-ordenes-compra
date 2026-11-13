/**
 * Servidor del agente: API del chat y front estático en un solo proceso.
 * Uso: bun run dev (recarga al guardar) o bun run start.
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { cargarPrompt } from "./agent/prompt.ts"
import { Sesiones } from "./agent/sesiones.ts"
import { leerConfig } from "./config.ts"
import { crearManejador } from "./http/api.ts"
import { Presupuesto } from "./http/presupuesto.ts"
import { OpenAiAdapter } from "./llm/openai.ts"

const directory = dirname(dirname(fileURLToPath(import.meta.url)))
const config = leerConfig()
const llm = new OpenAiAdapter(config.llm)

const manejar = crearManejador({
  deps: { llm, directory, promptSistema: await cargarPrompt(directory), limites: config.agente },
  sesiones: new Sesiones(config.servidor.maxSesiones),
  presupuesto: await Presupuesto.abrir(config.servidor.maxTokensDia, join(directory, "out", "presupuesto.json")),
  maxTurnosSimultaneos: config.servidor.maxTurnosSimultaneos,
  claveAcceso: config.servidor.claveAcceso,
  raizWeb: join(directory, "web"),
})

const servidor = Bun.serve({
  port: config.puerto,
  // Un turno puede tardar más que los 10 s por defecto mientras el modelo responde.
  idleTimeout: 255,
  maxRequestBodySize: 64 * 1024,
  fetch: manejar,
})

console.log(`Agente de órdenes de compra en http://localhost:${servidor.port}`)
console.log(`  modelo: ${llm.proveedor} / ${llm.modelo}`)
console.log(`  clave del modelo: ${config.llm.apiKey ? "configurada" : "FALTA (define OPENAI_API_KEY en .env)"}`)
console.log(`  acceso: ${config.servidor.claveAcceso ? "protegido con clave" : "público"}`)
