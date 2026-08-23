# MLB Total Labs V7.0 — Android V0

Objetivo de V0: empaquetar el MLB Total Labs V7.0 actual como APK sin cambiar el motor estadístico.

## Qué conserva
- Un solo mercado: Over/Under Full Game.
- PA/Markov-24 + RE24.
- Negative Binomial.
- Poisson-Lognormal.
- COM-Poisson.
- Monte Carlo y ensamble.
- Ranking, Censo, Sportsbook LAB, apuestas y análisis por equipo.
- Almacenamiento web actual (localStorage + IndexedDB) durante V0.

## Estructura
- `www/`: aplicación web que Capacitor empaqueta dentro del APK.
- `netlify/functions/odds.js`: proxy de líneas usado por la versión web/Netlify.
- `capacitor.config.json`: configuración Android.
- `.github/workflows/android-debug.yml`: compila un APK debug instalable desde GitHub Actions.

## Primer flujo recomendado

En Termux, dentro del repositorio:

```bash
pkg update
pkg install git nodejs -y
npm install
npx cap add android
npx cap sync android
```

No es obligatorio compilar Android dentro de Termux. El workflow incluido puede hacerlo en GitHub Actions.

## GitHub Actions

1. Sube todos los archivos de este paquete a un repositorio GitHub.
2. Abre la pestaña `Actions`.
3. Ejecuta `Build Android APK V0`.
4. Al terminar, descarga el artifact `MLB_Total_Labs_7_0_V0_APK`.
5. Dentro estará `MLB_Total_Labs_7_0_V0-debug.apk`.

## Punto pendiente conocido de V0

La app original intenta primero `/.netlify/functions/odds` para líneas públicas. Dentro de un APK esa ruta ya no pertenece a Netlify. El código ya tiene fallbacks directos ESPN/Covers, por lo que el motor y la carga de jornada siguen separados de ese proxy. En una siguiente revisión conectaremos el endpoint remoto explícitamente o moveremos esta función a una capa Android/backend estable.

## No modificar todavía

Antes de migrar a SQLite hay que comparar WEB vs APK con los mismos juegos, líneas y número de simulaciones. V0 queda aprobada sólo si los resultados del motor coinciden.
