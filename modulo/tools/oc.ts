// @ts-nocheck
// GENERADO por `bun run build:modulo` a partir de src/tools/oc.ts. No editar a mano.
// Mismas herramientas que usa la aplicación, en un solo archivo y sin el servidor HTTP.
// Cada export es una herramienta: { description, args (zod), execute(args, ctx) }.
// Requiere el paquete `zod` (v4) y un runtime con los módulos node:fs, node:path y node:crypto.

// src/tools/oc.ts
import { mkdir as mkdir4, writeFile as writeFile2 } from "node:fs/promises";
import { z as z6 } from "zod";

// src/dominio/archivos.ts
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

class ErrorLegible extends Error {
}
var NOMBRE_CASO = /^[a-z0-9][a-z0-9_-]*$/i;
var rutaFixtures = (directory) => join(directory, "fixtures", "reto-03");
var rutaMaestro = (directory, archivo) => join(rutaFixtures(directory), "maestros", archivo);
var rutaCaso = (directory, caso) => join(rutaFixtures(directory), "solicitudes", caso);
var rutaSalida = (directory, ...partes) => join(directory, "out", ...partes);
function validarNombreCaso(caso) {
  if (!NOMBRE_CASO.test(caso)) {
    throw new ErrorLegible(`"${caso}" no es un nombre de caso válido. Usa solo el nombre de la carpeta, por ejemplo "sol-001".`);
  }
}
async function existe(ruta) {
  try {
    await stat(ruta);
    return true;
  } catch {
    return false;
  }
}
async function leerTexto(ruta) {
  try {
    return await readFile(ruta, "utf8");
  } catch (error) {
    if (esNoEncontrado(error))
      return null;
    throw error;
  }
}
async function leerJson(ruta, esquema, nombre) {
  const contenido = await leerTexto(ruta);
  if (contenido === null)
    return null;
  const resultado = esquema.safeParse(parsearJson(contenido, nombre));
  if (!resultado.success) {
    throw new ErrorLegible(`${nombre} tiene datos inválidos → ${describirIssues(resultado.error)}`);
  }
  return resultado.data;
}
function describirIssues(error) {
  return error.issues.map((issue) => `${issue.path.map(String).join(".") || "(raíz)"}: ${issue.message}`).join("; ");
}
function parsearJson(contenido, nombre) {
  try {
    return JSON.parse(contenido);
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    throw new ErrorLegible(`${nombre} no es un JSON válido (${detalle}).`);
  }
}
function esNoEncontrado(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// src/dominio/comparar.ts
var esObjeto = (valor) => typeof valor === "object" && valor !== null && !Array.isArray(valor);
var esLista = (valor) => Array.isArray(valor);
function diferencias(a, b, ruta = "") {
  if (esObjeto(a) && esObjeto(b)) {
    const claves = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...claves].flatMap((clave) => diferencias(a[clave], b[clave], ruta ? `${ruta}.${clave}` : clave));
  }
  if (esLista(a) && esLista(b)) {
    const largo = Math.max(a.length, b.length);
    return Array.from({ length: largo }, (_, i) => diferencias(a[i], b[i], `${ruta}[${i}]`)).flat();
  }
  return Object.is(a, b) ? [] : [ruta || "(raíz)"];
}

// src/dominio/control.ts
import { appendFile, mkdir } from "node:fs/promises";
var ENCABEZADO = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts";
async function registrarControl(directory, fila) {
  const ruta = rutaSalida(directory, "control.csv");
  const nuevo = !await existe(ruta);
  await mkdir(rutaSalida(directory), { recursive: true });
  await appendFile(ruta, `${nuevo ? `${ENCABEZADO}
` : ""}${aLinea(fila)}
`, "utf8");
}
function aLinea(fila) {
  return [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc ?? "",
    String(fila.retroactiva),
    fila.bloqueos.join("|"),
    fila.confirmaciones.join("|"),
    new Date().toISOString()
  ].map(celda).join(",");
}
var celda = (valor) => /[",\n]/.test(valor) ? `"${valor.replaceAll('"', '""')}"` : valor;

// src/dominio/esquemas.ts
import { z } from "zod";
z.config(z.locales.es());
var texto = z.string().min(1);
var fechaDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "debe tener formato AAAA-MM-DD");
var SolicitudSchema = z.object({
  solicitud_id: texto,
  solicitante: texto,
  proveedor_nombre: texto,
  proveedor_nit: texto.optional(),
  descripcion: texto,
  centro_costo: texto,
  subarea: texto,
  cantidad: z.number().positive(),
  valor_unitario: z.number().positive(),
  valor_total: z.number().positive(),
  moneda: z.enum(["COP", "USD"]),
  indicador_iva: texto.optional(),
  condiciones_pago: texto.optional(),
  fecha_solicitud: fechaDia
});
var CotizacionSchema = z.object({
  proveedor: z.string(),
  nit: z.string().nullable(),
  total: z.number(),
  moneda: z.string(),
  validez_hasta: z.string().nullable(),
  texto: z.string()
});
var AprobacionSchema = z.object({
  de: texto,
  fecha: texto,
  aprobado: z.boolean(),
  texto: z.string()
});
var FacturaSchema = z.object({
  numero: z.string(),
  fecha: fechaDia,
  total: z.number()
});
var PaqueteSchema = z.object({
  correo: z.object({ id: texto, de: texto, asunto: z.string(), fecha: texto }),
  solicitud: SolicitudSchema,
  cotizacion: CotizacionSchema.nullable(),
  aprobacion: AprobacionSchema.nullable(),
  factura: FacturaSchema.nullable()
});
var HallazgoSchema = z.object({
  regla: z.string(),
  mensaje: z.string(),
  accion_sugerida: z.string(),
  valores: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional()
});
var DerivadoSchema = z.object({
  valor: z.string(),
  fuente: z.string(),
  motivo: z.string()
});
var DerivadosSchema = z.object({
  proveedor_nit: DerivadoSchema.optional(),
  indicador_iva: DerivadoSchema.optional(),
  condiciones_pago: DerivadoSchema.optional()
});
var ValidacionSchema = z.object({
  apta: z.boolean(),
  bloqueos: z.array(HallazgoSchema),
  confirmaciones: z.array(HallazgoSchema),
  derivados: DerivadosSchema,
  retroactiva: z.boolean()
});
var PosicionSchema = z.object({
  numero: z.number().int().positive().multipleOf(10),
  descripcion: z.string().min(1).max(40),
  cantidad: z.number().positive(),
  unidad: z.enum(["UN", "H", "MES"]),
  precio_unitario: z.number().positive(),
  centro_costo: texto,
  subarea: texto,
  indicador_iva: texto
});
var OrdenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: texto,
    correo_id: texto,
    cotizacion_ref: z.string().nullable()
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: texto, nit: texto, nombre: texto }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: texto,
  aprobador: z.object({
    email: texto,
    fecha_aprobacion: texto,
    evidencia_sha256: z.string().regex(/^[0-9a-f]{64}$/, "debe ser un sha256 en hexadecimal")
  }),
  posiciones: z.array(PosicionSchema).min(1),
  excepciones: z.array(z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() }))
});

// src/dominio/evidencia.ts
import { createHash } from "node:crypto";
import { mkdir as mkdir2, writeFile } from "node:fs/promises";

// src/dominio/paquete.ts
import { join as join2 } from "node:path";
import { z as z2 } from "zod";

// src/dominio/texto.ts
function normalizarNit(nit) {
  return (nit.split("-")[0] ?? "").replace(/\D/g, "");
}
function normalizarNombre(nombre) {
  return nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function parsearMonto(texto) {
  const crudo = texto.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(crudo))
    return null;
  const numero = Number(quitarSeparadores(crudo));
  return Number.isFinite(numero) ? numero : null;
}
function quitarSeparadores(crudo) {
  const decimal = separadorDecimal(crudo);
  const miles = decimal === "," ? "." : ",";
  const sinMiles = crudo.split(miles).join("");
  return decimal === null ? sinMiles.replace(/[.,]/g, "") : sinMiles.replace(decimal, ".");
}
function separadorDecimal(crudo) {
  const ultimoPunto = crudo.lastIndexOf(".");
  const ultimaComa = crudo.lastIndexOf(",");
  if (ultimoPunto === -1 && ultimaComa === -1)
    return null;
  const candidato = ultimoPunto > ultimaComa ? "." : ",";
  const otro = candidato === "." ? "," : ".";
  if (crudo.includes(otro))
    return candidato;
  const grupos = crudo.split(candidato);
  const esMiles = grupos.length > 2 || (grupos[1] ?? "").length === 3;
  return esMiles ? null : candidato;
}
function formatoMonto(valor, moneda) {
  const [entero = "0", decimales = "00"] = Math.abs(valor).toFixed(2).split(".");
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const cola = decimales === "00" ? "" : `,${decimales}`;
  return `${moneda} ${valor < 0 ? "-" : ""}${miles}${cola}`;
}
function formatoPorcentaje(razon) {
  return `${(razon * 100).toFixed(2).replace(".", ",")} %`;
}
function diaDe(fechaIso) {
  return fechaIso.slice(0, 10);
}
function sumarDias(dia, dias) {
  const fecha = new Date(`${dia}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

// src/dominio/parsers.ts
var campo = (texto, patron) => patron.exec(texto)?.[1]?.trim() ?? null;
function parsearCotizacion(texto) {
  const lineaTotal = campo(texto, /^TOTAL[^:\n]*:\s*(.+)$/m);
  const nit = campo(texto, /^NIT:\s*(.+)$/m);
  return {
    proveedor: campo(texto, /^Proveedor:\s*(.+)$/m) ?? "",
    nit: nit ? normalizarNit(nit) : null,
    total: montoObligatorio(lineaTotal, "cotizacion.txt"),
    moneda: campo(lineaTotal ?? "", /^([A-Z]{3})\b/) ?? "COP",
    validez_hasta: validezHasta(texto),
    texto
  };
}
function referenciaCotizacion(texto) {
  return campo(texto, /^COTIZACI[ÓO]N\s+(\S+)/m);
}
function parsearFactura(texto) {
  const fecha = campo(texto, /^Fecha de emisi[óo]n:\s*(\d{4}-\d{2}-\d{2})/m);
  if (!fecha)
    throw new ErrorLegible("factura.txt no trae una fecha de emisión con formato AAAA-MM-DD.");
  return {
    numero: campo(texto, /No\.\s*(\S+)/) ?? "",
    fecha,
    total: montoObligatorio(campo(texto, /^TOTAL[^:\n]*:\s*(.+)$/m), "factura.txt")
  };
}
function esAprobado(cuerpo) {
  const negado = /\bno\s+(?:est[aá]\s+|fue\s+|queda\s+)?aprobad[oa]\b/i.test(cuerpo);
  return /\baprobad[oa]\b/i.test(cuerpo) && !negado;
}
function validezHasta(texto) {
  const fecha = campo(texto, /^Fecha:\s*(\d{4}-\d{2}-\d{2})/m);
  const dias = campo(texto, /^Validez[^:\n]*:\s*(\d+)\s*d[ií]as/im);
  return fecha && dias ? sumarDias(fecha, Number(dias)) : null;
}
function montoObligatorio(linea, archivo) {
  const monto = linea === null ? null : parsearMonto(linea);
  if (monto === null) {
    throw new ErrorLegible(`${archivo} no trae un TOTAL numérico${linea ? ` (dice "${linea}")` : ""}. Pide al solicitante el documento corregido.`);
  }
  return monto;
}

// src/dominio/paquete.ts
var CorreoCrudoSchema = z2.object({
  id: z2.string().min(1),
  de: z2.string().min(1),
  asunto: z2.string(),
  fecha: z2.string().min(1),
  adjuntos: z2.array(z2.string()).default([])
});
var AprobacionCrudaSchema = z2.object({
  de: z2.string().min(1),
  para: z2.string().optional(),
  cc: z2.array(z2.string()).optional(),
  fecha: z2.string().min(1),
  asunto: z2.string().optional(),
  cuerpo: z2.string()
});
async function leerPaquete(directory, caso) {
  const carpeta = await carpetaDelCaso(directory, caso);
  const [correo, solicitud, textoCotizacion, cruda, textoFactura] = await Promise.all([
    leerJson(join2(carpeta, "correo.json"), CorreoCrudoSchema, "correo.json"),
    leerJson(join2(carpeta, "solicitud.json"), SolicitudSchema, "solicitud.json"),
    leerTexto(join2(carpeta, "cotizacion.txt")),
    leerJson(join2(carpeta, "aprobacion.json"), AprobacionCrudaSchema, "aprobacion.json"),
    leerTexto(join2(carpeta, "factura.txt"))
  ]);
  if (!correo || !solicitud)
    throw paqueteIncompleto(caso, correo === null, solicitud === null);
  const paquete = {
    correo: { id: correo.id, de: correo.de, asunto: correo.asunto, fecha: correo.fecha },
    solicitud,
    cotizacion: textoCotizacion === null ? null : parsearCotizacion(textoCotizacion),
    aprobacion: cruda === null ? null : normalizarAprobacion(cruda),
    factura: textoFactura === null ? null : parsearFactura(textoFactura)
  };
  return { paquete, faltantes: listarFaltantes(paquete, correo.adjuntos) };
}
async function leerAprobacionCruda(directory, caso) {
  const carpeta = await carpetaDelCaso(directory, caso);
  return leerJson(join2(carpeta, "aprobacion.json"), AprobacionCrudaSchema, "aprobacion.json");
}
async function carpetaDelCaso(directory, caso) {
  validarNombreCaso(caso);
  const carpeta = rutaCaso(directory, caso);
  if (!await existe(carpeta)) {
    throw new ErrorLegible(`No existe el caso "${caso}" en fixtures/reto-03/solicitudes/.`);
  }
  return carpeta;
}
function normalizarAprobacion(cruda) {
  return { de: cruda.de, fecha: cruda.fecha, aprobado: esAprobado(cruda.cuerpo), texto: cruda.cuerpo };
}
function listarFaltantes(paquete, adjuntos) {
  const anunciaFactura = adjuntos.some((adjunto) => adjunto.toLowerCase().startsWith("factura"));
  return [
    ...paquete.cotizacion === null ? ["cotizacion.txt"] : [],
    ...paquete.aprobacion === null ? ["aprobacion.json"] : [],
    ...paquete.factura === null && anunciaFactura ? ["factura.txt"] : []
  ];
}
function paqueteIncompleto(caso, faltaCorreo, faltaSolicitud) {
  const faltan = [...faltaCorreo ? ["correo.json"] : [], ...faltaSolicitud ? ["solicitud.json"] : []];
  return new ErrorLegible(`Paquete incompleto en "${caso}": falta ${faltan.join(" y ")}. Pide al solicitante que reenvíe el correo con la solicitud adjunta.`);
}

// src/dominio/evidencia.ts
var sha256 = (contenido) => createHash("sha256").update(contenido, "utf8").digest("hex");
function contenidoEvidencia(aprobacion) {
  return [
    "EVIDENCIA DE APROBACIÓN",
    `De: ${aprobacion.de}`,
    `Para: ${aprobacion.para ?? "(no informado)"}`,
    `CC: ${aprobacion.cc?.join(", ") || "(sin copia)"}`,
    `Fecha: ${aprobacion.fecha}`,
    `Asunto: ${aprobacion.asunto ?? "(sin asunto)"}`,
    "",
    aprobacion.cuerpo
  ].join(`
`);
}
async function aprobacionDelCaso(directory, caso) {
  const aprobacion = await leerAprobacionCruda(directory, caso);
  if (!aprobacion) {
    throw new ErrorLegible(`El caso "${caso}" no trae correo de aprobación; no hay evidencia que generar. Pídelo al solicitante.`);
  }
  return aprobacion;
}
async function generarEvidencia(directory, caso) {
  const contenido = contenidoEvidencia(await aprobacionDelCaso(directory, caso));
  const hash = sha256(contenido);
  await mkdir2(rutaSalida(directory, caso), { recursive: true });
  await writeFile(rutaSalida(directory, caso, "aprobacion.txt"), `${contenido}

---
sha256: ${hash}
`, "utf8");
  return { ruta: `out/${caso}/aprobacion.txt`, sha256: hash };
}

// src/dominio/maestros.ts
import { z as z3 } from "zod";
var ProveedorSchema = z3.object({
  codigo_sap: z3.string(),
  nit: z3.string(),
  nombre: z3.string(),
  condiciones_pago_default: z3.string(),
  indicador_iva_default: z3.string(),
  activo: z3.boolean()
});
var AprobadorSchema = z3.object({
  email: z3.string(),
  nombre: z3.string().optional(),
  tope: z3.number()
});
var CentroCostoSchema = z3.object({
  centro_costo: z3.string(),
  nombre: z3.string().optional(),
  subareas: z3.array(z3.string()),
  aprobadores: z3.array(AprobadorSchema)
});
var IndicadorIvaSchema = z3.object({ codigo: z3.string(), descripcion: z3.string(), tasa: z3.number() });
var CondicionPagoSchema = z3.object({ codigo: z3.string(), descripcion: z3.string(), dias: z3.number() });
async function cargarMaestros(directory) {
  const [proveedores, centros, indicadoresIva, condicionesPago] = await Promise.all([
    cargar(directory, "proveedores.json", z3.array(ProveedorSchema)),
    cargar(directory, "centros-costo.json", z3.array(CentroCostoSchema)),
    cargar(directory, "indicadores-iva.json", z3.array(IndicadorIvaSchema)),
    cargar(directory, "condiciones-pago.json", z3.array(CondicionPagoSchema))
  ]);
  return { proveedores, centros, indicadoresIva, condicionesPago };
}
async function cargar(directory, archivo, esquema) {
  const datos = await leerJson(rutaMaestro(directory, archivo), esquema, `maestros/${archivo}`);
  if (datos === null)
    throw new ErrorLegible(`Falta el maestro ${archivo} en fixtures/reto-03/maestros/.`);
  return datos;
}

// src/dominio/reglas.ts
var TOLERANCIA_COTIZACION = 0.02;
var TOLERANCIA_ARITMETICA = 1;
var FUENTE_PROVEEDORES = "maestro.proveedores";
function validarPaquete(paquete, maestros) {
  const contexto = crearContexto(paquete, maestros);
  const acumulado = { bloqueos: [], confirmaciones: [], derivados: {}, retroactiva: false };
  for (const regla of REGLAS)
    regla(contexto, acumulado);
  return { apta: acumulado.bloqueos.length === 0, ...acumulado };
}
function buscarProveedor(solicitud, proveedores) {
  if (solicitud.proveedor_nit) {
    const nit = normalizarNit(solicitud.proveedor_nit);
    return proveedores.find((p) => p.nit === nit) ?? null;
  }
  const nombre = normalizarNombre(solicitud.proveedor_nombre);
  return proveedores.find((p) => normalizarNombre(p.nombre) === nombre) ?? null;
}
function crearContexto(paquete, maestros) {
  const { solicitud, aprobacion } = paquete;
  const centro = maestros.centros.find((c) => c.centro_costo === solicitud.centro_costo) ?? null;
  const email = aprobacion?.de.toLowerCase();
  const aprobador = centro?.aprobadores.find((a) => a.email.toLowerCase() === email) ?? null;
  return { paquete, maestros, proveedor: buscarProveedor(solicitud, maestros.proveedores), centro, aprobador };
}
var rc1 = ({ paquete: { solicitud }, proveedor }, a) => {
  const nombre = solicitud.proveedor_nombre;
  if (!proveedor) {
    const buscado = solicitud.proveedor_nit ? `con NIT ${solicitud.proveedor_nit} (${nombre})` : `"${nombre}" (buscado por nombre porque la solicitud no trae NIT)`;
    a.bloqueos.push({
      regla: "RC1",
      mensaje: `El proveedor ${buscado} no existe en el maestro de proveedores.`,
      accion_sugerida: "Pedir al solicitante que verifique el NIT o gestionar la creación del proveedor en SAP antes de reintentar."
    });
  } else if (!proveedor.activo) {
    a.bloqueos.push({
      regla: "RC1",
      mensaje: `El proveedor ${proveedor.nombre} (código SAP ${proveedor.codigo_sap}) está inactivo.`,
      accion_sugerida: "Gestionar la reactivación del proveedor en SAP o pedir al solicitante otro proveedor."
    });
  } else if (!solicitud.proveedor_nit) {
    a.derivados.proveedor_nit = {
      valor: proveedor.nit,
      fuente: FUENTE_PROVEEDORES,
      motivo: "La solicitud no trae NIT; el proveedor se identificó por nombre."
    };
  }
};
var rc2 = ({ paquete: { solicitud, aprobacion }, maestros, centro, aprobador }, a) => {
  if (!aprobacion) {
    a.bloqueos.push({
      regla: "RC2",
      mensaje: "El paquete no trae el correo de aprobación.",
      accion_sugerida: "Pedir al solicitante el correo de aprobación de su líder."
    });
  } else if (!aprobacion.aprobado) {
    a.bloqueos.push({
      regla: "RC2",
      mensaje: `El correo de ${aprobacion.de} no contiene la palabra "Aprobado".`,
      accion_sugerida: 'Pedir al líder una respuesta explícita con la palabra "Aprobado".'
    });
  } else if (centro && !aprobador) {
    a.bloqueos.push({
      regla: "RC2",
      mensaje: `${aprobacion.de} no figura como aprobador del centro de costo ${centro.centro_costo}.`,
      accion_sugerida: [
        pistaOtroCentro(aprobacion.de, maestros.centros),
        sugerirAprobadores(centro, solicitud)
      ].filter(Boolean).join(" ")
    });
  }
};
var rc3 = ({ paquete: { solicitud }, centro, aprobador }, a) => {
  if (!centro || !aprobador || solicitud.valor_total <= aprobador.tope)
    return;
  a.bloqueos.push({
    regla: "RC3",
    mensaje: `El valor ${monto(solicitud.valor_total, solicitud)} supera el tope de ${aprobador.email} en ${centro.centro_costo} (${monto(aprobador.tope, solicitud)}).`,
    accion_sugerida: sugerirAprobadores(centro, solicitud),
    valores: { valor_total: solicitud.valor_total, tope: aprobador.tope }
  });
};
var rc4 = ({ paquete: { solicitud }, centro }, a) => {
  if (!centro) {
    a.bloqueos.push({
      regla: "RC4",
      mensaje: `El centro de costo ${solicitud.centro_costo} no existe en el maestro.`,
      accion_sugerida: "Pedir al solicitante el centro de costo correcto."
    });
  } else if (!centro.subareas.includes(solicitud.subarea)) {
    a.bloqueos.push({
      regla: "RC4",
      mensaje: `La subárea "${solicitud.subarea}" no pertenece al centro de costo ${centro.centro_costo}.`,
      accion_sugerida: `Pedir al solicitante que corrija la subárea (válidas: ${centro.subareas.join(", ")}) o el centro de costo.`
    });
  }
};
var rc5 = ({ paquete: { solicitud, cotizacion } }, a) => {
  if (!cotizacion) {
    a.confirmaciones.push({
      regla: "RC5",
      mensaje: "El paquete no trae cotización; el valor de la solicitud no se puede contrastar.",
      accion_sugerida: `Confirmar que la OC se crea sin cotización por ${monto(solicitud.valor_total, solicitud)}, o pedir la cotización al solicitante.`,
      valores: { valor_solicitud: solicitud.valor_total, valor_cotizacion: null }
    });
    return;
  }
  const diferencia = Math.abs(cotizacion.total - solicitud.valor_total) / solicitud.valor_total;
  if (diferencia <= TOLERANCIA_COTIZACION)
    return;
  a.confirmaciones.push({
    regla: "RC5",
    mensaje: `La cotización (${formatoMonto(cotizacion.total, cotizacion.moneda)}) difiere ${formatoPorcentaje(diferencia)} de la solicitud (${monto(solicitud.valor_total, solicitud)}); la tolerancia es ${formatoPorcentaje(TOLERANCIA_COTIZACION)}.`,
    accion_sugerida: "Confirmar que la OC se crea por el valor de la solicitud, o devolver al solicitante para que alinee solicitud, cotización y aprobación.",
    valores: {
      valor_solicitud: solicitud.valor_total,
      valor_cotizacion: cotizacion.total,
      diferencia_pct: Number((diferencia * 100).toFixed(2))
    }
  });
};
var rc6 = ({ paquete: { solicitud }, maestros, proveedor }, a) => {
  const codigo = solicitud.indicador_iva;
  if (codigo) {
    if (maestros.indicadoresIva.some((i) => i.codigo === codigo))
      return;
    a.bloqueos.push({
      regla: "RC6",
      mensaje: `El indicador de IVA "${codigo}" no existe en el maestro.`,
      accion_sugerida: `Pedir al solicitante un indicador válido (${maestros.indicadoresIva.map((i) => i.codigo).join(", ")}).`
    });
  } else if (proveedor) {
    const valor = proveedor.indicador_iva_default;
    a.derivados.indicador_iva = {
      valor,
      fuente: FUENTE_PROVEEDORES,
      motivo: "La solicitud no informa indicador de IVA; se toma el del proveedor."
    };
    a.confirmaciones.push({
      regla: "RC6",
      mensaje: `La solicitud no informa indicador de IVA; se tomaría "${valor}" (el definido para ${proveedor.nombre}).`,
      accion_sugerida: `Confirmar que el indicador de IVA "${valor}" aplica a esta compra.`,
      valores: { indicador_iva: valor }
    });
  }
};
var rc7 = ({ paquete: { solicitud }, maestros, proveedor }, a) => {
  const codigo = solicitud.condiciones_pago;
  if (codigo) {
    if (maestros.condicionesPago.some((c) => c.codigo === codigo))
      return;
    a.bloqueos.push({
      regla: "RC7",
      mensaje: `La condición de pago "${codigo}" no existe en el maestro.`,
      accion_sugerida: `Pedir al solicitante una condición válida (${maestros.condicionesPago.map((c) => c.codigo).join(", ")}).`
    });
  } else if (proveedor) {
    a.derivados.condiciones_pago = {
      valor: proveedor.condiciones_pago_default,
      fuente: FUENTE_PROVEEDORES,
      motivo: "La solicitud no informa condiciones de pago; se toman las del proveedor."
    };
  }
};
var rc8 = ({ paquete: { solicitud, factura } }, a) => {
  if (!factura || factura.fecha >= solicitud.fecha_solicitud)
    return;
  a.retroactiva = true;
  a.confirmaciones.push({
    regla: "RC8",
    mensaje: `OC retroactiva: la factura ${factura.numero} es del ${factura.fecha}, anterior a la solicitud (${solicitud.fecha_solicitud}).`,
    accion_sugerida: "Confirmar la creación como OC retroactiva; quedará marcada en el log de control para la medición de la dirección.",
    valores: { fecha_factura: factura.fecha, fecha_solicitud: solicitud.fecha_solicitud }
  });
};
var rc9 = ({ paquete: { solicitud, aprobacion } }, a) => {
  if (!aprobacion || diaDe(aprobacion.fecha) >= solicitud.fecha_solicitud)
    return;
  a.confirmaciones.push({
    regla: "RC9",
    mensaje: `La aprobación (${diaDe(aprobacion.fecha)}) es anterior a la fecha de la solicitud (${solicitud.fecha_solicitud}).`,
    accion_sugerida: "Confirmar que esa aprobación corresponde a esta solicitud, o pedir una aprobación actualizada.",
    valores: { fecha_aprobacion: diaDe(aprobacion.fecha), fecha_solicitud: solicitud.fecha_solicitud }
  });
};
var rc10 = ({ paquete: { solicitud } }, a) => {
  const calculado = solicitud.cantidad * solicitud.valor_unitario;
  if (Math.abs(calculado - solicitud.valor_total) <= TOLERANCIA_ARITMETICA)
    return;
  a.bloqueos.push({
    regla: "RC10",
    mensaje: `Cantidad × valor unitario (${monto(calculado, solicitud)}) no coincide con el valor total (${monto(solicitud.valor_total, solicitud)}).`,
    accion_sugerida: "Pedir al solicitante que corrija la cantidad, el valor unitario o el total.",
    valores: { calculado, valor_total: solicitud.valor_total }
  });
};
var REGLAS = [rc1, rc2, rc3, rc4, rc5, rc6, rc7, rc8, rc9, rc10];
var monto = (valor, solicitud) => formatoMonto(valor, solicitud.moneda);
function sugerirAprobadores(centro, solicitud) {
  const habilitados = centro.aprobadores.filter((a) => a.tope >= solicitud.valor_total);
  if (habilitados.length > 0) {
    const lista = habilitados.map((a) => `${a.email} (tope ${monto(a.tope, solicitud)})`).join(" o ");
    return `Pedir la aprobación a ${lista}.`;
  }
  const maximo = Math.max(0, ...centro.aprobadores.map((a) => a.tope));
  return `Ningún aprobador de ${centro.centro_costo} tiene tope para ${monto(solicitud.valor_total, solicitud)} (tope máximo ${monto(maximo, solicitud)}); escalar a la dirección.`;
}
function pistaOtroCentro(email, centros) {
  const propios = centros.filter((c) => c.aprobadores.some((a) => a.email.toLowerCase() === email.toLowerCase()));
  if (propios.length === 0)
    return "";
  const lista = propios.map((c) => c.nombre ? `${c.centro_costo} (${c.nombre})` : c.centro_costo).join(", ");
  return `${email} sí es aprobador de ${lista}: verificar con el solicitante si el centro de costo es el correcto.`;
}

// src/dominio/payload.ts
var LARGO_TEXTO_BREVE = 40;
var SOCIEDAD = "1000";
var ORGANIZACION_COMPRAS = "1000";
var CONSTANTE = { fuente: "derivado", detalle: "Constante de la compañía." };
function construirOrden(entrada) {
  const { paquete, validacion, maestros, evidenciaSha256 } = entrada;
  const { solicitud, correo, cotizacion, aprobacion } = paquete;
  const proveedor = buscarProveedor(solicitud, maestros.proveedores);
  if (!validacion.apta || !proveedor || !aprobacion) {
    throw new ErrorLegible("No se puede construir la OC: la solicitud tiene bloqueos sin resolver.");
  }
  const elegidos = elegirValores(solicitud, validacion);
  const orden = validarOrden({
    referencia: {
      solicitud_id: solicitud.solicitud_id,
      correo_id: correo.id,
      cotizacion_ref: cotizacion ? referenciaCotizacion(cotizacion.texto) : null
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
        indicador_iva: elegidos.iva.valor
      }
    ],
    excepciones: validacion.confirmaciones.map((c) => ({
      codigo: c.regla,
      detalle: c.mensaje,
      confirmado_por: null
    }))
  });
  return { orden, trazabilidad: trazar(orden, elegidos) };
}
function elegirValores(solicitud, validacion) {
  const { derivados } = validacion;
  return {
    nit: elegir(solicitud.proveedor_nit, derivados.proveedor_nit, "NIT del proveedor"),
    pago: elegir(solicitud.condiciones_pago, derivados.condiciones_pago, "condiciones de pago"),
    iva: elegir(solicitud.indicador_iva, derivados.indicador_iva, "indicador de IVA"),
    descripcion: textoBreve(solicitud.descripcion),
    unidad: deducirUnidad(solicitud)
  };
}
function trazar(orden, elegidos) {
  const { referencia, proveedor, aprobador } = orden;
  return {
    "referencia.solicitud_id": { valor: referencia.solicitud_id, fuente: "solicitud" },
    "referencia.correo_id": { valor: referencia.correo_id, fuente: "correo" },
    "referencia.cotizacion_ref": referencia.cotizacion_ref ? { valor: referencia.cotizacion_ref, fuente: "cotizacion" } : { valor: null, fuente: "derivado", detalle: "El paquete no trae cotización o no tiene referencia." },
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
      detalle: "sha256 del contenido de la evidencia de aprobación."
    },
    ...trazarPosiciones(orden, elegidos),
    excepciones: {
      valor: orden.excepciones.map((e) => e.codigo).join("|") || null,
      fuente: "derivado",
      detalle: "Confirmaciones levantadas por las reglas de control."
    }
  };
}
function trazarPosiciones(orden, elegidos) {
  return Object.fromEntries(orden.posiciones.flatMap((posicion, i) => [
    [`posiciones[${i}].numero`, { valor: posicion.numero, fuente: "derivado", detalle: "Numeración SAP (10, 20, 30…)." }],
    [`posiciones[${i}].descripcion`, elegidos.descripcion],
    [`posiciones[${i}].cantidad`, { valor: posicion.cantidad, fuente: "solicitud" }],
    [`posiciones[${i}].unidad`, elegidos.unidad],
    [`posiciones[${i}].precio_unitario`, { valor: posicion.precio_unitario, fuente: "solicitud" }],
    [`posiciones[${i}].centro_costo`, { valor: posicion.centro_costo, fuente: "solicitud" }],
    [`posiciones[${i}].subarea`, { valor: posicion.subarea, fuente: "solicitud" }],
    [`posiciones[${i}].indicador_iva`, elegidos.iva]
  ]));
}
function elegir(deSolicitud, derivado, nombre) {
  if (deSolicitud)
    return { valor: deSolicitud, fuente: "solicitud" };
  if (derivado)
    return { valor: derivado.valor, fuente: derivado.fuente, detalle: derivado.motivo };
  throw new ErrorLegible(`No se puede construir la OC: falta ${nombre} y no se pudo derivar del maestro.`);
}
function textoBreve(descripcion) {
  if (descripcion.length <= LARGO_TEXTO_BREVE)
    return { valor: descripcion, fuente: "solicitud" };
  return {
    valor: descripcion.slice(0, LARGO_TEXTO_BREVE).trim(),
    fuente: "derivado",
    detalle: `solicitud.descripcion recortada a ${LARGO_TEXTO_BREVE} caracteres (límite del texto breve en SAP).`
  };
}
function deducirUnidad(solicitud) {
  const cantidad = String(solicitud.cantidad);
  const menciona = (palabra) => new RegExp(`(^|\\D)${cantidad}\\s+${palabra}`, "i").test(solicitud.descripcion);
  if (menciona("horas?"))
    return { valor: "H", fuente: "derivado", detalle: `La descripción indica ${cantidad} horas.` };
  if (menciona("mes(es)?"))
    return { valor: "MES", fuente: "derivado", detalle: `La descripción indica ${cantidad} meses.` };
  return { valor: "UN", fuente: "derivado", detalle: "Unidad por defecto: la solicitud no indica horas ni meses." };
}
function validarOrden(candidata) {
  const resultado = OrdenCompraSchema.safeParse(candidata);
  if (!resultado.success) {
    throw new ErrorLegible(`La OC construida no cumple el esquema → ${describirIssues(resultado.error)}`);
  }
  return resultado.data;
}

// src/sap/mock.ts
import { appendFile as appendFile2, mkdir as mkdir3 } from "node:fs/promises";
import { z as z4 } from "zod";
var PRIMER_NUMERO = 4500000001;
var RegistroSchema = z4.object({ numero_oc: z4.string(), fecha: z4.string(), orden: OrdenCompraSchema });

class SapMock {
  static cola = Promise.resolve();
  directory;
  constructor(directory) {
    this.directory = directory;
  }
  async consultarProveedor(nit) {
    const { proveedores } = await cargarMaestros(this.directory);
    const proveedor = proveedores.find((p) => p.nit === normalizarNit(nit));
    return proveedor ? { codigo_sap: proveedor.codigo_sap, activo: proveedor.activo } : null;
  }
  crearOrden(orden) {
    return this.enSerie(async () => {
      const registros = await this.leerRegistros();
      const previo = registros.find((r) => r.orden.referencia.solicitud_id === orden.referencia.solicitud_id);
      if (previo)
        return { numero_oc: previo.numero_oc, fecha: previo.fecha, reutilizada: true };
      const registro = {
        numero_oc: String(PRIMER_NUMERO + registros.length),
        fecha: new Date().toISOString(),
        orden
      };
      await mkdir3(rutaSalida(this.directory, "sap"), { recursive: true });
      await appendFile2(this.rutaOrdenes(), `${JSON.stringify(registro)}
`, "utf8");
      return { numero_oc: registro.numero_oc, fecha: registro.fecha, reutilizada: false };
    });
  }
  async buscarOrdenPorReferencia(solicitud_id) {
    const registros = await this.leerRegistros();
    const registro = registros.find((r) => r.orden.referencia.solicitud_id === solicitud_id);
    return registro ? { numero_oc: registro.numero_oc, fecha: registro.fecha } : null;
  }
  rutaOrdenes() {
    return rutaSalida(this.directory, "sap", "ordenes.jsonl");
  }
  async leerRegistros() {
    const contenido = await leerTexto(this.rutaOrdenes());
    if (contenido === null)
      return [];
    return contenido.split(`
`).filter((linea) => linea.trim() !== "").map((linea, indice) => parsearRegistro(linea, indice + 1));
  }
  enSerie(tarea) {
    const resultado = SapMock.cola.then(tarea);
    SapMock.cola = resultado.then(() => {
      return;
    }, () => {
      return;
    });
    return resultado;
  }
}
function parsearRegistro(linea, numeroLinea) {
  try {
    return RegistroSchema.parse(JSON.parse(linea));
  } catch {
    throw new ErrorLegible(`out/sap/ordenes.jsonl está dañado en la línea ${numeroLinea}; no se puede consultar el SAP simulado.`);
  }
}

// src/tools/resultado.ts
import { z as z5 } from "zod";
var ExitoSchema = z5.object({ ok: z5.literal(true), data: z5.unknown() });
var FalloSchema = z5.object({ ok: z5.literal(false), error: z5.string(), detalle: z5.unknown().optional() });
var exito = (data) => JSON.stringify({ ok: true, data });
var fallo = (error, detalle) => JSON.stringify(detalle === undefined ? { ok: false, error } : { ok: false, error, detalle });
async function protegido(tarea) {
  try {
    return await tarea();
  } catch (error) {
    if (error instanceof ErrorLegible)
      return fallo(error.message);
    return fallo(`Error inesperado: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function leerArgs(esquema, args) {
  const resultado = esquema.safeParse(args);
  if (!resultado.success) {
    throw new ErrorLegible(`Argumentos inválidos → ${describirIssues(resultado.error)}`);
  }
  return resultado.data;
}

// src/tools/oc.ts
var caso = z6.string().describe('Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/, por ejemplo "sol-001"');
var paquete = PaqueteSchema.describe("Paquete tal como lo devolvió oc_leer_paquete, sin modificar");
var derivados = DerivadosSchema.describe("Objeto `derivados` tal como lo devolvió oc_validar, sin modificar");
var payload = OrdenCompraSchema.describe("Objeto `payload` tal como lo devolvió oc_construir_payload, sin modificar");
var confirmado = z6.boolean().optional().describe("true solo si la analista confirmó explícitamente, en su último mensaje, las confirmaciones pendientes");
var argsLeer = { caso };
var argsValidar = { caso, paquete };
var argsConstruir = { caso, paquete, derivados };
var argsEvidencia = { caso };
var argsCrear = { caso, payload, confirmado };
var leer_paquete = {
  description: "Lee y normaliza el paquete de una solicitud de compra (correo, solicitud, cotización, aprobación y factura si existe); es siempre el primer paso para procesar un caso.",
  args: argsLeer,
  async execute(args, ctx) {
    return protegido(async () => {
      const a = leerArgs(z6.object(argsLeer), args);
      const leido = await leerPaquete(ctx.directory, a.caso);
      return exito({ ...leido.paquete, faltantes: leido.faltantes });
    });
  }
};
var validar = {
  description: "Aplica las reglas de control RC1–RC10 al paquete y devuelve si es apta, los bloqueos, las confirmaciones pendientes, los valores derivados de maestros y si la OC es retroactiva.",
  args: argsValidar,
  async execute(args, ctx) {
    return protegido(async () => {
      const a = leerArgs(z6.object(argsValidar), args);
      const c = await cargarCaso(ctx, a.caso);
      exigirIgual("paquete", sinTextoLibre(a.paquete), sinTextoLibre(c.paquete), "oc_leer_paquete");
      if (!c.validacion.apta)
        await registrar(ctx, c, "bloqueada", null);
      return exito(c.validacion);
    });
  }
};
var construir_payload = {
  description: "Construye la orden de compra tal como quedaría en SAP a partir de un paquete apto y guarda la trazabilidad de cada valor; no crea nada en SAP.",
  args: argsConstruir,
  async execute(args, ctx) {
    return protegido(async () => {
      const a = leerArgs(z6.object(argsConstruir), args);
      const c = await cargarCaso(ctx, a.caso);
      exigirIgual("paquete", sinTextoLibre(a.paquete), sinTextoLibre(c.paquete), "oc_leer_paquete");
      exigirIgual("objeto derivados", a.derivados, c.validacion.derivados, "oc_validar");
      if (!c.validacion.apta)
        return fallo(mensajeBloqueos(c.validacion), { bloqueos: c.validacion.bloqueos });
      const { orden, trazabilidad } = await ordenEsperada(ctx, a.caso, c);
      return exito({ payload: orden, trazabilidad: await guardarTrazabilidad(ctx, a.caso, trazabilidad) });
    });
  }
};
var generar_evidencia = {
  description: "Genera el archivo de evidencia con el correo de aprobación del caso (encabezados, cuerpo y sha256) para adjuntarlo a la OC.",
  args: argsEvidencia,
  async execute(args, ctx) {
    return protegido(async () => {
      const a = leerArgs(z6.object(argsEvidencia), args);
      return exito(await generarEvidencia(ctx.directory, a.caso));
    });
  }
};
var crear = {
  description: "Crea la orden de compra en SAP y devuelve su número; solo procede si la solicitud es apta y, cuando hay confirmaciones pendientes, si la analista ya confirmó (confirmado: true).",
  args: argsCrear,
  async execute(args, ctx) {
    return protegido(async () => {
      const a = leerArgs(z6.object(argsCrear), args);
      const c = await cargarCaso(ctx, a.caso);
      const sap = new SapMock(ctx.directory);
      const existente = await sap.buscarOrdenPorReferencia(c.paquete.solicitud.solicitud_id);
      if (existente)
        return ordenExistente(ctx, a.caso, c, existente);
      const rechazo = await motivoParaNoCrear(ctx, c, a.confirmado === true);
      if (rechazo)
        return rechazo;
      const { orden } = await ordenEsperada(ctx, a.caso, c);
      exigirIgual("payload", a.payload, orden, "oc_construir_payload");
      return crearEnSap(ctx, a.caso, c, sap, firmarExcepciones(orden, ctx));
    });
  }
};
async function cargarCaso(ctx, nombre) {
  const [leido, maestros] = await Promise.all([leerPaquete(ctx.directory, nombre), cargarMaestros(ctx.directory)]);
  return { ...leido, maestros, validacion: validarPaquete(leido.paquete, maestros) };
}
function sinTextoLibre(p) {
  return {
    ...p,
    cotizacion: p.cotizacion && { ...p.cotizacion, texto: "" },
    aprobacion: p.aprobacion && { ...p.aprobacion, texto: "" }
  };
}
function exigirIgual(nombre, recibido, real, origen) {
  const distintos = diferencias(recibido, real);
  if (distintos.length === 0)
    return;
  throw new ErrorLegible(`El ${nombre} recibido no coincide con los datos del caso (campos distintos: ${distintos.join(", ")}). Vuelve a llamar ${origen} y usa su resultado sin modificarlo.`);
}
async function ordenEsperada(ctx, nombre, c) {
  const aprobacion = await aprobacionDelCaso(ctx.directory, nombre);
  const evidenciaSha256 = sha256(contenidoEvidencia(aprobacion));
  return construirOrden({ paquete: c.paquete, validacion: c.validacion, maestros: c.maestros, evidenciaSha256 });
}
async function guardarTrazabilidad(ctx, nombre, trazabilidad) {
  await mkdir4(rutaSalida(ctx.directory, nombre), { recursive: true });
  await writeFile2(rutaSalida(ctx.directory, nombre, "trazabilidad.json"), `${JSON.stringify(trazabilidad, null, 2)}
`, "utf8");
  return `out/${nombre}/trazabilidad.json`;
}
async function motivoParaNoCrear(ctx, c, confirmado) {
  const { validacion } = c;
  if (!validacion.apta) {
    await registrar(ctx, c, "bloqueada", null);
    return fallo(mensajeBloqueos(validacion), { bloqueos: validacion.bloqueos });
  }
  if (validacion.confirmaciones.length > 0 && !confirmado) {
    await registrar(ctx, c, "pendiente", null);
    const reglas = validacion.confirmaciones.map((h) => h.regla).join(", ");
    return fallo(`La OC requiere confirmación humana antes de crearse (${reglas}). Presenta cada confirmación a la analista y vuelve a llamar con confirmado: true solo si responde que confirma.`, { confirmaciones: validacion.confirmaciones });
  }
  return null;
}
function firmarExcepciones(orden, ctx) {
  const confirmado_por = `analista (sesión ${ctx.sessionId})`;
  return { ...orden, excepciones: orden.excepciones.map((e) => ({ ...e, confirmado_por })) };
}
async function crearEnSap(ctx, nombre, c, sap, orden) {
  const proveedor = await sap.consultarProveedor(orden.proveedor.nit);
  if (!proveedor?.activo) {
    await registrar(ctx, c, "bloqueada", null);
    return fallo(`SAP no reconoce como activo al proveedor ${orden.proveedor.nombre}; no se creó la OC.`);
  }
  const creada = await sap.crearOrden(orden);
  const idempotente = creada.reutilizada === true;
  const evidencia = await dejarRegistros(ctx, nombre, c, creada, idempotente ? "existente" : "creada");
  return exito({ numero_oc: creada.numero_oc, fecha: creada.fecha, idempotente, evidencia });
}
async function ordenExistente(ctx, nombre, c, existente) {
  const recibo = { numero_oc: existente.numero_oc, fecha: existente.fecha ?? "" };
  const evidencia = await dejarRegistros(ctx, nombre, c, recibo, "existente");
  return exito({ ...recibo, idempotente: true, evidencia });
}
async function dejarRegistros(ctx, nombre, c, recibo, resultado) {
  const evidencia = await generarEvidencia(ctx.directory, nombre);
  await writeFile2(rutaSalida(ctx.directory, nombre, "orden.json"), `${JSON.stringify({ numero_oc: recibo.numero_oc, fecha: recibo.fecha, solicitud_id: c.paquete.solicitud.solicitud_id }, null, 2)}
`, "utf8");
  await registrar(ctx, c, resultado, recibo.numero_oc);
  return evidencia.ruta;
}
function registrar(ctx, c, resultado, numero_oc) {
  return registrarControl(ctx.directory, {
    solicitud_id: c.paquete.solicitud.solicitud_id,
    resultado,
    numero_oc,
    retroactiva: c.validacion.retroactiva,
    bloqueos: c.validacion.bloqueos.map((h) => h.regla),
    confirmaciones: c.validacion.confirmaciones.map((h) => h.regla)
  });
}
function mensajeBloqueos(validacion) {
  const reglas = validacion.bloqueos.map((h) => h.regla).join(", ");
  return `La solicitud no es apta: tiene bloqueos (${reglas}) que impiden crear la OC. Informa a la analista la razón y la acción sugerida de cada uno.`;
}
export {
  construir_payload,
  crear,
  generar_evidencia,
  leer_paquete,
  validar
};
