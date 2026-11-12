import { join } from "node:path"
import { z } from "zod"
import { ErrorLegible, existe, leerJson, leerTexto, rutaCaso, validarNombreCaso } from "./archivos.ts"
import { SolicitudSchema } from "./esquemas.ts"
import type { Aprobacion, Paquete } from "./esquemas.ts"
import { esAprobado, parsearCotizacion, parsearFactura } from "./parsers.ts"

const CorreoCrudoSchema = z.object({
  id: z.string().min(1),
  de: z.string().min(1),
  asunto: z.string(),
  fecha: z.string().min(1),
  adjuntos: z.array(z.string()).default([]),
})

export const AprobacionCrudaSchema = z.object({
  de: z.string().min(1),
  para: z.string().optional(),
  cc: z.array(z.string()).optional(),
  fecha: z.string().min(1),
  asunto: z.string().optional(),
  cuerpo: z.string(),
})

export type AprobacionCruda = z.infer<typeof AprobacionCrudaSchema>
export type PaqueteLeido = { paquete: Paquete; faltantes: string[] }

/** Lee los archivos de un caso y los normaliza según la sección 7.2 del PRD. */
export async function leerPaquete(directory: string, caso: string): Promise<PaqueteLeido> {
  const carpeta = await carpetaDelCaso(directory, caso)
  const [correo, solicitud, textoCotizacion, cruda, textoFactura] = await Promise.all([
    leerJson(join(carpeta, "correo.json"), CorreoCrudoSchema, "correo.json"),
    leerJson(join(carpeta, "solicitud.json"), SolicitudSchema, "solicitud.json"),
    leerTexto(join(carpeta, "cotizacion.txt")),
    leerJson(join(carpeta, "aprobacion.json"), AprobacionCrudaSchema, "aprobacion.json"),
    leerTexto(join(carpeta, "factura.txt")),
  ])
  if (!correo || !solicitud) throw paqueteIncompleto(caso, correo === null, solicitud === null)

  const paquete: Paquete = {
    correo: { id: correo.id, de: correo.de, asunto: correo.asunto, fecha: correo.fecha },
    solicitud,
    cotizacion: textoCotizacion === null ? null : parsearCotizacion(textoCotizacion),
    aprobacion: cruda === null ? null : normalizarAprobacion(cruda),
    factura: textoFactura === null ? null : parsearFactura(textoFactura),
  }
  return { paquete, faltantes: listarFaltantes(paquete, correo.adjuntos) }
}

export async function leerAprobacionCruda(directory: string, caso: string): Promise<AprobacionCruda | null> {
  const carpeta = await carpetaDelCaso(directory, caso)
  return leerJson(join(carpeta, "aprobacion.json"), AprobacionCrudaSchema, "aprobacion.json")
}

async function carpetaDelCaso(directory: string, caso: string): Promise<string> {
  validarNombreCaso(caso)
  const carpeta = rutaCaso(directory, caso)
  if (!(await existe(carpeta))) {
    throw new ErrorLegible(`No existe el caso "${caso}" en fixtures/reto-03/solicitudes/.`)
  }
  return carpeta
}

function normalizarAprobacion(cruda: AprobacionCruda): Aprobacion {
  return { de: cruda.de, fecha: cruda.fecha, aprobado: esAprobado(cruda.cuerpo), texto: cruda.cuerpo }
}

/** La factura solo cuenta como faltante si el correo la anuncia entre sus adjuntos. */
function listarFaltantes(paquete: Paquete, adjuntos: string[]): string[] {
  const anunciaFactura = adjuntos.some((adjunto) => adjunto.toLowerCase().startsWith("factura"))
  return [
    ...(paquete.cotizacion === null ? ["cotizacion.txt"] : []),
    ...(paquete.aprobacion === null ? ["aprobacion.json"] : []),
    ...(paquete.factura === null && anunciaFactura ? ["factura.txt"] : []),
  ]
}

function paqueteIncompleto(caso: string, faltaCorreo: boolean, faltaSolicitud: boolean): ErrorLegible {
  const faltan = [...(faltaCorreo ? ["correo.json"] : []), ...(faltaSolicitud ? ["solicitud.json"] : [])]
  return new ErrorLegible(
    `Paquete incompleto en "${caso}": falta ${faltan.join(" y ")}. Pide al solicitante que reenvíe el correo con la solicitud adjunta.`,
  )
}
