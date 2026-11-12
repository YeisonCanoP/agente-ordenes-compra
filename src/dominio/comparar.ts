const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor)

const esLista = (valor: unknown): valor is unknown[] => Array.isArray(valor)

/** Rutas ("solicitud.valor_total", "posiciones[0].cantidad") en las que dos valores JSON difieren. */
export function diferencias(a: unknown, b: unknown, ruta = ""): string[] {
  if (esObjeto(a) && esObjeto(b)) {
    const claves = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...claves].flatMap((clave) => diferencias(a[clave], b[clave], ruta ? `${ruta}.${clave}` : clave))
  }
  if (esLista(a) && esLista(b)) {
    const largo = Math.max(a.length, b.length)
    return Array.from({ length: largo }, (_, i) => diferencias(a[i], b[i], `${ruta}[${i}]`)).flat()
  }
  return Object.is(a, b) ? [] : [ruta || "(raíz)"]
}
