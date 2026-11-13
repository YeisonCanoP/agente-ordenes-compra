import { readFile } from "node:fs/promises"
import { join } from "node:path"

/** Lista cerrada de archivos del front: ninguna ruta del usuario llega al sistema de archivos. */
const ARCHIVOS: Record<string, { archivo: string; tipo: string }> = {
  "/": { archivo: "index.html", tipo: "text/html; charset=utf-8" },
  "/app.js": { archivo: "app.js", tipo: "text/javascript; charset=utf-8" },
  "/estilos.css": { archivo: "estilos.css", tipo: "text/css; charset=utf-8" },
}

const CABECERAS_SEGURAS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'; base-uri 'none'",
  "Cache-Control": "no-cache",
}

export async function servirEstatico(raizWeb: string, ruta: string): Promise<Response> {
  const entrada = ARCHIVOS[ruta]
  if (!entrada) return new Response("No encontrado", { status: 404 })
  const contenido = await readFile(join(raizWeb, entrada.archivo))
  return new Response(contenido, { headers: { "Content-Type": entrada.tipo, ...CABECERAS_SEGURAS } })
}
