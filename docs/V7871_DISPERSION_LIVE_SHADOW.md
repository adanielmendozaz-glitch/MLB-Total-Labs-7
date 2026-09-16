# V7.8.7.1 — Dispersion Live Shadow

Añade identificación PRE-GAME y en tiempo real para el experimento de dispersión `.14 → .16`.

## Regla exacta

Un juego aparece como candidato sólo cuando:
- probabilidad >= 56%
- edge >= 3.5%
- dispersión > 14% y <= 16%
- `gateFailed === DISPERSION`
- todavía no está FINAL/LIVE

## Qué aparece

En Calibration Shadow:
- `CANDIDATOS DISPERSIÓN .14→.16 · actuales`
- partido
- lado/línea
- probabilidad
- edge
- dispersión
- gate

En Ranking y Jornada:
- etiqueta morada `DISP .14→.16 · SHADOW`

## Seguridad

- Producción sigue en dispersión `.14`.
- No convierte PASS en JUGABLE.
- No modifica motores, pesos, probabilidades, edge, Censo ni Team Shadow.
- Conserva package y firma estable, así que se instala encima de V7.8.7.
