# Yerbario

Diario personal de yerba mate. La interfaz usa HTML, CSS y JavaScript vanilla; la API corre en Vercel Functions con Node.js; los datos viven en Neon Postgres y las fotos en Vercel Blob.

## Requisitos

- Cuentas de GitHub y Vercel.
- Node.js 20 o superior y npm.
- Un proyecto Neon Postgres y un store de Vercel Blob conectados al proyecto de Vercel.

## Publicar desde GitHub en Vercel

1. Subí este repositorio a GitHub.
2. En Vercel, elegí **Add New… → Project** e importá el repositorio.
3. Dejá el framework como **Other** y no configures un comando de build. `vercel.json` sirve `public/`; las funciones se detectan en `api/`.
4. Antes del primer deploy, conectá Neon y Blob y cargá las variables de entorno indicadas abajo.
5. Hacé el primer deploy desde Vercel. Los siguientes pushes a la rama conectada (por ejemplo, `main`) publican automáticamente.

## Conectar Neon y Vercel Blob

1. En el proyecto de Vercel, abrí **Storage** y creá/conectá una base **Neon Postgres**.
2. Copiá la variable `DATABASE_URL` que proporciona Neon, con SSL habilitado.
3. En **Storage**, creá/conectá un store **Blob** público y copiá `BLOB_READ_WRITE_TOKEN`.
4. La aplicación crea y migra las tablas de forma idempotente al iniciar su API. El SQL equivalente está en [`db/schema.sql`](./db/schema.sql).

## Variables de entorno

En **Settings → Environment Variables**, definí estas variables para los entornos que vayas a utilizar:

| Variable | Requerida | Uso |
| --- | --- | --- |
| `DATABASE_URL` | Sí | Cadena de conexión a Neon Postgres. |
| `BLOB_READ_WRITE_TOKEN` | Sí | Token del store de Vercel Blob para subir y borrar fotos. |
| `SESSION_SECRET` | Sí | Secreto aleatorio de al menos 32 caracteres para firmar las cookies. |
| `INVITE_CODE` | No | Código de invitación. Si se configura, se exige al crear cada cuenta. |

Si `INVITE_CODE` no está definido, solo se permite crear una cuenta cuando todavía no existe ningún usuario; después el registro queda cerrado. Si está definido, el código se exige también para crear la primera cuenta. Las contraseñas de las cuentas se almacenan con scrypt y salt, nunca en texto plano.

Generá `SESSION_SECRET` localmente, por ejemplo:

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))"
```

`.env.example` contiene valores ilustrativos, no credenciales funcionales. No publiques los valores reales ni subas archivos `.env`.

## Desarrollo local

1. Instalá las dependencias: `npm install`.
2. Instalá la CLI de Vercel si todavía no está disponible: `npm install -g vercel`.
3. Iniciá sesión y vinculá el directorio al proyecto: `vercel link`.
4. Descargá las variables de desarrollo: `vercel env pull .env.local`.
5. Verificá que `.env.local` incluya `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN` y `SESSION_SECRET`. Para cerrar el registro, configurá también `INVITE_CODE`.
6. Ejecutá `npm run dev` (equivale a `vercel dev`) y abrí la URL que informa la CLI.

No abras `public/index.html` directamente como archivo: la app requiere sus rutas API. La cookie de sesión usa `Secure`; probá a través de `vercel dev` en localhost.

## Cuentas y aislamiento

- Cada registro crea un usuario independiente y cada yerba se guarda con el identificador de su propietario, asignado en el servidor.
- Las consultas, importaciones, eliminaciones y operaciones de fotos se limitan al usuario autenticado.
- Los datos anteriores sin propietario se asignan al usuario de menor ID cuando se crea el primer usuario. No se asignan automáticamente a cuentas posteriores.
- Las sesiones usan cookies `HttpOnly`, `Secure`, `SameSite=Lax` con vencimiento de 30 días.
- Las funciones registradas se resuelven antes de la reescritura de fallback; cualquier otra ruta bajo `/api` devuelve un 404 JSON.

## Datos y respaldos

- **Datos → Exportar respaldo** descarga un JSON; las fotos se incluyen como URLs públicas de Blob.
- **Datos → Importar respaldo** acepta JSON y omite duplicados por nombre, marca y fecha dentro de la cuenta actual.
- **Datos → Migrar datos de este navegador** ofrece importar la antigua base IndexedDB local si todavía existe.
- **Datos → Cargar datos de ejemplo** importa ejemplos en la cuenta actual.
- **Datos → Borrar todo** borra y elimina las fotos asociadas únicamente a la cuenta actual.
