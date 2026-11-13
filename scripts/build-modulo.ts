/**
 * Genera la carpeta modulo/ (bonus del PRD 9.4) desde los archivos de la aplicación.
 * Uso: bun run build:modulo
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { generarModulo } from "./modulo.ts"

const directory = dirname(dirname(fileURLToPath(import.meta.url)))

for (const [ruta, contenido] of Object.entries(await generarModulo(directory))) {
  const destino = join(directory, ruta)
  await mkdir(dirname(destino), { recursive: true })
  await writeFile(destino, contenido, "utf8")
  console.log(`generado ${ruta} (${contenido.length} caracteres)`)
}
