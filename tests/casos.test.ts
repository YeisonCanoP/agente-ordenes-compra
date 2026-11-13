import { afterAll, describe, expect, test } from "bun:test"
import { chmod, cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { OrdenCompraSchema, PaqueteSchema, ValidacionSchema } from "../src/dominio/esquemas.ts"
import type { Hallazgo, OrdenCompra, Paquete, Validacion } from "../src/dominio/esquemas.ts"
import { construir_payload, crear, generar_evidencia, leer_paquete, validar } from "../src/tools/oc.ts"
import type { Ctx } from "../src/tools/oc.ts"
import { interpretar } from "../src/tools/resultado.ts"
import type { Resultado } from "../src/tools/resultado.ts"

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)))
const PayloadSchema = z.object({ payload: OrdenCompraSchema, trazabilidad: z.string() })
const EvidenciaSchema = z.object({ ruta: z.string(), sha256: z.string() })
const CreadaSchema = z.object({ numero_oc: z.string(), fecha: z.string(), idempotente: z.boolean() })
type Creada = z.infer<typeof CreadaSchema>

const temporales: string[] = []
afterAll(async () => {
  await Promise.all(temporales.map((dir) => rm(dir, { recursive: true, force: true })))
})

/** Copia los fixtures a una carpeta temporal para que cada test tenga su propio out/. */
async function entorno(): Promise<Ctx> {
  const directory = await mkdtemp(join(tmpdir(), "agente-oc-"))
  temporales.push(directory)
  await cp(join(RAIZ, "fixtures"), join(directory, "fixtures"), { recursive: true })
  await hacerEscribible(join(directory, "fixtures"))
  return { directory, sessionId: "test" }
}

/** Los fixtures pueden venir con carpetas de solo lectura; la copia debe poder modificarse y borrarse. */
async function hacerEscribible(carpeta: string): Promise<void> {
  await chmod(carpeta, 0o755)
  const entradas = await readdir(carpeta, { withFileTypes: true })
  await Promise.all(entradas.filter((e) => e.isDirectory()).map((e) => hacerEscribible(join(carpeta, e.name))))
}

function datos<T>(resultado: Resultado<T>): T {
  if (!resultado.ok) throw new Error(`Se esperaba ok: true y llegó: ${resultado.error}`)
  return resultado.data
}

function error<T>(resultado: Resultado<T>): string {
  if (resultado.ok) throw new Error("Se esperaba ok: false")
  return resultado.error
}

const reglas = (hallazgos: Hallazgo[]) => hallazgos.map((h) => h.regla)

async function leer(ctx: Ctx, caso: string): Promise<Paquete> {
  return datos(interpretar(PaqueteSchema, await leer_paquete.execute({ caso }, ctx)))
}

async function leerYValidar(ctx: Ctx, caso: string): Promise<{ paquete: Paquete; validacion: Validacion }> {
  const paquete = await leer(ctx, caso)
  const validacion = datos(interpretar(ValidacionSchema, await validar.execute({ caso, paquete }, ctx)))
  return { paquete, validacion }
}

async function payloadDe(ctx: Ctx, caso: string): Promise<OrdenCompra> {
  const { paquete, validacion } = await leerYValidar(ctx, caso)
  const salida = await construir_payload.execute({ caso, paquete, derivados: validacion.derivados }, ctx)
  return datos(interpretar(PayloadSchema, salida)).payload
}

async function intentarCrear(ctx: Ctx, caso: string, confirmado?: boolean): Promise<Resultado<Creada>> {
  const payload = await payloadDe(ctx, caso)
  return interpretar(CreadaSchema, await crear.execute({ caso, payload, confirmado }, ctx))
}

const control = (ctx: Ctx) => readFile(join(ctx.directory, "out", "control.csv"), "utf8")

describe("casos del reto", () => {
  test("sol-001: caso feliz, crea la OC sin intervención y es idempotente", async () => {
    const ctx = await entorno()
    const { validacion } = await leerYValidar(ctx, "sol-001")
    expect(validacion).toMatchObject({ apta: true, bloqueos: [], confirmaciones: [], retroactiva: false })

    const primera = datos(await intentarCrear(ctx, "sol-001"))
    expect(primera).toMatchObject({ numero_oc: "4500000001", idempotente: false })

    const segunda = datos(await intentarCrear(ctx, "sol-001"))
    expect(segunda).toMatchObject({ numero_oc: "4500000001", idempotente: true, fecha: primera.fecha })

    const ordenes = await readFile(join(ctx.directory, "out", "sap", "ordenes.jsonl"), "utf8")
    expect(ordenes.trim().split("\n")).toHaveLength(1)
  })

  test("sol-002: proveedor inexistente bloquea (RC1) y no crea OC", async () => {
    const ctx = await entorno()
    const { paquete, validacion } = await leerYValidar(ctx, "sol-002")
    expect(validacion.apta).toBe(false)
    expect(reglas(validacion.bloqueos)).toEqual(["RC1"])
    expect(validacion.bloqueos[0]?.accion_sugerida).not.toBe("")

    const salida = await construir_payload.execute({ caso: "sol-002", paquete, derivados: validacion.derivados }, ctx)
    expect(error(interpretar(PayloadSchema, salida))).toContain("RC1")
    expect(await control(ctx)).toContain("SOL-2026-002,bloqueada,,false,RC1,,")
  })

  test("sol-003: aprobador sin autoridad en el centro bloquea (RC2)", async () => {
    const ctx = await entorno()
    const { validacion } = await leerYValidar(ctx, "sol-003")
    expect(validacion.apta).toBe(false)
    expect(reglas(validacion.bloqueos)).toEqual(["RC2"])
    expect(validacion.bloqueos[0]?.accion_sugerida).toContain("CC-3030")
  })

  test("sol-004: cotización ≠ solicitud pide confirmación (RC5) con ambos valores", async () => {
    const ctx = await entorno()
    const { validacion } = await leerYValidar(ctx, "sol-004")
    expect(validacion.apta).toBe(true)
    expect(reglas(validacion.confirmaciones)).toEqual(["RC5"])
    expect(validacion.confirmaciones[0]?.valores).toMatchObject({
      valor_solicitud: 25000000,
      valor_cotizacion: 26500000,
      diferencia_pct: 6,
    })

    expect(error(await intentarCrear(ctx, "sol-004"))).toContain("confirmación")
    expect(error(await intentarCrear(ctx, "sol-004", false))).toContain("confirmación")
    const creada = datos(await intentarCrear(ctx, "sol-004", true))
    expect(creada.numero_oc).toBe("4500000001")

    const filas = await control(ctx)
    expect(filas).toContain("SOL-2026-004,pendiente,,false,,RC5,")
    expect(filas).toContain("SOL-2026-004,creada,4500000001,false,,RC5,")
  })

  test("sol-004: la OC se crea por el valor de la solicitud, no el de la cotización", async () => {
    const ctx = await entorno()
    const payload = await payloadDe(ctx, "sol-004")
    expect(payload.posiciones[0]).toMatchObject({ cantidad: 100, precio_unitario: 250000, unidad: "H" })
    expect(payload.excepciones).toEqual([expect.objectContaining({ codigo: "RC5", confirmado_por: null })])
  })

  test("sol-005: factura anterior a la solicitud marca retroactiva (RC8) en el control", async () => {
    const ctx = await entorno()
    const { validacion } = await leerYValidar(ctx, "sol-005")
    expect(validacion).toMatchObject({ apta: true, retroactiva: true })
    expect(reglas(validacion.confirmaciones)).toEqual(["RC8"])

    expect(error(await intentarCrear(ctx, "sol-005"))).toContain("RC8")
    datos(await intentarCrear(ctx, "sol-005", true))
    expect(await control(ctx)).toContain("SOL-2026-005,creada,4500000001,true,,RC8,")
  })

  test("sol-006: completa NIT, IVA y condiciones de pago desde el maestro (RC6, RC7)", async () => {
    const ctx = await entorno()
    const { validacion } = await leerYValidar(ctx, "sol-006")
    expect(validacion.apta).toBe(true)
    expect(reglas(validacion.confirmaciones)).toEqual(["RC6"])
    expect(validacion.derivados).toMatchObject({
      proveedor_nit: { valor: "900555111", fuente: "maestro.proveedores" },
      indicador_iva: { valor: "C1" },
      condiciones_pago: { valor: "Z030" },
    })

    const payload = await payloadDe(ctx, "sol-006")
    expect(payload).toMatchObject({ condiciones_pago: "Z030", proveedor: { codigo_sap: "100234" } })
    expect(payload.posiciones[0]?.indicador_iva).toBe("C1")
  })
})

describe("reglas de control que los fixtures no ejercitan", () => {
  /** Copia de sol-001 (caso feliz) con algunos campos de la solicitud cambiados. */
  async function validarCon(cambios: Record<string, unknown>): Promise<Validacion> {
    const ctx = await entorno()
    const ruta = join(ctx.directory, "fixtures", "reto-03", "solicitudes", "sol-001", "solicitud.json")
    const original: unknown = JSON.parse(await readFile(ruta, "utf8"))
    await writeFile(ruta, JSON.stringify({ ...Object(original), ...cambios }), "utf8")
    return (await leerYValidar(ctx, "sol-001")).validacion
  }

  test("RC1: un proveedor inactivo bloquea", async () => {
    const validacion = await validarCon({ proveedor_nit: "901777888", proveedor_nombre: "Consultores Ágiles S.A.S." })
    expect(reglas(validacion.bloqueos)).toEqual(["RC1"])
    expect(validacion.bloqueos[0]?.mensaje).toContain("inactivo")
  })

  test("RC3: un valor por encima del tope del aprobador bloquea y sugiere quién sí puede aprobar", async () => {
    const validacion = await validarCon({ cantidad: 600, valor_total: 57_000_000 })
    expect(reglas(validacion.bloqueos)).toEqual(["RC3"])
    expect(validacion.bloqueos[0]?.valores).toEqual({ valor_total: 57_000_000, tope: 50_000_000 })
    expect(validacion.bloqueos[0]?.accion_sugerida).toContain("dgarcia@periferia-ficticia.com")
  })

  test("RC4: una subárea que no pertenece al centro de costo bloquea", async () => {
    const validacion = await validarCon({ subarea: "Marketing" })
    expect(reglas(validacion.bloqueos)).toEqual(["RC4"])
    expect(validacion.bloqueos[0]?.accion_sugerida).toContain("Infraestructura, Soporte, Desarrollo")
  })

  test("RC4: un centro de costo inexistente bloquea", async () => {
    const validacion = await validarCon({ centro_costo: "CC-9999" })
    expect(reglas(validacion.bloqueos)).toEqual(["RC4"])
  })

  test("RC6 y RC7: un código que no existe en el maestro bloquea", async () => {
    const validacion = await validarCon({ indicador_iva: "C9", condiciones_pago: "Z999" })
    expect(reglas(validacion.bloqueos)).toEqual(["RC6", "RC7"])
  })

  test("RC9: una aprobación anterior a la solicitud pide confirmación", async () => {
    const validacion = await validarCon({ fecha_solicitud: "2026-08-25" })
    expect(validacion.apta).toBe(true)
    expect(reglas(validacion.confirmaciones)).toEqual(["RC9"])
    expect(validacion.confirmaciones[0]?.valores).toEqual({
      fecha_aprobacion: "2026-08-21",
      fecha_solicitud: "2026-08-25",
    })
  })

  test("RC10: cantidad × valor unitario distinto del total bloquea; ± 1 se tolera", async () => {
    const descuadrada = await validarCon({ valor_total: 11_400_500 })
    expect(reglas(descuadrada.bloqueos)).toEqual(["RC10"])
    const tolerada = await validarCon({ valor_total: 11_400_001 })
    expect(tolerada.bloqueos).toEqual([])
  })

  test("RC2: un correo que dice \"No aprobado\" bloquea", async () => {
    const ctx = await entorno()
    const ruta = join(ctx.directory, "fixtures", "reto-03", "solicitudes", "sol-001", "aprobacion.json")
    const original: unknown = JSON.parse(await readFile(ruta, "utf8"))
    await writeFile(ruta, JSON.stringify({ ...Object(original), cuerpo: "No aprobado, falta la cotización." }), "utf8")
    const { validacion } = await leerYValidar(ctx, "sol-001")
    expect(reglas(validacion.bloqueos)).toEqual(["RC2"])
  })
})

describe("creación idempotente y reparable", () => {
  test("dos creaciones simultáneas de la misma solicitud producen una sola OC", async () => {
    const ctx = await entorno()
    const payload = await payloadDe(ctx, "sol-001")
    const salidas = await Promise.all([
      crear.execute({ caso: "sol-001", payload }, ctx),
      crear.execute({ caso: "sol-001", payload }, ctx),
    ])
    const creadas = salidas.map((salida) => datos(interpretar(CreadaSchema, salida)))

    expect(creadas.map((c) => c.numero_oc)).toEqual(["4500000001", "4500000001"])
    expect(creadas.map((c) => c.idempotente).sort()).toEqual([false, true])
    const ordenes = await readFile(join(ctx.directory, "out", "sap", "ordenes.jsonl"), "utf8")
    expect(ordenes.trim().split("\n")).toHaveLength(1)
  })

  test("si faltan el recibo o la evidencia tras crear, el reintento los repara", async () => {
    const ctx = await entorno()
    const primera = datos(await intentarCrear(ctx, "sol-001"))
    const recibo = join(ctx.directory, "out", "sol-001", "orden.json")
    const evidencia = join(ctx.directory, "out", "sol-001", "aprobacion.txt")
    await rm(recibo)
    await rm(evidencia)

    const reintento = datos(await intentarCrear(ctx, "sol-001"))
    expect(reintento).toMatchObject({ numero_oc: "4500000001", idempotente: true, fecha: primera.fecha })
    expect(await readFile(recibo, "utf8")).toContain('"numero_oc": "4500000001"')
    expect(await readFile(evidencia, "utf8")).toContain("sha256:")
  })
})

describe("payload y evidencia", () => {
  test("el payload cumple el esquema, recorta la descripción a 40 y deja trazabilidad", async () => {
    const ctx = await entorno()
    const payload = await payloadDe(ctx, "sol-001")
    expect(OrdenCompraSchema.safeParse(payload).success).toBe(true)
    expect(payload.posiciones[0]?.descripcion.length).toBeLessThanOrEqual(40)

    const trazabilidad: unknown = JSON.parse(
      await readFile(join(ctx.directory, "out", "sol-001", "trazabilidad.json"), "utf8"),
    )
    expect(trazabilidad).toMatchObject({
      "proveedor.codigo_sap": { valor: "100234", fuente: "maestro.proveedores" },
      "posiciones[0].descripcion": { fuente: "derivado" },
      "posiciones[0].precio_unitario": { valor: 95000, fuente: "solicitud" },
    })
  })

  test("la evidencia lleva encabezados, cuerpo y el mismo sha256 que el payload", async () => {
    const ctx = await entorno()
    const payload = await payloadDe(ctx, "sol-001")
    const evidencia = datos(interpretar(EvidenciaSchema, await generar_evidencia.execute({ caso: "sol-001" }, ctx)))
    expect(evidencia.sha256).toBe(payload.aprobador.evidencia_sha256)

    const texto = await readFile(join(ctx.directory, evidencia.ruta), "utf8")
    expect(texto).toContain("De: mlopez@periferia-ficticia.com")
    expect(texto).toContain("Asunto: RE: Solicitud de orden de compra SOL-001")
    expect(texto).toContain("Aprobado, proceder con la orden de compra.")
    expect(texto).toContain(`sha256: ${evidencia.sha256}`)
  })
})

describe("las herramientas no confían en lo que reciben", () => {
  test("un paquete con el monto alterado se rechaza", async () => {
    const ctx = await entorno()
    const paquete = await leer(ctx, "sol-004")
    const alterado: Paquete = { ...paquete, solicitud: { ...paquete.solicitud, valor_total: 26500000 } }
    const salida = await validar.execute({ caso: "sol-004", paquete: alterado }, ctx)
    expect(error(interpretar(ValidacionSchema, salida))).toContain("solicitud.valor_total")
  })

  test("un payload con el precio alterado no llega a SAP", async () => {
    const ctx = await entorno()
    const payload = await payloadDe(ctx, "sol-001")
    const alterado: OrdenCompra = {
      ...payload,
      posiciones: payload.posiciones.map((p) => ({ ...p, precio_unitario: 1 })),
    }
    const salida = await crear.execute({ caso: "sol-001", payload: alterado }, ctx)
    expect(error(interpretar(CreadaSchema, salida))).toContain("posiciones[0].precio_unitario")
  })

  test("confirmado: true no salta un bloqueo", async () => {
    const ctx = await entorno()
    const payload = await payloadDe(ctx, "sol-001")
    const salida = await crear.execute({ caso: "sol-002", payload, confirmado: true }, ctx)
    expect(error(interpretar(CreadaSchema, salida))).toContain("RC1")
  })
})

describe("manejo de errores (HU-6)", () => {
  async function conArchivo(caso: string, archivo: string, contenido: string): Promise<Ctx> {
    const ctx = await entorno()
    await writeFile(join(ctx.directory, "fixtures", "reto-03", "solicitudes", caso, archivo), contenido, "utf8")
    return ctx
  }

  async function sinArchivo(caso: string, archivo: string): Promise<Ctx> {
    const ctx = await entorno()
    await rm(join(ctx.directory, "fixtures", "reto-03", "solicitudes", caso, archivo))
    return ctx
  }

  const errorAlLeer = async (ctx: Ctx, caso: string) =>
    error(interpretar(PaqueteSchema, await leer_paquete.execute({ caso }, ctx)))

  test("caso inexistente", async () => {
    expect(await errorAlLeer(await entorno(), "sol-999")).toContain("No existe el caso")
  })

  test("nombre de caso que intenta salir de la carpeta", async () => {
    expect(await errorAlLeer(await entorno(), "../maestros")).toContain("no es un nombre de caso válido")
  })

  test("JSON malformado", async () => {
    const ctx = await conArchivo("sol-001", "solicitud.json", "{ esto no es json")
    expect(await errorAlLeer(ctx, "sol-001")).toContain("solicitud.json no es un JSON válido")
  })

  test("monto no numérico en la solicitud", async () => {
    const solicitud = { ...(await leer(await entorno(), "sol-001")).solicitud, valor_total: "once millones" }
    const ctx = await conArchivo("sol-001", "solicitud.json", JSON.stringify(solicitud))
    expect(await errorAlLeer(ctx, "sol-001")).toContain("valor_total")
  })

  test("monto no numérico en la cotización", async () => {
    const ctx = await conArchivo("sol-001", "cotizacion.txt", "COTIZACIÓN X-1\nTOTAL (IVA incluido): COP por definir\n")
    expect(await errorAlLeer(ctx, "sol-001")).toContain("TOTAL numérico")
  })

  test("paquete incompleto: sin solicitud", async () => {
    expect(await errorAlLeer(await sinArchivo("sol-001", "solicitud.json"), "sol-001")).toContain("Paquete incompleto")
  })

  test("sin cotización: se reporta como null y pide confirmación (RC5)", async () => {
    const ctx = await sinArchivo("sol-001", "cotizacion.txt")
    const { paquete, validacion } = await leerYValidar(ctx, "sol-001")
    expect(paquete.cotizacion).toBeNull()
    expect(reglas(validacion.confirmaciones)).toEqual(["RC5"])
  })

  test("sin aprobación: bloquea (RC2)", async () => {
    const ctx = await sinArchivo("sol-001", "aprobacion.json")
    const { validacion } = await leerYValidar(ctx, "sol-001")
    expect(reglas(validacion.bloqueos)).toEqual(["RC2"])
  })

  test("argumentos inválidos devuelven error, no excepción", async () => {
    const ctx = await entorno()
    const salida = await crear.execute(JSON.parse('{"caso":"sol-001","payload":{}}'), ctx)
    expect(error(interpretar(CreadaSchema, salida))).toContain("Argumentos inválidos")
  })

  test("un caso malo no impide procesar el siguiente", async () => {
    const ctx = await conArchivo("sol-001", "solicitud.json", "{")
    expect(await errorAlLeer(ctx, "sol-001")).toContain("JSON")
    expect(datos(await intentarCrear(ctx, "sol-006", true)).numero_oc).toBe("4500000001")
  })
})
