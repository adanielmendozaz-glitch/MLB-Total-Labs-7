# Calibration Shadow V1.2 — Identificación de JUGABLES

Base exacta:
`v786-calibration-shadow-v1`
commit `b6a3b07dfcde617d9c8c7694221490130af6de96`

## Novedad

La capa sigue siendo READ ONLY. No modifica motores, probabilidades, pesos, filtros ni picks oficiales.

Añade identificación automática de JUGABLES:

- **ESTABLE**: nació JUGABLE y mantiene 0 flips de señal y 0 flips de lado.
- **PROMOVIDO**: nació PASS/LEAN/LAB y después subió a JUGABLE, sin cambio de lado.
- **FLIP / INESTABLE**: cambió de lado, volvió a cambiar de señal después de nacer JUGABLE, o acumuló más de un flip de señal.
- **SIN TRAZA**: JUGABLE actual pero Decision Trace aún no permite clasificarlo.

Se muestra en:
1. Calibration Shadow → "JUGABLES actuales".
2. Ranking, junto a la fila del juego.
3. Tarjetas de Jornada cuando la identidad del partido es inequívoca.

También expone:
- primera señal,
- señal actual,
- signalFlipCount,
- sideFlipCount,
- rank activo.

## Firma Android estable

Desde V1.2 la APK experimental usa un keystore debug fijo para esta rama.
Esto evita que cada GitHub Actions genere una firma distinta.

SHA-256 del keystore:
`e74e4f264f9c111e0966cbc8332bdcc32f7f1f290d3a407945c1084397830175`

El keystore es únicamente de depuración para esta app experimental y está dentro del repositorio.
No se usa para Rescue H1 ni para una release pública.
