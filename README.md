# Planificador de horario

Previsualizador de la oferta académica y planificador automático de horario. Funciona 100 % en el navegador: el Excel de la oferta **no se sube a ningún servidor ni se guarda en el repositorio**; cada estudiante carga su propia copia y la app la procesa localmente.

## Qué hace

- **Carga el Excel de la oferta** (`.xlsx`) arrastrándolo o seleccionándolo. Se guarda en el navegador para no tener que cargarlo cada vez.
- **Separador por programa** (MA01, ISE1, IIN1, …), filtro por semestre / electivas y búsqueda por nombre, código o área.
- **Planificador automático**: agregas las materias que quieres ver y el sistema elige los grupos para que no se crucen.
  - Varias combinaciones posibles: se navegan con las flechas y se ordenan por *menos huecos*, *menos días*, *empezar más tarde* o *terminar más temprano*. También se pueden marcar días que prefieres libres.
  - Materias con varios componentes con el mismo código (p. ej. *Física 1 Laboratorio* y *Física 1 Magistral*) se tratan como una sola materia y se elige un grupo de cada componente.
  - Puedes **fijar un grupo** concreto de cualquier materia; el resto se sigue resolviendo automáticamente.
  - **Cruces**: si no existe ninguna combinación sin cruces, muestra la que menos se cruza (bloques en rojo), indica qué materias siempre se cruzan y en qué horario, si la causa son los grupos que fijaste, y qué materia quitar para resolverlo.
  - Indicador **“Cabe / Se cruza”** en la oferta según lo que ya tienes, y filtro *Solo las que caben*.
  - Respeta grupos sin horario (pasantías, trabajos de grado) y clases que solo se dictan en **fechas específicas** (columna *FECHAS CLASE*).
- **Proyecciones**: guarda varias versiones de tu horario con nombre (p. ej. “Plan mañanas”, “Con electiva”), con sus grupos exactos. Desde la lista puedes compararlas con una vista previa en miniatura, abrir cualquiera, renombrarla, eliminarla o compartirla por enlace. Si modificas una proyección abierta, la barra indica “cambios sin guardar” y puedes actualizarla con un toque. Cuando cargas una versión nueva del Excel, cada proyección indica si sigue al día o si alguno de sus grupos cambió de horario o desapareció.
  - Se guardan en el navegador (`localStorage`). El enlace para compartir lleva solo los códigos de materia y números de grupo (no incluye la oferta): quien lo abre lo ve con su propia copia del Excel, y así también puedes pasar una proyección del computador al celular.
- **Nuevas versiones del Excel**: al cargar una versión actualizada se conserva tu selección y se muestra qué grupos son nuevos, cuáles cambiaron de horario y cuáles desaparecieron, resaltando los que afectan tus materias.
- **Exportar** el horario a calendario (`.ics`, compatible con Google Calendar, Outlook y el calendario del celular) o imprimirlo.
- Diseño pensado para **celular** (pestañas inferiores, hoja de detalle deslizable) y escritorio (dos columnas, vista previa del grupo al pasar el cursor). Modo claro/oscuro automático. Se puede instalar como app y abrir sin conexión.

## Formato del Excel esperado

La app busca automáticamente, en cualquier hoja del libro, una fila de encabezados con columnas como:

`PROGRAMA`, `SEMESTRE`, `ÁREA`, `CÓDIGO`, `CODIGO COMPARTIDO`, `NOMBRE ASIGNATURA`, `GRUPO`, `FECHA INICIO`, `FECHA FIN`, `LUNES` … `SÁBADO` (dos columnas por día: hora de inicio y hora de fin), `SEDE`, `FECHAS CLASE`.

- El orden de las columnas no importa y se toleran tildes, mayúsculas y espacios extra.
- Las horas pueden venir como hora de Excel o como texto (`7:00`, `13:30`, `1:30 p. m.`).
- Los programas se separan por comas o “y” (`MA01, MA02, EC04 y FI01`).
- Si aparecen columnas `DOCENTE`, `SALÓN` o `MODALIDAD`, también se muestran.
- Las filas sin datos de materia (notas, firmas) se ignoran. Las horas que no se puedan leer se reportan en el menú del archivo.

Si el archivo es `.xls` (formato antiguo), ábrelo en Excel y guárdalo como `.xlsx`.

## Desarrollo local

No necesita dependencias ni compilación. Hay que servirlo por HTTP (los módulos de JavaScript no funcionan abriendo el archivo directamente):

```bash
npm start          # equivale a: python3 -m http.server 8080
# abrir http://localhost:8080
npm test           # pruebas del lector de Excel, el parser, el planificador, las proyecciones y el exportador .ics
```

Estructura:

| Archivo | Responsabilidad |
| --- | --- |
| `js/xlsx.js` | Lector de `.xlsx` sin dependencias (ZIP + XML con APIs nativas del navegador). |
| `js/parser.js` | Detecta la tabla de oferta y la convierte en materias → componentes → grupos → sesiones. |
| `js/scheduler.js` | Búsqueda de combinaciones sin cruces, ordenamiento por preferencias y diagnóstico de cruces. |
| `js/ics.js` | Exportación a calendario. |
| `js/projections.js` | Proyecciones guardadas: instantánea, verificación contra la oferta y enlace para compartir. |
| `js/app.js` | Interfaz y persistencia en `localStorage`. |

## Despliegue en GitHub Pages

1. En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Haz push a `main` (o ejecuta manualmente el workflow *Desplegar en GitHub Pages*). El workflow corre las pruebas y publica el sitio.

El `.gitignore` excluye `*.xlsx` para evitar subir la oferta por accidente.
