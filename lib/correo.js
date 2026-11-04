import nodemailer from 'nodemailer';
import { HttpError } from './http.js';

const URL_PRODUCCION = 'https://yerbario.vercel.app';
let transport;

function transporte() {
  const user = process.env.GMAIL_USER?.trim();
  // Google muestra la contraseña de aplicación en bloques con espacios: se quitan.
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '');
  if (!user || !pass) {
    console.error('[correo] error Faltan GMAIL_USER o GMAIL_APP_PASSWORD.');
    throw new HttpError(503, 'El envío de correos todavía no está configurado. Probá de nuevo más tarde.');
  }
  transport ??= nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  return transport;
}

// Los enlaces de los correos nunca salen del encabezado Host (lo podría falsear un atacante):
// se usa APP_URL, o localhost en desarrollo, o la URL de producción.
export function urlApp(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  const host = String(req.headers.host || '');
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return `http://${host}`;
  return URL_PRODUCCION;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function plantilla({ titulo, saludo, texto, boton, enlace, pie }) {
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#f3f1ea;font-family:Arial,Helvetica,sans-serif;color:#1d2a1f">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1ea;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e3dfd2">
        <tr><td style="background:#2f7d4f;padding:22px 28px;color:#ffffff;font-size:22px;font-weight:bold">🧉 Yerbario</td></tr>
        <tr><td style="padding:28px">
          <h1 style="margin:0 0 14px;font-size:21px;color:#1d2a1f">${esc(titulo)}</h1>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.55">${esc(saludo)}</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.55">${esc(texto)}</p>
          <p style="margin:0 0 24px"><a href="${esc(enlace)}" style="display:inline-block;background:#2f7d4f;color:#ffffff;text-decoration:none;font-weight:bold;padding:13px 24px;border-radius:10px;font-size:15px">${esc(boton)}</a></p>
          <p style="margin:0 0 6px;font-size:13px;color:#6b7468">Si el botón no funciona, copiá este enlace en el navegador:</p>
          <p style="margin:0 0 20px;font-size:13px;word-break:break-all"><a href="${esc(enlace)}" style="color:#2f7d4f">${esc(enlace)}</a></p>
          <p style="margin:0;font-size:13px;color:#6b7468">${esc(pie)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
  const text = `${titulo}\n\n${saludo}\n${texto}\n\n${boton}: ${enlace}\n\n${pie}`;
  return { html, text };
}

async function enviar(to, subject, contenido) {
  try {
    await transporte().sendMail({
      from: `"Yerbario" <${process.env.GMAIL_USER.trim()}>`,
      to, subject, ...contenido,
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('[correo] error', err.message, err.code ? `code=${err.code}` : '');
    throw new HttpError(502, 'No pudimos enviar el correo. Probá de nuevo en unos minutos.');
  }
}

export function enviarVerificacion(req, { email, usuario, token }) {
  const enlace = `${urlApp(req)}/?verificar=${encodeURIComponent(token)}`;
  return enviar(email, 'Confirmá tu correo en Yerbario', plantilla({
    titulo: 'Confirmá tu correo',
    saludo: `¡Hola, ${usuario}!`,
    texto: 'Gracias por crear tu cuenta en Yerbario. Para empezar a usarla, confirmá que este correo es tuyo.',
    boton: 'Confirmar mi correo',
    enlace,
    pie: 'El enlace vence en 24 horas. Si no creaste esta cuenta, ignorá este mensaje.',
  }));
}

export function enviarRecuperacion(req, { email, usuario, token }) {
  const enlace = `${urlApp(req)}/?restablecer=${encodeURIComponent(token)}`;
  return enviar(email, 'Restablecé tu contraseña de Yerbario', plantilla({
    titulo: 'Restablecé tu contraseña',
    saludo: `Hola, ${usuario}.`,
    texto: 'Recibimos un pedido para cambiar la contraseña de tu cuenta. Elegí una nueva desde este enlace.',
    boton: 'Elegir una contraseña nueva',
    enlace,
    pie: 'El enlace vence en 1 hora. Si no lo pediste, ignorá este mensaje: tu contraseña no cambia.',
  }));
}
