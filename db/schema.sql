CREATE TABLE IF NOT EXISTS yerbas (
  id BIGSERIAL PRIMARY KEY,
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
);

CREATE INDEX IF NOT EXISTS yerbas_estado_idx ON yerbas (estado);
CREATE INDEX IF NOT EXISTS yerbas_fecha_idx ON yerbas (fecha);
CREATE INDEX IF NOT EXISTS yerbas_favorita_idx ON yerbas (favorita);
