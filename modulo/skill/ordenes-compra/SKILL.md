---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra de Periferia IT Group - piezas del paquete, flujo de las herramientas oc_*, reglas de control RC1 a RC10, OC retroactivas y log de control. Úsalo al procesar o explicar una solicitud de compra.
---

# Proceso de órdenes de compra (OC)

Conocimiento del proceso que el agente consulta. Las reglas se ejecutan en las herramientas `oc_*`;
este documento explica qué significan y cómo comunicarlas a la analista.

## El paquete

Cada compra llega por correo con tres piezas, y a veces una cuarta:

| Pieza | Para qué sirve |
|---|---|
| Solicitud | Lo que se quiere comprar: proveedor, descripción, centro de costo, subárea, cantidad y valores. |
| Cotización | Oferta del proveedor. Se usa para contrastar el valor de la solicitud. |
| Aprobación | Correo del líder con la palabra "Aprobado". Es la evidencia que sustenta el gasto. |
| Factura | Solo aparece cuando la compra ya ocurrió: indica una OC retroactiva. |

## Flujo

1. `oc_leer_paquete` — reúne y normaliza las piezas. Lo que falte llega como `null` y se lista en `faltantes`.
2. `oc_validar` — aplica las reglas de control y clasifica cada hallazgo.
3. `oc_construir_payload` — arma la OC como quedaría en SAP. Solo si la solicitud es apta.
4. `oc_generar_evidencia` — deja el correo de aprobación como archivo con su sha256.
5. `oc_crear` — crea la OC en SAP. Si hay confirmaciones pendientes, exige `confirmado: true`.

## Tipos de hallazgo

- **Bloqueo**: la OC no se puede crear. Se informa la razón y la acción sugerida; no se insiste ni se busca atajo.
- **Confirmación**: la OC se puede crear, pero solo si la analista lo confirma de forma explícita.
- **Derivado**: valor que no venía en la solicitud y se completó desde un maestro. Siempre se informa.

## Reglas de control

| Regla | Qué verifica | Tipo |
|---|---|---|
| RC1 | El proveedor existe en el maestro (por NIT; si no hay NIT, por nombre) y está activo. | Bloqueo |
| RC2 | Hay aprobación, dice "Aprobado" y viene de un aprobador del centro de costo. | Bloqueo |
| RC3 | El valor total no supera el tope de ese aprobador en ese centro. | Bloqueo |
| RC4 | La subárea pertenece al centro de costo. | Bloqueo |
| RC5 | La cotización no difiere más de 2 % de la solicitud. Si difiere o no hay cotización, se confirma mostrando ambos valores. | Confirmación |
| RC6 | Si falta el indicador de IVA, se toma el del proveedor y se confirma. | Confirmación + derivado |
| RC7 | Si faltan las condiciones de pago, se toman las del proveedor. Solo se informa. | Derivado |
| RC8 | Si hay factura con fecha anterior a la solicitud, la OC es retroactiva. | Confirmación |
| RC9 | La aprobación no puede ser anterior a la solicitud. | Confirmación |
| RC10 | Cantidad × valor unitario debe igualar el valor total (± 1). | Bloqueo |

## OC retroactiva

Una OC es retroactiva cuando se crea después de que llegó la factura, saltándose el orden normal
(solicitud → cotización → aprobación → OC → factura). La dirección quiere medir cuántas hay: por eso
no se rechaza, se crea solo con confirmación y queda marcada `retroactiva = true` en `out/control.csv`.

## Valores de la OC

- La OC se crea por los valores de la **solicitud**, que son los que el líder aprobó. La cotización
  solo sirve para contrastar; nunca se "ajusta" un monto para que cuadre.
- El texto breve de la posición admite 40 caracteres: la descripción se recorta.
- La unidad es `H` o `MES` solo cuando la descripción indica esa cantidad de horas o meses; si no, `UN`.
- Cada valor queda trazado a su fuente en `out/<caso>/trazabilidad.json`.

## Log de control

Cada intento agrega una fila a `out/control.csv` con el resultado: `creada`, `existente` (la OC ya
existía y se devolvió la misma), `pendiente` (falta confirmación) o `bloqueada`.
