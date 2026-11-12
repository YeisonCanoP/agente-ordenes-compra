import { ErrorLegible, describirIssues } from "./archivos.ts"
import { OrdenCompraSchema } from "./esquemas.ts"
import type { OrdenCompra, Paquete, Solicitud, Validacion } from "./esquemas.ts"
import type { Maestros } from "./maestros.ts"
import { referenciaCotizacion } from "./parsers.ts"
import { buscarProveedor } from "./reglas.ts"

const LARGO_TEXTO_BREVE = 40
const SOCIEDAD = "1000"
const ORGANIZACION_COMPRAS = "1000"
const CONSTANTE = { fuente: "derivado", detalle: "Constante de la compañía." }

type Origen = { valor: string | number | null; fuente: string; detalle?: string }
type OrigenTexto = Origen & { valor: string }
export type Trazabilidad = Record<string, Origen>

type Entrada = {
  paquete: Paquete
  validacion: Validacion
  maestros: Maestros
  evidenciaSha256: string
}

/** Valores que pueden venir de la solicitud o derivarse, con su origen. */
type Elegidos = {
  nit: OrigenTexto
  pago: OrigenTexto
  iva: OrigenTexto
  descripcion: OrigenTexto
  unidad: Origen & { valor: "UN" | "H" | "MES" }
}

/** Arma la OC de la sección 7.4 y registra de dónde sale cada valor (HU-3). */
export function construirOrden(entrada: Entrada): { orden: OrdenCompra; trazabilidad: Trazabilidad } {
  const { paquete, validacion, maestros, evidenciaSha256 } = entrada
  const { solicitud, correo, cotizacion, aprobacion } = paquete
  const proveedor = buscarProveedor(solicitud, maestros.proveedores)
  if (!validacion.apta || !proveedor || !aprobacion) {
    throw new ErrorLegible("No se puede construir la OC: la solicitud tiene bloqueos sin resolver.")
  }
  const elegidos = elegirValores(solicitud, validacion)

  const orden = validarOrden({
    referencia: {
      solicitud_id: solicitud.solicitud_id,
      correo_id: correo.id,
      cotizacion_ref: cotizacion ? referenciaCotizacion(cotizacion.texto) : null,
    },
    sociedad: SOCIEDAD,
    organizacion_compras: ORGANIZACION_COMPRAS,
    proveedor: { codigo_sap: proveedor.codigo_sap, nit: proveedor.nit, nombre: proveedor.nombre },
    moneda: solicitud.moneda,
    condiciones_pago: elegidos.pago.valor,
    aprobador: { email: aprobacion.de, fecha_aprobacion: aprobacion.fecha, evidencia_sha256: evidenciaSha256 },
    posiciones: [
      {
        numero: 10,
        descripcion: elegidos.descripcion.valor,
        cantidad: solicitud.cantidad,
        unidad: elegidos.unidad.valor,
        precio_unitario: solicitud.valor_unitario,
        centro_costo: solicitud.centro_costo,
        subarea: solicitud.subarea,
        indicador_iva: elegidos.iva.valor,
      },
    ],
    excepciones: validacion.confirmaciones.map((c) => ({
      codigo: c.regla,
      detalle: c.mensaje,
      confirmado_por: null,
    })),
  })
  return { orden, trazabilidad: trazar(orden, elegidos) }
}

function elegirValores(solicitud: Solicitud, validacion: Validacion): Elegidos {
  const { derivados } = validacion
  return {
    nit: elegir(solicitud.proveedor_nit, derivados.proveedor_nit, "NIT del proveedor"),
    pago: elegir(solicitud.condiciones_pago, derivados.condiciones_pago, "condiciones de pago"),
    iva: elegir(solicitud.indicador_iva, derivados.indicador_iva, "indicador de IVA"),
    descripcion: textoBreve(solicitud.descripcion),
    unidad: deducirUnidad(solicitud),
  }
}

/** Fuente de cada campo: solicitud, cotizacion, correo, aprobacion, maestro.<nombre> o derivado. */
function trazar(orden: OrdenCompra, elegidos: Elegidos): Trazabilidad {
  const { referencia, proveedor, aprobador } = orden
  return {
    "referencia.solicitud_id": { valor: referencia.solicitud_id, fuente: "solicitud" },
    "referencia.correo_id": { valor: referencia.correo_id, fuente: "correo" },
    "referencia.cotizacion_ref": referencia.cotizacion_ref
      ? { valor: referencia.cotizacion_ref, fuente: "cotizacion" }
      : { valor: null, fuente: "derivado", detalle: "El paquete no trae cotización o no tiene referencia." },
    sociedad: { valor: orden.sociedad, ...CONSTANTE },
    organizacion_compras: { valor: orden.organizacion_compras, ...CONSTANTE },
    "proveedor.codigo_sap": { valor: proveedor.codigo_sap, fuente: "maestro.proveedores" },
    "proveedor.nit": { ...elegidos.nit, valor: proveedor.nit },
    "proveedor.nombre": { valor: proveedor.nombre, fuente: "maestro.proveedores" },
    moneda: { valor: orden.moneda, fuente: "solicitud" },
    condiciones_pago: elegidos.pago,
    "aprobador.email": { valor: aprobador.email, fuente: "aprobacion" },
    "aprobador.fecha_aprobacion": { valor: aprobador.fecha_aprobacion, fuente: "aprobacion" },
    "aprobador.evidencia_sha256": {
      valor: aprobador.evidencia_sha256,
      fuente: "derivado",
      detalle: "sha256 del contenido de la evidencia de aprobación.",
    },
    ...trazarPosiciones(orden, elegidos),
    excepciones: {
      valor: orden.excepciones.map((e) => e.codigo).join("|") || null,
      fuente: "derivado",
      detalle: "Confirmaciones levantadas por las reglas de control.",
    },
  }
}

function trazarPosiciones(orden: OrdenCompra, elegidos: Elegidos): Trazabilidad {
  return Object.fromEntries(
    orden.posiciones.flatMap((posicion, i): [string, Origen][] => [
      [`posiciones[${i}].numero`, { valor: posicion.numero, fuente: "derivado", detalle: "Numeración SAP (10, 20, 30…)." }],
      [`posiciones[${i}].descripcion`, elegidos.descripcion],
      [`posiciones[${i}].cantidad`, { valor: posicion.cantidad, fuente: "solicitud" }],
      [`posiciones[${i}].unidad`, elegidos.unidad],
      [`posiciones[${i}].precio_unitario`, { valor: posicion.precio_unitario, fuente: "solicitud" }],
      [`posiciones[${i}].centro_costo`, { valor: posicion.centro_costo, fuente: "solicitud" }],
      [`posiciones[${i}].subarea`, { valor: posicion.subarea, fuente: "solicitud" }],
      [`posiciones[${i}].indicador_iva`, elegidos.iva],
    ]),
  )
}

/** Usa el valor de la solicitud; si falta, el que la validación derivó del maestro. */
function elegir(
  deSolicitud: string | undefined,
  derivado: { valor: string; fuente: string; motivo: string } | undefined,
  nombre: string,
): OrigenTexto {
  if (deSolicitud) return { valor: deSolicitud, fuente: "solicitud" }
  if (derivado) return { valor: derivado.valor, fuente: derivado.fuente, detalle: derivado.motivo }
  throw new ErrorLegible(`No se puede construir la OC: falta ${nombre} y no se pudo derivar del maestro.`)
}

/** SAP limita el texto breve de la posición a 40 caracteres. */
function textoBreve(descripcion: string): OrigenTexto {
  if (descripcion.length <= LARGO_TEXTO_BREVE) return { valor: descripcion, fuente: "solicitud" }
  return {
    valor: descripcion.slice(0, LARGO_TEXTO_BREVE).trim(),
    fuente: "derivado",
    detalle: `solicitud.descripcion recortada a ${LARGO_TEXTO_BREVE} caracteres (límite del texto breve en SAP).`,
  }
}

/** "H" o "MES" solo si la descripción dice "<cantidad> horas/meses"; en cualquier otro caso, "UN". */
function deducirUnidad(solicitud: Solicitud): Elegidos["unidad"] {
  const cantidad = String(solicitud.cantidad)
  const menciona = (palabra: string) =>
    new RegExp(`(^|\\D)${cantidad}\\s+${palabra}`, "i").test(solicitud.descripcion)
  if (menciona("horas?")) return { valor: "H", fuente: "derivado", detalle: `La descripción indica ${cantidad} horas.` }
  if (menciona("mes(es)?")) return { valor: "MES", fuente: "derivado", detalle: `La descripción indica ${cantidad} meses.` }
  return { valor: "UN", fuente: "derivado", detalle: "Unidad por defecto: la solicitud no indica horas ni meses." }
}

function validarOrden(candidata: unknown): OrdenCompra {
  const resultado = OrdenCompraSchema.safeParse(candidata)
  if (!resultado.success) {
    throw new ErrorLegible(`La OC construida no cumple el esquema → ${describirIssues(resultado.error)}`)
  }
  return resultado.data
}
