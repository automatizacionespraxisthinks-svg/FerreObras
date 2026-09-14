# FerreObras

Seguimiento de obras de clientes importantes para **FerreAceros**. Las asesoras registran cada proyecto de construcción, llevan el historial de lo que el cliente compró en cada etapa (inicio, etapas, cubierta…) y reciben en Google Calendar un aviso antes de cada etapa con el detalle de la compra anterior, para ofrecer el material a tiempo. El administrador cuenta con un panel de informes con indicadores, gráficas y exportación a Excel para la trazabilidad de todas las obras.

Forma parte del ecosistema de atención de FerreAceros (Chatwoot + WAHA + n8n + PostgreSQL) y se despliega en Dokploy junto al resto de servicios. La interfaz sigue la identidad visual de [ferreacerossas.net](https://ferreacerossas.net/) (Poppins, azul `#092F77`, amarillo `#FFE600`).

---

## Cómo funciona

```
Asesora ──► FerreObras (esta app) ──► PostgreSQL
                    │
                    │ webhook (obra creada / fechas actualizadas / obra cerrada)
                    ▼
                  n8n ──► Google Calendar  (evento el día del aviso, 8:00 a.m., asesora invitada)
                    └──► Chatwoot          (al cerrar: etiqueta seg_mensual si no tiene otra obra activa)

Administrador ──► /admin  (indicadores, gráficas de barras con filtros, tablas de trazabilidad, Excel)

Asesora ──► /rutas  (planificador de despachos: clientes por municipio + mapa del recorrido)
```

1. La asesora crea la obra: cliente, obra, residente de obra, línea de WhatsApp, fecha inicial, número de etapas, intervalo entre etapas, días de aviso y código de precio por línea de producto.
2. La app genera las etapas y calcula, para cada una, la fecha programada y la fecha de aviso.
3. n8n crea un evento en Calendar por cada aviso. La descripción incluye los datos de la obra, los precios y **qué compró y qué no compró el cliente en la última etapa**.
4. Cuando la asesora marca una etapa como vendida (o cambia su fecha), las etapas siguientes se recalculan y los eventos se mueven solos.
5. Al cerrar la obra se eliminan los avisos pendientes y, si el cliente no tiene otra obra en curso, pasa al seguimiento de cliente inactivo en Chatwoot.
6. El administrador revisa en `/admin` el desempeño por línea, etapa, producto y mes, las alertas de avisos y la lista completa de obras, y exporta todo a Excel.

### Cálculo de fechas

- `fecha(etapa N) = fecha real o programada (etapa N-1) + intervalo de la etapa N`
- `aviso(etapa N) = fecha(etapa N) − días de aviso de la etapa N`
- La fecha programada no se edita a mano: es fija y se calcula desde la etapa anterior. Solo la fecha inicial (etapa 0) se puede cambiar. Cuando una etapa ocurre en otra fecha se registra su **fecha real**, que corta la cadena: las etapas anteriores no se mueven, las posteriores se recalculan.
- Intervalo y días de aviso son por etapa; los de la obra son solo el valor inicial.

---

## Usuarios

| Usuario | Cómo entra | Qué ve |
|---|---|---|
| Línea de WhatsApp (`3232`, `3333`, …) | Selecciona su línea en el login y usa la clave `PASS_<línea>` | Obras, nueva obra, líneas de producto, exportación de cada obra |
| Administrador | Selecciona **Administrador** y usa `ADMIN_PASS` | Todo lo anterior **más** el módulo **Administración** (`/admin`), visible en la barra de navegación solo para esta cuenta |

Si `ADMIN_PASS` no está definida, la opción de administrador no aparece en el login.

## Panel de administración (`/admin`)

- **Filtros combinables**: periodo (sobre fecha de etapa, de aviso o de creación), líneas de WhatsApp, estado de obra, estado de etapa y líneas de producto. Los cambios se aplican al instante sin recargar la página y quedan en la URL, así que un informe filtrado se puede compartir.
- **Indicadores**: obras, clientes, etapas, vendidas, sin venta, pendientes, conversión, checks de producto, avisos vencidos / de hoy / 7 días / 30 días, promedio de etapas por obra, duración de obras cerradas.
- **Gráfica configurable**: elige la métrica (obras, etapas, vendidas, sin venta, pendientes, conversión, ventas por producto), la dimensión de agrupación (línea, mes, etapa, obra, cliente, producto, código de precio, estados) y una segmentación opcional. Las barras se apilan o agrupan según corresponda.
- **Gráficas fijas**: etapas por línea, conversión por etapa, ventas por producto, obras creadas por mes, códigos de precio por producto y avisos pendientes por semana.
- **Tablas**: alertas de aviso, desempeño por línea, conversión por etapa, productos, clientes con más etapas vendidas, evolución mensual y trazabilidad de obras (buscable y ordenable, con enlace a cada obra). Cada columna lleva un icono ⓘ que, al pasar el cursor o tocarlo, explica qué mide y cómo se relaciona con la tabla de trazabilidad.
- **Exportar informe a Excel**: genera un libro con los mismos filtros (ver abajo).

## Rutas de despacho (`/rutas`)

Reemplaza la agenda de ferreterías en Excel con la que las asesoras armaban cada despacho. Está disponible para todas las cuentas desde el menú **Rutas** (la agenda también desde **Agenda**) y tiene tres secciones:

- **Planificador** (`/rutas`): a la izquierda se elige la ruta y aparecen, agrupados por municipio y en el orden del recorrido, los clientes que se pueden contactar. Son chips: la **×** quita al cliente del despacho, los punteados se vuelven a agregar con **+**, y al tocar el nombre se abre la ficha (teléfonos con enlace a llamada y WhatsApp, dirección, NIT, razón social, etc.), donde se piden el peso en kg, el estado del contacto (*por contactar, no contesta, pendiente respuesta, no necesita, despacho confirmado*, que se ve con su color en el chip y en el mapa) y una observación. **Escribir el peso confirma el despacho**: el cliente pasa al estado *despacho confirmado* y, si estaba fuera, se agrega automáticamente a la ruta; borrar el peso lo devuelve a *por contactar*. El peso se muestra en el chip, se suma por municipio y en la cabecera aparece el **peso total de la ruta**, para decidir qué camión enviar. También se pueden agregar clientes de otros municipios o crear uno nuevo. A la derecha, un mapa (OpenStreetMap) muestra la sede de salida, los municipios numerados, el recorrido por carretera con distancia y tiempo estimados, y un punto por cada cliente seleccionado con el color de su estado. El recorrido se puede abrir en Google Maps para navegar. La planificación se guarda por ruta y se exporta a Excel.
- **Agenda** (`/agenda`, también en el menú principal): directorio completo de contactos, ferreterías y clientes de obras en curso, con búsqueda libre (nombre, teléfono, municipio, NIT…), filtros por tipo, municipio y ruta, ordenamiento por columna, enlaces de llamada y WhatsApp, creación y edición de ferreterías con el mismo formulario del planificador y **exportación a Excel** que respeta los filtros aplicados (`/agenda/export.xlsx`).
- **Gestión de rutas** (`/rutas/gestion`): crear, editar, activar/desactivar y eliminar rutas (nombre, sede de salida, municipios en orden, frecuencia, días, próximo despacho, color y notas), ver cuántos clientes tiene cada municipio y qué ferreterías quedan fuera de toda ruta activa, e **importar la agenda de Excel**.

### Cómo se calculan los clientes de una ruta
- **Ferreterías** del directorio (`clientes_ruta`) cuyo municipio está entre los municipios de la ruta.
- **Clientes de obras en curso** cuyo campo *Obra o municipio* (o la dirección de la obra o del cliente) menciona uno de esos municipios.
- Los nombres se comparan sin tildes ni mayúsculas y con variantes conocidas ("VILLA DE LEIVA", "Santa Rosa" → Santa Rosa de Viterbo).

### Importar la agenda de Excel
Se leen las hojas con encabezado **CLIENTE**/NOMBRES y **MUNICIPIO**/CIUDAD (y, si existen, dirección, sector, NIT o cédula, razón social, teléfonos, tipología y volumen de compra) y la hoja **CRONOGRAMA RUTAS** (fila con RUTA 1, RUTA 2… y debajo los municipios separados por guiones y la frecuencia). Los clientes repetidos se reconocen por celular y municipio, o por nombre y municipio: solo se completan los datos que falten y se agregan celulares nuevos, nunca se borra lo editado en la aplicación. Las rutas que ya existen no se modifican.

### Ubicación en el mapa
- `src/municipios.js` trae las coordenadas de la cabecera de los 123 municipios de Boyacá y de las sedes (Duitama, Sogamoso y Planta de Figuración). Si una sede cambia, se ajusta ahí.
- Cada cliente se dibuja alrededor del centro de su municipio (ubicación aproximada) hasta que la asesora lo **ubica en el mapa** con un clic o usa **Buscar dirección**.
- Un municipio que no esté en el catálogo se busca en OpenStreetMap (Nominatim) y queda guardado en `rutas_geocache`.

Servicios externos que usa el navegador: Leaflet (`cdn.jsdelivr.net`), mapas de `tile.openstreetmap.org` y el trazado por carretera de `router.project-osrm.org`; el servidor consulta `nominatim.openstreetmap.org` solo para municipios fuera del catálogo y para buscar direcciones a pedido. Si no hay internet, la lista de clientes y la planificación funcionan igual.

## Exportación a Excel

Los archivos se generan con `exceljs` y tienen estructura y formato (títulos, encabezados azules, cebra, bordes, fechas y porcentajes con formato, filas de estado coloreadas, paneles congelados y filtros automáticos).

- **Obra** (`/obras/:id/export.xlsx`): hojas *Resumen* (ficha, indicadores, códigos de precio), *Etapas*, *Ventas por etapa* (matriz etapa × producto con totales) y *Detalle de ventas*.
- **Panel** (`/admin/export.xlsx?…filtros`): hojas *Resumen* (filtros aplicados e indicadores), *Por línea*, *Por etapa*, *Por producto*, *Por mes*, *Clientes*, *Alertas*, *Obras*, *Etapas*, *Ventas* y *Gráfica configurada*.
- **Ruta** (`/rutas/:id/export.xlsx`): hojas *Planificación* (resumen por estado, peso total en la ruta, peso confirmado y clientes seleccionados en orden de parada, con teléfonos, dirección, estado, peso y observación) y *No incluidos*.

La ruta antigua `/obras/:id/export.csv` redirige al nuevo `.xlsx`.

---

## Estructura del repositorio

```
app/                 Aplicación web (Node 20 + Express + EJS)
  src/server.js      Rutas, autenticación (líneas + administrador) y lógica
  src/calc.js        Cálculo de etapas y avisos
  src/reportes.js    Filtros, indicadores, tablas y series del panel de administración
  src/excel.js       Libros de Excel (obra, panel y planificación de ruta) con estilo
  src/rutas.js       Módulo de rutas: tablas, clientes por ruta, planificación, importación de la agenda
  src/municipios.js  Catálogo de municipios de Boyacá y sedes con coordenadas
  src/notify.js      Avisos a n8n
  views/             Plantillas (incluye admin.ejs, rutas_planificador.ejs, rutas_gestion.ejs, ruta_form.ejs)
  public/            style.css, app.js (común), admin.js (panel, Chart.js), rutas.js (planificador, Leaflet)
  Dockerfile
  .env.example
n8n/
  VIP_Calendar.json  Crea, actualiza y elimina los eventos de Calendar
  VIP_Cierre.json    Etiqueta al cliente en Chatwoot cuando cierra su última obra
schema.sql           Tablas de PostgreSQL
```

### Tablas

| Tabla | Contenido |
|---|---|
| `obras` | Cabecera del proyecto, códigos de precio (`jsonb`), estado `activa` / `cerrada`, `creada_por` (línea o `admin`) |
| `etapas` | Una fila por etapa: orden, nombre, intervalo, días de aviso, fecha programada, fecha real, fecha de aviso, estado, id del evento |
| `ventas_etapa` | Check por línea de producto y etapa, con detalle libre |
| `lineas_producto` | Columnas del historial; se pueden agregar o desactivar desde la app |
| `lineas_whatsapp` | Línea → correo de la asesora invitada al evento |
| `rutas` | Ruta: nombre, municipios en orden (`jsonb`), sede de salida, frecuencia, días, próximo despacho, color, activa |
| `clientes_ruta` | Directorio de ferreterías: municipio, dirección, sector, NIT, razón social, teléfonos, tipología, volumen |
| `rutas_plan` | Planificación por ruta y cliente (ferretería u obra): incluido, estado del contacto, peso, observación, quién lo actualizó |
| `rutas_ubicaciones` | Ubicación fijada a mano en el mapa para una ferretería (`c`) o una obra (`o`) |
| `rutas_geocache` | Coordenadas encontradas para municipios fuera del catálogo |

El usuario administrador no requiere cambios en el esquema: se define por variables de entorno igual que las líneas. Las tablas del módulo de rutas se crean solas al arrancar la aplicación si no existen (`CREATE TABLE IF NOT EXISTS`); requieren que ya exista la tabla `obras`.

---

## Instalación

### 1. Base de datos
Ejecuta `schema.sql` una vez en la base PostgreSQL que usa n8n. Revisa que los correos en `lineas_whatsapp` sean los de cada línea.

### 2. Flujos de n8n
Importa los dos archivos de `n8n/`, verifica que las credenciales de PostgreSQL y Google Calendar quedaron enlazadas y actívalos. Anota la Production URL de cada webhook:

- `…/webhook/vip-calendar`
- `…/webhook/vip-cierre`

### 3. Aplicación en Dokploy
1. Nueva **Application** → Build type **Dockerfile**, apuntando a la carpeta `app/`.
2. Variables de entorno (ver `app/.env.example`):

   | Variable | Descripción |
   |---|---|
   | `DATABASE_URL` | Conexión a PostgreSQL (la misma de n8n) |
   | `SESSION_SECRET` | Texto largo aleatorio para la sesión |
   | `PASS_3232` … `PASS_3535` | Clave de acceso de cada línea |
   | `ADMIN_USER` | Nombre del usuario administrador (por defecto `admin`) |
   | `ADMIN_PASS` | Clave del administrador. Vacía = sin acceso de administrador |
   | `N8N_WEBHOOK_CALENDAR` | URL del webhook `vip-calendar` |
   | `N8N_WEBHOOK_CIERRE` | URL del webhook `vip-cierre` |
   | `PORT` | Puerto interno (3000) |

3. Dominio con HTTPS apuntando al puerto 3000.
4. Deploy.

### 4. Prueba
Entra con una línea, crea una obra con 2 etapas y verifica que aparezcan dos eventos en el calendario en las fechas de aviso. Marca la Etapa 1 como vendida con un par de líneas: el evento de la Etapa 2 debe actualizar su descripción. Luego entra como administrador, revisa que el panel muestre la obra y descarga el Excel del informe.

---

## Desarrollo local

```bash
cd app
cp .env.example .env      # ajusta DATABASE_URL, claves de línea y ADMIN_PASS
npm install
npm start                 # http://localhost:3000
```

El servidor lee el archivo `.env` automáticamente al arrancar si existe (en Dokploy no hace falta: las variables llegan por el entorno del contenedor y tienen prioridad sobre el archivo). Si una clave lleva `#`, escríbela entre comillas.

**Logo.** La cabecera y el login usan `public/logo-ferreaceros.svg` (recreación del logo de FerreAceros). Si se copia el archivo original como `public/logo-ferreaceros.png`, la app lo usa en su lugar sin cambiar código.

La app no crea tablas: aplica `schema.sql` antes de arrancar. El panel de administración carga Chart.js desde `cdn.jsdelivr.net`; si el navegador no tiene salida a internet, las tablas e indicadores se muestran igual y las gráficas indican que la librería no cargó.

---

## Decisiones de diseño

- **PostgreSQL en vez de Google Sheets**: el recálculo en cadena al mover una etapa se vuelve frágil en hojas de cálculo; en la base es determinista y auditable.
- **Sin modelo de lenguaje**: la descripción del evento se genera con plantilla a partir de lo que registró la asesora. Es exacta por construcción.
- **Eventos solo hacia adelante**: una etapa cuyo aviso ya pasó no genera evento retroactivo.
- **Un usuario por línea de WhatsApp**: permite saber qué línea registró cada obra y define quién queda invitada al evento.
- **Informes calculados en el servidor**: `src/reportes.js` es la única fuente de los indicadores; la pantalla (`/admin/datos.json`) y el Excel (`/admin/export.xlsx`) muestran exactamente lo mismo para los mismos filtros.

---

## Licencia

Uso interno de FerreAceros / Praxisia.
