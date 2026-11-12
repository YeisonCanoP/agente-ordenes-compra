import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { ErrorLegible, rutaSalida } from "./archivos.ts"
import { leerAprobacionCruda } from "./paquete.ts"
import type { AprobacionCruda } from "./paquete.ts"

export type Evidencia = { ruta: string; sha256: string }

export const sha256 = (contenido: string): string =>
  createHash("sha256").update(contenido, "utf8").digest("hex")

/** Texto de la evidencia (HU-4): encabezados del correo y cuerpo. Determinista. */
export function contenidoEvidencia(aprobacion: AprobacionCruda): string {
  return [
    "EVIDENCIA DE APROBACIÓN",
    `De: ${aprobacion.de}`,
    `Para: ${aprobacion.para ?? "(no informado)"}`,
    `CC: ${aprobacion.cc?.join(", ") || "(sin copia)"}`,
    `Fecha: ${aprobacion.fecha}`,
    `Asunto: ${aprobacion.asunto ?? "(sin asunto)"}`,
    "",
    aprobacion.cuerpo,
  ].join("\n")
}

/** Lee la aprobación original del caso; falla con mensaje claro si no existe. */
export async function aprobacionDelCaso(directory: string, caso: string): Promise<AprobacionCruda> {
  const aprobacion = await leerAprobacionCruda(directory, caso)
  if (!aprobacion) {
    throw new ErrorLegible(
      `El caso "${caso}" no trae correo de aprobación; no hay evidencia que generar. Pídelo al solicitante.`,
    )
  }
  return aprobacion
}

/** Escribe out/<caso>/aprobacion.txt con el contenido y su sha256. */
export async function generarEvidencia(directory: string, caso: string): Promise<Evidencia> {
  const contenido = contenidoEvidencia(await aprobacionDelCaso(directory, caso))
  const hash = sha256(contenido)
  await mkdir(rutaSalida(directory, caso), { recursive: true })
  await writeFile(rutaSalida(directory, caso, "aprobacion.txt"), `${contenido}\n\n---\nsha256: ${hash}\n`, "utf8")
  return { ruta: `out/${caso}/aprobacion.txt`, sha256: hash }
}
