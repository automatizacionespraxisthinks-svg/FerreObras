# FerreObras

Seguimiento de obras de clientes importantes para **FerreAceros**. Las asesoras registran cada proyecto de construcción, llevan el historial de lo que el cliente compró en cada etapa (cimentación, placas, cubierta…) y reciben en Google Calendar un aviso antes de cada etapa con el detalle de la compra anterior, para ofrecer el material a tiempo.

Forma parte del ecosistema de atención de FerreAceros (Chatwoot + WAHA + n8n + PostgreSQL) y se despliega en Dokploy junto al resto de servicios.

---

## Cómo funciona

```
Asesora ──► FerreObras (esta app) ──► PostgreSQL
                    │
                    │ webhook (obra creada / fechas actualizadas / obra cerrada)
                    ▼
                  n8n ──► Google Calendar  (evento el día del aviso, 8:00 a.m., asesora invitada)
                    └──► Chatwoot          (al cerrar: etiqueta seg_mensual si no tiene otra obra activa)
```

1. La asesora crea la obra: cliente, obra, maestro, línea de WhatsApp, fecha de cimentación, número de placas, intervalo entre placas, días de aviso y código de precio por línea de producto.
2. La app genera las etapas y calcula, para cada una, la fecha programada y la fecha de aviso.
3. n8n crea un evento en Calendar por cada aviso. La descripción incluye los datos de la obra, los precios y **qué compró y qué no compró el cliente en la última etapa**.
4. Cuando la asesora marca una etapa como vendida (o cambia su fecha), las etapas siguientes se recalculan y los eventos se mueven solos.
5. Al cerrar la obra se eliminan los avisos pendientes y, si el cliente no tiene otra obra en curso, pasa al seguimiento de cliente inactivo en Chatwoot.

### Cálculo de fechas

- `fecha(etapa N) = fecha real o programada (etapa N-1) + intervalo de la etapa N`
- `aviso(etapa N) = fecha(etapa N) − días de aviso de la etapa N`
- Una fecha real o una fecha fijada a mano corta la cadena: las etapas anteriores no se mueven, las posteriores sí.
- Intervalo y días de aviso son por etapa; los de la obra son solo el valor inicial.

---

## Estructura del repositorio

```
app/                 Aplicación web (Node 20 + Express + EJS)
  src/server.js      Rutas y lógica
  src/calc.js        Cálculo de etapas y avisos
  src/notify.js      Avisos a n8n
  views/             Plantillas
  public/            Estilos y JS del cliente
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
| `obras` | Cabecera del proyecto, códigos de precio (`jsonb`), estado `activa` / `cerrada` |
| `etapas` | Una fila por etapa: orden, nombre, intervalo, días de aviso, fecha programada, fecha real, fecha de aviso, estado, id del evento |
| `ventas_etapa` | Check por línea de producto y etapa, con detalle libre |
| `lineas_producto` | Columnas del historial; se pueden agregar o desactivar desde la app |
| `lineas_whatsapp` | Línea → correo de la asesora invitada al evento |

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
   | `N8N_WEBHOOK_CALENDAR` | URL del webhook `vip-calendar` |
   | `N8N_WEBHOOK_CIERRE` | URL del webhook `vip-cierre` |
   | `PORT` | Puerto interno (3000) |

3. Dominio con HTTPS apuntando al puerto 3000.
4. Deploy.

### 4. Prueba
Entra con una línea, crea una obra con 2 placas y verifica que aparezcan dos eventos en el calendario en las fechas de aviso. Marca la Placa 1 como vendida con un par de líneas: el evento de la Placa 2 debe actualizar su descripción.

---

## Desarrollo local

```bash
cd app
cp .env.example .env      # ajusta DATABASE_URL y claves
npm install
npm start                 # http://localhost:3000
```

La app no crea tablas: aplica `schema.sql` antes de arrancar.

---

## Decisiones de diseño

- **PostgreSQL en vez de Google Sheets**: el recálculo en cadena al mover una placa se vuelve frágil en hojas de cálculo; en la base es determinista y auditable.
- **Sin modelo de lenguaje**: la descripción del evento se genera con plantilla a partir de lo que registró la asesora. Es exacta por construcción.
- **Eventos solo hacia adelante**: una etapa cuyo aviso ya pasó no genera evento retroactivo.
- **Un usuario por línea de WhatsApp**: permite saber qué línea registró cada obra y define quién queda invitada al evento.

---

## Licencia

Uso interno de FerreAceros / Praxisia.