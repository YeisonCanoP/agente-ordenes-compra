/** "900.555.111-2" → "900555111" (sin puntos ni dígito de verificación). */
export function normalizarNit(nit: string): string {
  return (nit.split("-")[0] ?? "").replace(/\D/g, "")
}

/** Minúsculas, sin tildes ni puntuación: "Papelería Central Ltda." → "papeleria central ltda". */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** Interpreta "COP 11.400.000", "1.234,56" o "1,234.56". Devuelve null si no es un número. */
export function parsearMonto(texto: string): number | null {
  const crudo = texto.replace(/[^\d.,-]/g, "")
  if (!/\d/.test(crudo)) return null
  const numero = Number(quitarSeparadores(crudo))
  return Number.isFinite(numero) ? numero : null
}

function quitarSeparadores(crudo: string): string {
  const decimal = separadorDecimal(crudo)
  const miles = decimal === "," ? "." : ","
  const sinMiles = crudo.split(miles).join("")
  return decimal === null ? sinMiles.replace(/[.,]/g, "") : sinMiles.replace(decimal, ".")
}

/** El separador decimal es el último que aparece, salvo que parezca separador de miles. */
function separadorDecimal(crudo: string): "." | "," | null {
  const ultimoPunto = crudo.lastIndexOf(".")
  const ultimaComa = crudo.lastIndexOf(",")
  if (ultimoPunto === -1 && ultimaComa === -1) return null
  const candidato = ultimoPunto > ultimaComa ? "." : ","
  const otro = candidato === "." ? "," : "."
  if (crudo.includes(otro)) return candidato
  const grupos = crudo.split(candidato)
  const esMiles = grupos.length > 2 || (grupos[1] ?? "").length === 3
  return esMiles ? null : candidato
}

/** 25000000, "COP" → "COP 25.000.000". Formato fijo para que la salida sea determinista. */
export function formatoMonto(valor: number, moneda: string): string {
  const [entero = "0", decimales = "00"] = Math.abs(valor).toFixed(2).split(".")
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  const cola = decimales === "00" ? "" : `,${decimales}`
  return `${moneda} ${valor < 0 ? "-" : ""}${miles}${cola}`
}

/** 0.06 → "6,00 %". */
export function formatoPorcentaje(razon: number): string {
  return `${(razon * 100).toFixed(2).replace(".", ",")} %`
}

/** Día calendario (AAAA-MM-DD) de una fecha ISO, en la zona horaria con la que viene escrita. */
export function diaDe(fechaIso: string): string {
  return fechaIso.slice(0, 10)
}

export function sumarDias(dia: string, dias: number): string {
  const fecha = new Date(`${dia}T00:00:00Z`)
  fecha.setUTCDate(fecha.getUTCDate() + dias)
  return fecha.toISOString().slice(0, 10)
}
