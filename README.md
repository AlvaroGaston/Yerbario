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
| `GMAIL_USER` | Sí | Cuenta de Gmail que envía los correos (`yerbario.mate.app@gmail.com`). |
| `GMAIL_APP_PASSWORD` | Sí | Contraseña de aplicación de esa cuenta de Google (no la contraseña normal). |
| `APP_URL` | No | URL pública para los enlaces de los correos. Por defecto `https://yerbario.vercel.app`; en local se usa `http://localhost:PUERTO`. |

Cualquiera puede crear una cuenta con correo, usuario y contraseña (dos veces). La cuenta queda inactiva hasta que se abre el enlace que llega por correo. Para crear la contraseña de aplicación: en la cuenta de Google activá la verificación en 2 pasos y entrá a https://myaccount.google.com/apppasswords. Las contraseñas de las cuentas se almacenan con scrypt y salt, nunca en texto plano.

Generá `SESSION_SECRET` localmente, por ejemplo:

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))"
```

`.env.example` contiene valores ilustrativos, no credenciales funcionales. No publiques los valores reales ni subas archivos `.env`.

## Desarrollo local

1. Instalá las dependencias: `npm install`.
2. Creá `.env.local` (podés partir de `.env.example`) con `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `SESSION_SECRET`, `GMAIL_USER` y `GMAIL_APP_PASSWORD`. Las variables de Neon marcadas como Sensitive no se descargan con `vercel env pull`: copiálas desde el panel de Neon.
3. Ejecutá `npm run dev` y abrí http://localhost:3000 (otro puerto: `$env:PORT=3001; npm run dev`).

`npm run dev` usa `scripts/dev-server.mjs`, un servidor Node mínimo que carga `.env.local` con `--env-file`, sirve `public/` y ejecuta los handlers de `api/` sin la CLI de Vercel. No uses `vercel dev`: solo lee `.env` y, si no existe, usa las variables del entorno Development de Vercel, ignorando `.env.local`.

No abras `public/index.html` directamente como archivo: la app requiere sus rutas API. La cookie de sesión usa `Secure`, que los navegadores aceptan en `http://localhost`.

## Cuentas y aislamiento

- Para entrar se usa el usuario o el correo. Las cuentas nuevas deben confirmar el correo antes del primer ingreso.
- "¿Olvidaste tu contraseña?" envía un enlace válido por 1 hora; el de confirmación vale 24 horas. Los enlaces son de un solo uso y en la base solo se guarda su hash.
- Cada registro crea un usuario independiente y cada yerba se guarda con el identificador de su propietario, asignado en el servidor.
- Las consultas, importaciones, eliminaciones y operaciones de fotos se limitan al usuario autenticado.
- Los datos anteriores sin propietario se asignan al usuario de menor ID cuando se crea el primer usuario. No se asignan automáticamente a cuentas posteriores.
- Las sesiones usan cookies `HttpOnly`, `Secure`, `SameSite=Lax` con vencimiento de 30 días.
- Las funciones registradas se resuelven antes de la reescritura de fallback; cualquier otra ruta bajo `/api` devuelve un 404 JSON.

## Red social

- **Inicio**: "Siguiendo" muestra las yerbas probadas de la gente que seguís (y las tuyas); "Descubrir", las de todas las cuentas públicas.
- **Perfil** (`#/u/usuario`): foto, nombre, biografía, contadores y pestañas Yerbas / Quiero probar / Estadísticas. Desde "Editar perfil" se elige qué mostrar y si la cuenta es privada.
- **Cuentas privadas**: seguirlas envía una solicitud; hasta que se acepta no se ven sus yerbas, comentarios ni estadísticas. Al pasar a pública, las solicitudes pendientes se aceptan solas.
- **Interacción**: me gusta, comentarios (el autor o el dueño de la yerba pueden borrarlos), notificaciones con contador y "Guardar en mi lista", que copia la yerba de otro a tu "Quiero probar" (sin sus fotos).
- **Buscar**: por usuario o nombre. Las cuentas sin confirmar el correo no aparecen.
- Todo pasa por `api/social.js` (una sola función por el límite de 12 funciones del plan gratuito de Vercel), y cada consulta revisa si quien mira tiene permiso.

## Datos y respaldos

- **Datos → Exportar respaldo** descarga un JSON; las fotos se incluyen como URLs públicas de Blob.
- **Datos → Importar respaldo** acepta JSON y omite duplicados por nombre, marca y fecha dentro de la cuenta actual.
- **Datos → Migrar datos de este navegador** ofrece importar la antigua base IndexedDB local si todavía existe.
- **Datos → Cargar datos de ejemplo** importa ejemplos en la cuenta actual.
- **Datos → Borrar todo** borra y elimina las fotos asociadas únicamente a la cuenta actual.
