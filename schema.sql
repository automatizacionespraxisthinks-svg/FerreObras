-- ============================================================
-- FerreObras · tablas creadas por los módulos de esta aplicación
--
-- Las tablas base (obras, etapas, ventas_etapa, lineas_producto, lineas_whatsapp) vienen del script de
-- instalación original. Las del módulo de rutas se crean solas al arrancar (src/rutas.js).
-- Esta tabla también se crea sola al arrancar (src/hoja_vida.js); el script queda como documentación y
-- para ejecutarlo a mano si se prefiere. Es idempotente.
-- ============================================================

-- Hoja de vida del cliente (módulo /hv, embebido en Chatwoot). Una por cliente, identificada por el celular.
CREATE TABLE IF NOT EXISTS hojas_vida (
  id                  SERIAL PRIMARY KEY,
  celular             TEXT NOT NULL UNIQUE,            -- 10 dígitos, sin +57
  datos               JSONB NOT NULL DEFAULT '{}',     -- campos de la hoja; la lista permitida está en src/hoja_vida.js (CAMPOS)
  chatwoot_contact_id INTEGER,                         -- id del contacto en Chatwoot, si se conoce
  creado_por          TEXT,                            -- correo del agente de Chatwoot o usuario de la aplicación
  actualizado_por     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
