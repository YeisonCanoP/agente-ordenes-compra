import { z } from "zod"
import { formatoMonto } from "../dominio/texto.ts"

const LARGO_MAXIMO = 280

const Fallo = z.looseObject({ ok: z.literal(false), error: z.string() })
const reglas = z.array(z.looseObject({ regla: z.string() }))

const Paquete = z.looseObject({
  solicitud: z.looseObject({
    solicitud_id: z.string(),
    proveedor_nombre: z.string(),
    valor_total: z.number(),
    moneda: z.string(),
  }),
  faltantes: z.array(z.string()).optional(),
})
const Validacion = z.looseObject({
  apta: z.boolean(),
  bloqueos: reglas,
  confirmaciones: reglas,
  retroactiva: z.boolean(),
})
const Payload = z.looseObject({
  payload: z.looseObject({
    proveedor: z.looseObject({ nombre: z.string() }),
    moneda: z.string(),
    posiciones: z.array(z.unknown()),
  }),
})
const Evidencia = z.looseObject({ ruta: z.string(), sha256: z.string() })
const Creada = z.looseObject({ numero_oc: z.string(), idempotente: z.boolean() })

const lista = (hallazgos: { regla: string }[]) => hallazgos.map((h) => h.regla).join(", ") || "ninguno"

/** Una línea por herramienta para mostrar en el chat (PRD 6.1: "resultado resumido"). */
const RESUMIDORES: Record<string, (data: unknown) => string | null> = {
  oc_leer_paquete(data) {
    const p = Paquete.safeParse(data)
    if (!p.success) return null
    const { solicitud_id, proveedor_nombre, valor_total, moneda } = p.data.solicitud
    const faltantes = p.data.faltantes?.length ? ` · faltan: ${p.data.faltantes.join(", ")}` : ""
    return `${solicitud_id} · ${proveedor_nombre} · ${formatoMonto(valor_total, moneda)}${faltantes}`
  },
  oc_validar(data) {
    const v = Validacion.safeParse(data)
    if (!v.success) return null
    const { apta, bloqueos, confirmaciones, retroactiva } = v.data
    return `apta: ${apta ? "sí" : "no"} · bloqueos: ${lista(bloqueos)} · confirmaciones: ${lista(confirmaciones)} · retroactiva: ${retroactiva ? "sí" : "no"}`
  },
  oc_construir_payload(data) {
    const p = Payload.safeParse(data)
    if (!p.success) return null
    const { proveedor, moneda, posiciones } = p.data.payload
    return `OC para ${proveedor.nombre} · ${moneda} · ${posiciones.length} posición(es)`
  },
  oc_generar_evidencia(data) {
    const e = Evidencia.safeParse(data)
    return e.success ? `${e.data.ruta} · sha256 ${e.data.sha256.slice(0, 12)}…` : null
  },
  oc_crear(data) {
    const c = Creada.safeParse(data)
    if (!c.success) return null
    return c.data.idempotente ? `OC ${c.data.numero_oc} ya existía (idempotente)` : `OC ${c.data.numero_oc} creada`
  },
}

export function resumir(nombre: string, resultado: unknown): string {
  const fallo = Fallo.safeParse(resultado)
  if (fallo.success) return recortar(`Error: ${fallo.data.error}`)
  const data = z.looseObject({ data: z.unknown() }).safeParse(resultado)
  const especifico = data.success ? RESUMIDORES[nombre]?.(data.data.data) : null
  return recortar(especifico ?? JSON.stringify(resultado))
}

const recortar = (texto: string): string =>
  texto.length <= LARGO_MAXIMO ? texto : `${texto.slice(0, LARGO_MAXIMO - 1)}…`
