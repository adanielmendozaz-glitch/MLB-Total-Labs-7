# MLB Totals Lab V7.8.7 — Stability Calibration Shadow

Base exacta requerida:
- Rama: `v786-calibration-shadow-v1`
- Commit: `7180f59323715103af82b5ca35498d3533fe2d8d`
- App package: `com.totallabs.mlb.v786calshadow1`

## Objetivo
Capa de calibración temporal 100% Shadow/read-only.

NO modifica:
- motores STRUCT / NB / PLN / COM,
- pesos,
- picks oficiales,
- probabilidad oficial,
- edge oficial,
- DataVault,
- Team Shadow como gate real.

Producción permanece:
- prob = 0.56
- edge = 0.035
- dispersión = 0.14

## Stability Score 0–100
- continuidad de señal: 35 puntos
- continuidad de lado: 25 puntos
- cambios de línea: 15 puntos
- probability drift: 25 puntos

Bandas:
- 90–100: MUY ESTABLE
- 75–89: ESTABLE
- 55–74: MIXTO
- 0–54: INESTABLE

## PASS-STABLE-CONSENSUS
Categoría Shadow, nunca apuesta automática.

Condiciones:
- señal actual PASS
- Decision Trace disponible
- dispersión <= 0.10
- signalFlipCount = 0
- sideFlipCount = 0
- |probabilityDrift| < 0.01
- consenso FUERTE o ACEPTABLE

OVER recibe bonus de rating solamente en Shadow.

## Dispersión 0.14 → 0.16
Simulación Shadow únicamente:
- gateFailed = DISPERSION
- 0.14 < dispersión <= 0.16
- probabilidad >= 0.56
- edge >= 0.035

## FIRST SIGNAL → CURRENT SIGNAL
Una promoción tardía nunca borra que el partido nació PASS/LEAN.

## Android
Conserva package y firma estable de Calibration Shadow V1.2.1.
Se instala como actualización encima de V1.2.1.
Rescue H1 no se toca.
