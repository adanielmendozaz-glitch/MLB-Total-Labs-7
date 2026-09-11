# MLB Totals Lab V7.8.6 — Calibration Shadow V1

Base exacta: `v786-history-rescue-h1` commit `1f6abf77481f84b6d0bde0578f01beb207ea40f4`.

## Objetivo

Agregar una capa **100% observacional** para auditar el Censo, Decision Trace y Team Shadow sin modificar:
- motores,
- pesos,
- probabilidades,
- umbrales oficiales,
- picks,
- DataVault.

## Hallazgo que entra a Shadow

En el DataVault del 10-sep-2026:

- JUGABLE oficial: 51 casos, 28-23, hit 54.9%, ROI 1u +3.1%, Brier 0.255.
- JUGABLE estable con Decision Trace: 16 casos, 13-3, hit 81.3%, ROI 1u +51.9%, Brier 0.207.
- Promovido a JUGABLE desde PASS/LEAN/LAB: 11 casos, 3-8, hit 27.3%, ROI 1u -47.9%, Brier 0.311.

Esto **no se activa como filtro real**. Se vigila fuera de muestra.

Team Shadow continúa read-only: en 8 casos donde el gating habría cambiado la decisión, registró 1 derrota evitada, 3 ganadores bloqueados y promociones LEAN 1-2.

## Qué agrega la APK

Nueva pestaña `Calibración` que recalcula en tiempo real:

- Baseline oficial.
- Stability Guard.
- Promoted-to-JUGABLE.
- Edge >= 5%, 6%, 8%.
- Rank activo <= 5.
- Combinado Stable + Rank + Edge.
- Bandas de probabilidad.
- OVER vs UNDER.
- Brier, ROI 1u y drawdown.
- Auditoría de Team Shadow.

Nada de esto escribe al modelo oficial.

## Aislamiento Android

Package:
`com.totallabs.mlb.v786calshadow1`

Se instala al lado de Rescue H1. Para que vea el historial, importa en ella el DataVault más reciente.

## Regla de promoción

No promover ningún filtro por una sola muestra retrospectiva. Primero exigir nueva evidencia fuera de muestra; Stability Guard queda marcado como `SHADOW FUERTE`, no como producción.
