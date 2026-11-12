import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import type { z } from "zod"

/** Error con un mensaje pensado para mostrarse tal cual a la analista. */
export class ErrorLegible extends Error {}

const NOMBRE_CASO = /^[a-z0-9][a-z0-9_-]*$/i

export const rutaFixtures = (directory: string) => join(directory, "fixtures", "reto-03")
export const rutaMaestro = (directory: string, archivo: string) =>
  join(rutaFixtures(directory), "maestros", archivo)
export const rutaCaso = (directory: string, caso: string) =>
  join(rutaFixtures(directory), "solicitudes", caso)
export const rutaSalida = (directory: string, ...partes: string[]) =>
  join(directory, "out", ...partes)

/** Impide rutas absolutas o con "..": el caso es solo el nombre de una carpeta. */
export function validarNombreCaso(caso: string): void {
  if (!NOMBRE_CASO.test(caso)) {
    throw new ErrorLegible(
      `"${caso}" no es un nombre de caso válido. Usa solo el nombre de la carpeta, por ejemplo "sol-001".`,
    )
  }
}

export async function existe(ruta: string): Promise<boolean> {
  try {
    await stat(ruta)
    return true
  } catch {
    return false
  }
}

/** Devuelve null si el archivo no existe; cualquier otro error se propaga. */
export async function leerTexto(ruta: string): Promise<string | null> {
  try {
    return await readFile(ruta, "utf8")
  } catch (error) {
    if (esNoEncontrado(error)) return null
    throw error
  }
}

export async function leerJson<S extends z.ZodType>(
  ruta: string,
  esquema: S,
  nombre: string,
): Promise<z.output<S> | null> {
  const contenido = await leerTexto(ruta)
  if (contenido === null) return null
  const resultado = esquema.safeParse(parsearJson(contenido, nombre))
  if (!resultado.success) {
    throw new ErrorLegible(`${nombre} tiene datos inválidos → ${describirIssues(resultado.error)}`)
  }
  return resultado.data
}

export function describirIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join(".") || "(raíz)"}: ${issue.message}`)
    .join("; ")
}

function parsearJson(contenido: string, nombre: string): unknown {
  try {
    return JSON.parse(contenido)
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error)
    throw new ErrorLegible(`${nombre} no es un JSON válido (${detalle}).`)
  }
}

function esNoEncontrado(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
