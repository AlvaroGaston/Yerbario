import { neon } from '@neondatabase/serverless';

let client;
let clientConnectionString;
let schemaReady;

export function db() {
  const connectionString = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  ]
    .map(value => value?.trim().replace(/^(['"])(.*)\1$/, '$2').trim())
    .find(Boolean);

  if (!connectionString) {
    throw new Error('Falta la conexión a la base de datos. Se buscaron: DATABASE_URL, POSTGRES_URL, POSTGRES_URL_NON_POOLING.');
  }
  if (!client || connectionString !== clientConnectionString) {
    client = neon(connectionString);
    clientConnectionString = connectionString;
    schemaReady = null;
  }
  return client;
}

export async function ensureSchema() {
  const sql = db();
  if (!schemaReady) {
    schemaReady = (async () => {
      await assertNoLegacySchema(sql);
      await sql`CREATE TABLE IF NOT EXISTS usuarios (
        id BIGSERIAL PRIMARY KEY,
        usuario TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        creado TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS usuarios_usuario_lower_idx ON usuarios (lower(usuario))`;
      await sql`CREATE TABLE IF NOT EXISTS yerbas (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT,
        estado TEXT NOT NULL CHECK (estado IN ('probada', 'quiero')),
        nombre TEXT NOT NULL,
        marca TEXT NOT NULL DEFAULT '',
        tipo TEXT NOT NULL DEFAULT '',
        origen TEXT NOT NULL DEFAULT '',
        molienda TEXT NOT NULL DEFAULT '',
        modo TEXT NOT NULL DEFAULT '',
        estacionamiento INTEGER,
        gramos INTEGER,
        precio NUMERIC(12,2),
        lugar TEXT NOT NULL DEFAULT '',
        fecha DATE,
        puntajes JSONB NOT NULL DEFAULT '{"sabor":0,"aroma":0,"amargor":0,"espuma":0,"rendimiento":0,"polvo":0,"precio":0}'::jsonb CHECK (
          jsonb_typeof(puntajes) = 'object'
          AND puntajes ?& ARRAY['sabor','aroma','amargor','espuma','rendimiento','polvo','precio']
          AND (puntajes->>'sabor')::numeric BETWEEN 0 AND 5 AND mod((puntajes->>'sabor')::numeric * 2, 1) = 0
          AND (puntajes->>'aroma')::numeric BETWEEN 0 AND 5 AND mod((puntajes->>'aroma')::numeric * 2, 1) = 0
          AND (puntajes->>'amargor')::numeric BETWEEN 0 AND 5 AND mod((puntajes->>'amargor')::numeric * 2, 1) = 0
          AND (puntajes->>'espuma')::numeric BETWEEN 0 AND 5 AND mod((puntajes->>'espuma')::numeric * 2, 1) = 0
          AND (puntajes->>'rendimiento')::numeric BETWEEN 0 AND 5 AND mod((puntajes->>'rendimiento')::numeric * 2, 1) = 0
          AND (puntajes->>'polvo')::numeric BETWEEN 0 AND 5 AND mod((puntajes->>'polvo')::numeric * 2, 1) = 0
          AND (puntajes->>'precio')::numeric BETWEEN 0 AND 5 AND mod((puntajes->>'precio')::numeric * 2, 1) = 0
        ),
        general NUMERIC(2,1) NOT NULL DEFAULT 0 CHECK (general BETWEEN 0 AND 5 AND mod(general * 2, 1) = 0),
        recompra TEXT NOT NULL DEFAULT '' CHECK (recompra IN ('', 'si', 'tal', 'no')),
        favorita BOOLEAN NOT NULL DEFAULT false,
        pros TEXT NOT NULL DEFAULT '',
        contras TEXT NOT NULL DEFAULT '',
        notas TEXT NOT NULL DEFAULT '',
        tags TEXT[] NOT NULL DEFAULT '{}',
        fotos JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fotos) = 'array'),
        creado TIMESTAMPTZ NOT NULL DEFAULT now(),
        actualizado TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`ALTER TABLE yerbas ADD COLUMN IF NOT EXISTS user_id BIGINT`;
      await sql`UPDATE yerbas SET user_id = (SELECT id FROM usuarios ORDER BY id LIMIT 1)
        WHERE user_id IS NULL AND EXISTS (SELECT 1 FROM usuarios)`;
      await sql`DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'yerbas_user_id_fkey'
              AND conrelid = 'yerbas'::regclass
          ) THEN
            ALTER TABLE yerbas ADD CONSTRAINT yerbas_user_id_fkey
              FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE;
          END IF;
        END;
      $$`;
      await sql`CREATE INDEX IF NOT EXISTS yerbas_user_id_idx ON yerbas (user_id)`;
      await setOwnershipNotNull(sql);
      await sql`CREATE INDEX IF NOT EXISTS yerbas_estado_idx ON yerbas (estado)`;
      await sql`CREATE INDEX IF NOT EXISTS yerbas_fecha_idx ON yerbas (fecha)`;
      await sql`CREATE INDEX IF NOT EXISTS yerbas_favorita_idx ON yerbas (favorita)`;
      await sql`CREATE OR REPLACE FUNCTION yerbario_register_user(
        p_usuario TEXT, p_password_hash TEXT, p_invite_required BOOLEAN, p_invite_valid BOOLEAN
      ) RETURNS TABLE(id BIGINT, usuario TEXT, error_code TEXT)
      LANGUAGE plpgsql AS $$
      DECLARE
        user_count BIGINT;
        new_user_id BIGINT;
      BEGIN
        PERFORM pg_advisory_xact_lock(83746292);
        SELECT count(*) INTO user_count FROM usuarios;
        IF p_invite_required AND NOT p_invite_valid THEN
          RETURN QUERY SELECT NULL::BIGINT, NULL::TEXT, 'invalid_invite'::TEXT;
          RETURN;
        END IF;
        IF NOT p_invite_required AND user_count > 0 THEN
          RETURN QUERY SELECT NULL::BIGINT, NULL::TEXT, 'registration_closed'::TEXT;
          RETURN;
        END IF;
        BEGIN
          INSERT INTO usuarios (usuario, password_hash) VALUES (p_usuario, p_password_hash)
          RETURNING usuarios.id INTO new_user_id;
        EXCEPTION WHEN unique_violation THEN
          RETURN QUERY SELECT NULL::BIGINT, NULL::TEXT, 'username_exists'::TEXT;
          RETURN;
        END;
        IF user_count = 0 THEN
          UPDATE yerbas SET user_id = new_user_id WHERE user_id IS NULL;
        END IF;
        RETURN QUERY SELECT new_user_id, p_usuario, NULL::TEXT;
      END;
      $$`;
    })().catch(error => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

// Una versión anterior de la app usaba yerbas(id, user_id, data) con FK a "users".
// CREATE TABLE IF NOT EXISTS no la reemplaza, y los índices sobre columnas nuevas fallan
// con un error confuso. Cortamos antes con un mensaje claro y sin tocar datos.
async function assertNoLegacySchema(sql) {
  const [legacy] = await sql`
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'yerbas')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'yerbas' AND column_name = 'estado')
       AS incompatible`;
  if (legacy.incompatible) {
    const error = new Error('La tabla yerbas tiene el esquema de una versión anterior (columna data). Hay que moverla al esquema "legacy" antes de usar esta versión.');
    error.code = 'LEGACY_SCHEMA';
    throw error;
  }
}

async function setOwnershipNotNull(sql) {
  const [result] = await sql`SELECT EXISTS (SELECT 1 FROM yerbas WHERE user_id IS NULL) AS has_unowned`;
  if (!result.has_unowned) await sql`ALTER TABLE yerbas ALTER COLUMN user_id SET NOT NULL`;
}

export async function completeOwnershipMigration() {
  const sql = db();
  await sql`UPDATE yerbas SET user_id = (SELECT id FROM usuarios ORDER BY id LIMIT 1)
    WHERE user_id IS NULL AND EXISTS (SELECT 1 FROM usuarios)`;
  await setOwnershipNotNull(sql);
}

export function serializeYerba(row) {
  const date = row.fecha instanceof Date ? row.fecha.toISOString().slice(0, 10) : String(row.fecha || '').slice(0, 10);
  return {
    id: Number(row.id),
    estado: row.estado,
    nombre: row.nombre,
    marca: row.marca,
    tipo: row.tipo,
    origen: row.origen,
    molienda: row.molienda,
    modo: row.modo,
    estacionamiento: row.estacionamiento == null ? null : Number(row.estacionamiento),
    gramos: row.gramos == null ? null : Number(row.gramos),
    precio: row.precio == null ? null : Number(row.precio),
    lugar: row.lugar,
    fecha: date,
    puntajes: row.puntajes || {},
    general: Number(row.general),
    recompra: row.recompra,
    favorita: Boolean(row.favorita),
    pros: row.pros,
    contras: row.contras,
    notas: row.notas,
    tags: row.tags || [],
    fotos: row.fotos || [],
    creado: new Date(row.creado).getTime(),
    actualizado: new Date(row.actualizado).getTime(),
  };
}
