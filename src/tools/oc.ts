import { mkdir, writeFile } from "node:fs/promises"
import { z } from "zod"
import { ErrorLegible, leerJson, rutaSalida } from "../dominio/archivos.ts"
import { diferencias } from "../dominio/comparar.ts"
import { registrarControl } from "../dominio/control.ts"
import type { FilaControl } from "../dominio/control.ts"
import { DerivadosSchema, OrdenCompraSchema, PaqueteSchema } from "../dominio/esquemas.ts"
import type { Derivados, OrdenCompra, Paquete, Validacion } from "../dominio/esquemas.ts"
import { aprobacionDelCaso, contenidoEvidencia, generarEvidencia, sha256 } from "../dominio/evidencia.ts"
import { cargarMaestros } from "../dominio/maestros.ts"
import type { Maestros } from "../dominio/maestros.ts"
import { leerPaquete } from "../dominio/paquete.ts"
import { construirOrden } from "../dominio/payload.ts"
import type { Trazabilidad } from "../dominio/payload.ts"
import { validarPaquete } from "../dominio/reglas.ts"
import type { SapAdapter } from "../sap/adapter.ts"
import { SapMock } from "../sap/mock.ts"
import { exito, fallo, leerArgs, protegido } from "./resultado.ts"

export type Ctx = { directory: string; sessionId: string }

type Caso = { paquete: Paquete; faltantes: string[]; maestros: Maestros; validacion: Validacion }

const caso = z
  .string()
  .describe('Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/, por ejemplo "sol-001"')
const paquete = PaqueteSchema.describe("Paquete tal como lo devolvió oc_leer_paquete, sin modificar")
const derivados = DerivadosSchema.describe("Objeto `derivados` tal como lo devolvió oc_validar, sin modificar")
const payload = OrdenCompraSchema.describe("Objeto `payload` tal como lo devolvió oc_construir_payload, sin modificar")
const confirmado = z
  .boolean()
  .optional()
  .describe("true solo si la analista confirmó explícitamente, en su último mensaje, las confirmaciones pendientes")

const argsLeer = { caso }
const argsValidar = { caso, paquete }
const argsConstruir = { caso, paquete, derivados }
const argsEvidencia = { caso }
const argsCrear = { caso, payload, confirmado }

const ReciboSchema = z.object({ numero_oc: z.string(), fecha: z.string() })

export const leer_paquete = {
  description:
    "Lee y normaliza el paquete de una solicitud de compra (correo, solicitud, cotización, aprobación y factura si existe); es siempre el primer paso para procesar un caso.",
  args: argsLeer,
  async execute(args: { caso: string }, ctx: Ctx): Promise<string> {
    return protegido(async () => {
      const a = leerArgs(z.object(argsLeer), args)
      const leido = await leerPaquete(ctx.directory, a.caso)
      return exito({ ...leido.paquete, faltantes: leido.faltantes })
    })
  },
}

export const validar = {
  description:
    "Aplica las reglas de control RC1–RC10 al paquete y devuelve si es apta, los bloqueos, las confirmaciones pendientes, los valores derivados de maestros y si la OC es retroactiva.",
  args: argsValidar,
  async execute(args: { caso: string; paquete: Paquete }, ctx: Ctx): Promise<string> {
    return protegido(async () => {
      const a = leerArgs(z.object(argsValidar), args)
      const c = await cargarCaso(ctx, a.caso)
      exigirIgual("paquete", a.paquete, c.paquete, "oc_leer_paquete")
      if (!c.validacion.apta) await registrar(ctx, c, "bloqueada", null)
      return exito(c.validacion)
    })
  },
}

export const construir_payload = {
  description:
    "Construye la orden de compra tal como quedaría en SAP a partir de un paquete apto y guarda la trazabilidad de cada valor; no crea nada en SAP.",
  args: argsConstruir,
  async execute(args: { caso: string; paquete: Paquete; derivados: Derivados }, ctx: Ctx): Promise<string> {
    return protegido(async () => {
      const a = leerArgs(z.object(argsConstruir), args)
      const c = await cargarCaso(ctx, a.caso)
      exigirIgual("paquete", a.paquete, c.paquete, "oc_leer_paquete")
      exigirIgual("objeto derivados", a.derivados, c.validacion.derivados, "oc_validar")
      if (!c.validacion.apta) return fallo(mensajeBloqueos(c.validacion), { bloqueos: c.validacion.bloqueos })
      const { orden, trazabilidad } = await ordenEsperada(ctx, a.caso, c)
      return exito({ payload: orden, trazabilidad: await guardarTrazabilidad(ctx, a.caso, trazabilidad) })
    })
  },
}

export const generar_evidencia = {
  description:
    "Genera el archivo de evidencia con el correo de aprobación del caso (encabezados, cuerpo y sha256) para adjuntarlo a la OC.",
  args: argsEvidencia,
  async execute(args: { caso: string }, ctx: Ctx): Promise<string> {
    return protegido(async () => {
      const a = leerArgs(z.object(argsEvidencia), args)
      return exito(await generarEvidencia(ctx.directory, a.caso))
    })
  },
}

export const crear = {
  description:
    "Crea la orden de compra en SAP y devuelve su número; solo procede si la solicitud es apta y, cuando hay confirmaciones pendientes, si la analista ya confirmó (confirmado: true).",
  args: argsCrear,
  async execute(args: { caso: string; payload: OrdenCompra; confirmado?: boolean }, ctx: Ctx): Promise<string> {
    return protegido(async () => {
      const a = leerArgs(z.object(argsCrear), args)
      const c = await cargarCaso(ctx, a.caso)
      const sap: SapAdapter = new SapMock(ctx.directory)

      const existente = await sap.buscarOrdenPorReferencia(c.paquete.solicitud.solicitud_id)
      if (existente) return ordenExistente(ctx, a.caso, c, existente.numero_oc)

      const rechazo = await motivoParaNoCrear(ctx, c, a.confirmado === true)
      if (rechazo) return rechazo

      const { orden } = await ordenEsperada(ctx, a.caso, c)
      exigirIgual("payload", a.payload, orden, "oc_construir_payload")
      return crearEnSap(ctx, a.caso, c, sap, firmarExcepciones(orden, ctx))
    })
  },
}

/** Vuelve a leer el caso desde los fixtures: las herramientas no confían en lo que envía el modelo. */
async function cargarCaso(ctx: Ctx, nombre: string): Promise<Caso> {
  const [leido, maestros] = await Promise.all([leerPaquete(ctx.directory, nombre), cargarMaestros(ctx.directory)])
  return { ...leido, maestros, validacion: validarPaquete(leido.paquete, maestros) }
}

/** Impide que un valor alterado (por ejemplo un monto "arreglado") llegue a SAP. */
function exigirIgual(nombre: string, recibido: unknown, real: unknown, origen: string): void {
  const distintos = diferencias(recibido, real)
  if (distintos.length === 0) return
  throw new ErrorLegible(
    `El ${nombre} recibido no coincide con los datos del caso (campos distintos: ${distintos.join(", ")}). Vuelve a llamar ${origen} y usa su resultado sin modificarlo.`,
  )
}

async function ordenEsperada(
  ctx: Ctx,
  nombre: string,
  c: Caso,
): Promise<{ orden: OrdenCompra; trazabilidad: Trazabilidad }> {
  const aprobacion = await aprobacionDelCaso(ctx.directory, nombre)
  const evidenciaSha256 = sha256(contenidoEvidencia(aprobacion))
  return construirOrden({ paquete: c.paquete, validacion: c.validacion, maestros: c.maestros, evidenciaSha256 })
}

async function guardarTrazabilidad(ctx: Ctx, nombre: string, trazabilidad: Trazabilidad): Promise<string> {
  await mkdir(rutaSalida(ctx.directory, nombre), { recursive: true })
  await writeFile(
    rutaSalida(ctx.directory, nombre, "trazabilidad.json"),
    `${JSON.stringify(trazabilidad, null, 2)}\n`,
    "utf8",
  )
  return `out/${nombre}/trazabilidad.json`
}

/** Devuelve la respuesta de rechazo (bloqueada o pendiente) o null si se puede crear. */
async function motivoParaNoCrear(ctx: Ctx, c: Caso, confirmado: boolean): Promise<string | null> {
  const { validacion } = c
  if (!validacion.apta) {
    await registrar(ctx, c, "bloqueada", null)
    return fallo(mensajeBloqueos(validacion), { bloqueos: validacion.bloqueos })
  }
  if (validacion.confirmaciones.length > 0 && !confirmado) {
    await registrar(ctx, c, "pendiente", null)
    const reglas = validacion.confirmaciones.map((h) => h.regla).join(", ")
    return fallo(
      `La OC requiere confirmación humana antes de crearse (${reglas}). Presenta cada confirmación a la analista y vuelve a llamar con confirmado: true solo si responde que confirma.`,
      { confirmaciones: validacion.confirmaciones },
    )
  }
  return null
}

function firmarExcepciones(orden: OrdenCompra, ctx: Ctx): OrdenCompra {
  const confirmado_por = `analista (sesión ${ctx.sessionId})`
  return { ...orden, excepciones: orden.excepciones.map((e) => ({ ...e, confirmado_por })) }
}

async function crearEnSap(ctx: Ctx, nombre: string, c: Caso, sap: SapAdapter, orden: OrdenCompra): Promise<string> {
  const proveedor = await sap.consultarProveedor(orden.proveedor.nit)
  if (!proveedor?.activo) {
    await registrar(ctx, c, "bloqueada", null)
    return fallo(`SAP no reconoce como activo al proveedor ${orden.proveedor.nombre}; no se creó la OC.`)
  }
  const evidencia = await generarEvidencia(ctx.directory, nombre)
  const creada = await sap.crearOrden(orden)
  await writeFile(
    rutaSalida(ctx.directory, nombre, "orden.json"),
    `${JSON.stringify({ ...creada, orden }, null, 2)}\n`,
    "utf8",
  )
  await registrar(ctx, c, "creada", creada.numero_oc)
  return exito({ ...creada, idempotente: false, evidencia: evidencia.ruta })
}

/** Idempotencia (HU-5): la misma solicitud devuelve la OC que ya existe, nunca una segunda. */
async function ordenExistente(ctx: Ctx, nombre: string, c: Caso, numero_oc: string): Promise<string> {
  const recibo = await leerJson(rutaSalida(ctx.directory, nombre, "orden.json"), ReciboSchema, "orden.json")
  await registrar(ctx, c, "existente", numero_oc)
  return exito({
    numero_oc,
    fecha: recibo?.numero_oc === numero_oc ? recibo.fecha : "",
    idempotente: true,
    evidencia: `out/${nombre}/aprobacion.txt`,
  })
}

function registrar(ctx: Ctx, c: Caso, resultado: FilaControl["resultado"], numero_oc: string | null): Promise<void> {
  return registrarControl(ctx.directory, {
    solicitud_id: c.paquete.solicitud.solicitud_id,
    resultado,
    numero_oc,
    retroactiva: c.validacion.retroactiva,
    bloqueos: c.validacion.bloqueos.map((h) => h.regla),
    confirmaciones: c.validacion.confirmaciones.map((h) => h.regla),
  })
}

function mensajeBloqueos(validacion: Validacion): string {
  const reglas = validacion.bloqueos.map((h) => h.regla).join(", ")
  return `La solicitud no es apta: tiene bloqueos (${reglas}) que impiden crear la OC. Informa a la analista la razón y la acción sugerida de cada uno.`
}
