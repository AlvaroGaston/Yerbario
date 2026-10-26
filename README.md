# Yerbario

Diario personal de yerba mate. El frontend es HTML, CSS y JavaScript vanilla; la API usa Vercel Functions, Neon Postgres y Vercel Blob.

## Requisitos

- Una cuenta de GitHub y una cuenta de Vercel.
- Node.js 20 o superior y npm para trabajar en local. Vercel ejecuta las funciones con Node.js 24.
- La base Neon y el almacenamiento Blob configurados en el proyecto Vercel.

## Crear el proyecto y conectarlo con GitHub

1. Subí este repositorio a GitHub.
2. En Vercel, elegí **Add New… → Project**, importá el repositorio y dejá el framework como **Other**.
3. No configures un comando de build. `vercel.json` publica directamente `public/` y Vercel detecta las funciones de `api/`.
4. Antes del primer deploy, vinculá el almacenamiento y configurá las variables de entorno indicadas abajo.

## Configurar Neon Postgres y Blob

1. En el proyecto de Vercel, abrí la pestaña **Storage** y elegí **Create Database → Neon Postgres**.
2. Creá una base de datos y conectala al proyecto. Copiá la variable `DATABASE_URL` que proporciona la integración (con SSL habilitado).
3. En **Storage**, elegí **Create Store → Blob**, creá un store público y conectalo al mismo proyecto. Copiá `BLOB_READ_WRITE_TOKEN`.
4. La aplicación crea la tabla e índices automáticamente la primera vez que accede a la API. También se incluye el esquema en [`db/schema.sql`](./db/schema.sql).

## Variables de entorno

En Vercel, entrá a **Settings → Environment Variables** y agregá estas variables para Development, Preview y Production según corresponda:

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | Cadena de conexión de Neon |
| `BLOB_READ_WRITE_TOKEN` | Token de lectura/escritura del store Blob |
| `APP_PASSWORD` | Contraseña única para entrar a Yerbario |
| `SESSION_SECRET` | Secreto aleatorio de al menos 32 caracteres para firmar sesiones |

Generá un secreto fuerte, por ejemplo con `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`. No agregues secretos al repositorio. `.env.example` contiene valores ilustrativos y no debe usarse como configuración real.

## Desarrollo local

1. Instalá las dependencias con `npm install`.
2. Instalá la CLI de Vercel si todavía no está disponible: `npm install -g vercel`.
3. Iniciá sesión y vinculá el directorio al proyecto: `vercel link`.
4. Descargá las variables del entorno de desarrollo: `vercel env pull .env.local`.
5. Si hace falta, agregá `APP_PASSWORD` y `SESSION_SECRET` a `.env.local` o configurá ambas también en Vercel antes de descargar.
6. Ejecutá `npm run dev` (equivale a `vercel dev`) y abrí la URL local que informa la CLI.

Las cookies son `Secure`, por lo que el navegador y el entorno local de Vercel deben servir la aplicación mediante localhost/HTTPS. No abras `public/index.html` directamente como archivo.

## Primer deploy

1. Confirmá que las cuatro variables estén configuradas en **Production**.
2. En Vercel, seleccioná **Deploy** en el proyecto, o subí los cambios a la rama conectada a producción.
3. Al terminar, abrí el dominio asignado e ingresá la contraseña definida en `APP_PASSWORD`.
4. Probá crear una yerba y subir una foto. Los datos se guardan en Postgres y las imágenes en Blob; la base almacena únicamente las URLs.

## Datos y respaldos

- **Datos → Exportar respaldo** descarga un JSON con las URLs de las fotos.
- **Datos → Importar respaldo** omite duplicados por nombre, marca y fecha.
- **Datos → Migrar datos de este navegador** importa la base IndexedDB heredada si el navegador todavía la conserva.
- **Datos → Borrar todo** requiere confirmación y borra las yerbas y fotos asociadas del servidor.
