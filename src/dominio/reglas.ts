import type { Paquete, Solicitud, Validacion } from "./esquemas.ts"
import type { Aprobador, CentroCosto, Maestros, Proveedor } from "./maestros.ts"
import { diaDe, formatoMonto, formatoPorcentaje, normalizarNit, normalizarNombre } from "./texto.ts"

const TOLERANCIA_COTIZACION = 0.02
const TOLERANCIA_ARITMETICA = 1
const FUENTE_PROVEEDORES = "maestro.proveedores"

type Contexto = {
  paquete: Paquete
  maestros: Maestros
  proveedor: Proveedor | null
  centro: CentroCosto | null
  aprobador: Aprobador | null
}
type Acumulado = Omit<Validacion, "apta">
type Regla = (c: Contexto, a: Acumulado) => void

/** Aplica RC1–RC10 (sección 7.3 del PRD). Función pura: no lee ni escribe archivos. */
export function validarPaquete(paquete: Paquete, maestros: Maestros): Validacion {
  const contexto = crearContexto(paquete, maestros)
  const acumulado: Acumulado = { bloqueos: [], confirmaciones: [], derivados: {}, retroactiva: false }
  for (const regla of REGLAS) regla(contexto, acumulado)
  return { apta: acumulado.bloqueos.length === 0, ...acumulado }
}

/** RC1: por NIT; si la solicitud no trae NIT, por nombre normalizado. */
export function buscarProveedor(solicitud: Solicitud, proveedores: Proveedor[]): Proveedor | null {
  if (solicitud.proveedor_nit) {
    const nit = normalizarNit(solicitud.proveedor_nit)
    return proveedores.find((p) => p.nit === nit) ?? null
  }
  const nombre = normalizarNombre(solicitud.proveedor_nombre)
  return proveedores.find((p) => normalizarNombre(p.nombre) === nombre) ?? null
}

function crearContexto(paquete: Paquete, maestros: Maestros): Contexto {
  const { solicitud, aprobacion } = paquete
  const centro = maestros.centros.find((c) => c.centro_costo === solicitud.centro_costo) ?? null
  const email = aprobacion?.de.toLowerCase()
  const aprobador = centro?.aprobadores.find((a) => a.email.toLowerCase() === email) ?? null
  return { paquete, maestros, proveedor: buscarProveedor(solicitud, maestros.proveedores), centro, aprobador }
}

const rc1: Regla = ({ paquete: { solicitud }, proveedor }, a) => {
  const nombre = solicitud.proveedor_nombre
  if (!proveedor) {
    const buscado = solicitud.proveedor_nit
      ? `con NIT ${solicitud.proveedor_nit} (${nombre})`
      : `"${nombre}" (buscado por nombre porque la solicitud no trae NIT)`
    a.bloqueos.push({
      regla: "RC1",
      mensaje: `El proveedor ${buscado} no existe en el maestro de proveedores.`,
      accion_sugerida:
        "Pedir al solicitante que verifique el NIT o gestionar la creación del proveedor en SAP antes de reintentar.",
    })
  } else if (!proveedor.activo) {
    a.bloqueos.push({
      regla: "RC1",
      mensaje: `El proveedor ${proveedor.nombre} (código SAP ${proveedor.codigo_sap}) está inactivo.`,
      accion_sugerida: "Gestionar la reactivación del proveedor en SAP o pedir al solicitante otro proveedor.",
    })
  } else if (!solicitud.proveedor_nit) {
    a.derivados.proveedor_nit = {
      valor: proveedor.nit,
      fuente: FUENTE_PROVEEDORES,
      motivo: "La solicitud no trae NIT; el proveedor se identificó por nombre.",
    }
  }
}

const rc2: Regla = ({ paquete: { solicitud, aprobacion }, maestros, centro, aprobador }, a) => {
  if (!aprobacion) {
    a.bloqueos.push({
      regla: "RC2",
      mensaje: "El paquete no trae el correo de aprobación.",
      accion_sugerida: "Pedir al solicitante el correo de aprobación de su líder.",
    })
  } else if (!aprobacion.aprobado) {
    a.bloqueos.push({
      regla: "RC2",
      mensaje: `El correo de ${aprobacion.de} no contiene la palabra "Aprobado".`,
      accion_sugerida: "Pedir al líder una respuesta explícita con la palabra \"Aprobado\".",
    })
  } else if (centro && !aprobador) {
    a.bloqueos.push({
      regla: "RC2",
      mensaje: `${aprobacion.de} no figura como aprobador del centro de costo ${centro.centro_costo}.`,
      accion_sugerida: [
        pistaOtroCentro(aprobacion.de, maestros.centros),
        sugerirAprobadores(centro, solicitud),
      ]
        .filter(Boolean)
        .join(" "),
    })
  }
}

const rc3: Regla = ({ paquete: { solicitud }, centro, aprobador }, a) => {
  if (!centro || !aprobador || solicitud.valor_total <= aprobador.tope) return
  a.bloqueos.push({
    regla: "RC3",
    mensaje: `El valor ${monto(solicitud.valor_total, solicitud)} supera el tope de ${aprobador.email} en ${centro.centro_costo} (${monto(aprobador.tope, solicitud)}).`,
    accion_sugerida: sugerirAprobadores(centro, solicitud),
    valores: { valor_total: solicitud.valor_total, tope: aprobador.tope },
  })
}

const rc4: Regla = ({ paquete: { solicitud }, centro }, a) => {
  if (!centro) {
    a.bloqueos.push({
      regla: "RC4",
      mensaje: `El centro de costo ${solicitud.centro_costo} no existe en el maestro.`,
      accion_sugerida: "Pedir al solicitante el centro de costo correcto.",
    })
  } else if (!centro.subareas.includes(solicitud.subarea)) {
    a.bloqueos.push({
      regla: "RC4",
      mensaje: `La subárea "${solicitud.subarea}" no pertenece al centro de costo ${centro.centro_costo}.`,
      accion_sugerida: `Pedir al solicitante que corrija la subárea (válidas: ${centro.subareas.join(", ")}) o el centro de costo.`,
    })
  }
}

const rc5: Regla = ({ paquete: { solicitud, cotizacion } }, a) => {
  if (!cotizacion) {
    a.confirmaciones.push({
      regla: "RC5",
      mensaje: "El paquete no trae cotización; el valor de la solicitud no se puede contrastar.",
      accion_sugerida: `Confirmar que la OC se crea sin cotización por ${monto(solicitud.valor_total, solicitud)}, o pedir la cotización al solicitante.`,
      valores: { valor_solicitud: solicitud.valor_total, valor_cotizacion: null },
    })
    return
  }
  const diferencia = Math.abs(cotizacion.total - solicitud.valor_total) / solicitud.valor_total
  if (diferencia <= TOLERANCIA_COTIZACION) return
  a.confirmaciones.push({
    regla: "RC5",
    mensaje: `La cotización (${formatoMonto(cotizacion.total, cotizacion.moneda)}) difiere ${formatoPorcentaje(diferencia)} de la solicitud (${monto(solicitud.valor_total, solicitud)}); la tolerancia es ${formatoPorcentaje(TOLERANCIA_COTIZACION)}.`,
    accion_sugerida:
      "Confirmar que la OC se crea por el valor de la solicitud, o devolver al solicitante para que alinee solicitud, cotización y aprobación.",
    valores: {
      valor_solicitud: solicitud.valor_total,
      valor_cotizacion: cotizacion.total,
      diferencia_pct: Number((diferencia * 100).toFixed(2)),
    },
  })
}

const rc6: Regla = ({ paquete: { solicitud }, maestros, proveedor }, a) => {
  const codigo = solicitud.indicador_iva
  if (codigo) {
    if (maestros.indicadoresIva.some((i) => i.codigo === codigo)) return
    a.bloqueos.push({
      regla: "RC6",
      mensaje: `El indicador de IVA "${codigo}" no existe en el maestro.`,
      accion_sugerida: `Pedir al solicitante un indicador válido (${maestros.indicadoresIva.map((i) => i.codigo).join(", ")}).`,
    })
  } else if (proveedor) {
    const valor = proveedor.indicador_iva_default
    a.derivados.indicador_iva = {
      valor,
      fuente: FUENTE_PROVEEDORES,
      motivo: "La solicitud no informa indicador de IVA; se toma el del proveedor.",
    }
    a.confirmaciones.push({
      regla: "RC6",
      mensaje: `La solicitud no informa indicador de IVA; se tomaría "${valor}" (el definido para ${proveedor.nombre}).`,
      accion_sugerida: `Confirmar que el indicador de IVA "${valor}" aplica a esta compra.`,
      valores: { indicador_iva: valor },
    })
  }
}

const rc7: Regla = ({ paquete: { solicitud }, maestros, proveedor }, a) => {
  const codigo = solicitud.condiciones_pago
  if (codigo) {
    if (maestros.condicionesPago.some((c) => c.codigo === codigo)) return
    a.bloqueos.push({
      regla: "RC7",
      mensaje: `La condición de pago "${codigo}" no existe en el maestro.`,
      accion_sugerida: `Pedir al solicitante una condición válida (${maestros.condicionesPago.map((c) => c.codigo).join(", ")}).`,
    })
  } else if (proveedor) {
    a.derivados.condiciones_pago = {
      valor: proveedor.condiciones_pago_default,
      fuente: FUENTE_PROVEEDORES,
      motivo: "La solicitud no informa condiciones de pago; se toman las del proveedor.",
    }
  }
}

const rc8: Regla = ({ paquete: { solicitud, factura } }, a) => {
  if (!factura || factura.fecha >= solicitud.fecha_solicitud) return
  a.retroactiva = true
  a.confirmaciones.push({
    regla: "RC8",
    mensaje: `OC retroactiva: la factura ${factura.numero} es del ${factura.fecha}, anterior a la solicitud (${solicitud.fecha_solicitud}).`,
    accion_sugerida:
      "Confirmar la creación como OC retroactiva; quedará marcada en el log de control para la medición de la dirección.",
    valores: { fecha_factura: factura.fecha, fecha_solicitud: solicitud.fecha_solicitud },
  })
}

const rc9: Regla = ({ paquete: { solicitud, aprobacion } }, a) => {
  if (!aprobacion || diaDe(aprobacion.fecha) >= solicitud.fecha_solicitud) return
  a.confirmaciones.push({
    regla: "RC9",
    mensaje: `La aprobación (${diaDe(aprobacion.fecha)}) es anterior a la fecha de la solicitud (${solicitud.fecha_solicitud}).`,
    accion_sugerida: "Confirmar que esa aprobación corresponde a esta solicitud, o pedir una aprobación actualizada.",
    valores: { fecha_aprobacion: diaDe(aprobacion.fecha), fecha_solicitud: solicitud.fecha_solicitud },
  })
}

const rc10: Regla = ({ paquete: { solicitud } }, a) => {
  const calculado = solicitud.cantidad * solicitud.valor_unitario
  if (Math.abs(calculado - solicitud.valor_total) <= TOLERANCIA_ARITMETICA) return
  a.bloqueos.push({
    regla: "RC10",
    mensaje: `Cantidad × valor unitario (${monto(calculado, solicitud)}) no coincide con el valor total (${monto(solicitud.valor_total, solicitud)}).`,
    accion_sugerida: "Pedir al solicitante que corrija la cantidad, el valor unitario o el total.",
    valores: { calculado, valor_total: solicitud.valor_total },
  })
}

const REGLAS: Regla[] = [rc1, rc2, rc3, rc4, rc5, rc6, rc7, rc8, rc9, rc10]

const monto = (valor: number, solicitud: Solicitud) => formatoMonto(valor, solicitud.moneda)

/** Propone a quién pedir la aprobación según el tope de cada aprobador del centro. */
function sugerirAprobadores(centro: CentroCosto, solicitud: Solicitud): string {
  const habilitados = centro.aprobadores.filter((a) => a.tope >= solicitud.valor_total)
  if (habilitados.length > 0) {
    const lista = habilitados.map((a) => `${a.email} (tope ${monto(a.tope, solicitud)})`).join(" o ")
    return `Pedir la aprobación a ${lista}.`
  }
  const maximo = Math.max(0, ...centro.aprobadores.map((a) => a.tope))
  return `Ningún aprobador de ${centro.centro_costo} tiene tope para ${monto(solicitud.valor_total, solicitud)} (tope máximo ${monto(maximo, solicitud)}); escalar a la dirección.`
}

/** Si quien aprobó pertenece a otro centro, lo más probable es que el centro de la solicitud esté mal. */
function pistaOtroCentro(email: string, centros: CentroCosto[]): string {
  const propios = centros.filter((c) => c.aprobadores.some((a) => a.email.toLowerCase() === email.toLowerCase()))
  if (propios.length === 0) return ""
  const lista = propios.map((c) => (c.nombre ? `${c.centro_costo} (${c.nombre})` : c.centro_costo)).join(", ")
  return `${email} sí es aprobador de ${lista}: verificar con el solicitante si el centro de costo es el correcto.`
}

