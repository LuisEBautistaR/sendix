const nf1 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${nf1.format(bytes / 1024)} KB`;
  return `${nf1.format(bytes / (1024 * 1024))} MB`;
}

export function formatMs(ms: number): string {
  if (ms < 1) return `${nf1.format(ms)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${nf1.format(ms / 1000)} s`;
}

/** Long spans in words: "41 s", "6 min 03 s", "1 h 02 min". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export function clockTime(epoch: number): string {
  return new Date(epoch).toLocaleTimeString("es-MX", { hour12: false });
}

export function dayLabel(epoch: number, now = Date.now()): string {
  const day = (t: number) => new Date(t).toDateString();
  if (day(epoch) === day(now)) return "Hoy";
  if (day(epoch) === day(now - 86_400_000)) return "Ayer";
  return new Date(epoch).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

/** The usual Node/OpenSSL certificate errors, explained. */
const TLS_ERRORS: Record<string, string> = {
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "No se pudo comprobar quién firmó el certificado del servidor: falta un certificado intermedio o la CA no es de confianza en este equipo. Si es una CA interna, añádela en Ajustes.",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "La CA que firmó el certificado del servidor no es de confianza en este equipo. Si es una CA interna, añádela en Ajustes.",
  UNABLE_TO_GET_ISSUER_CERT: "No se encontró el certificado de quien firmó el del servidor (cadena incompleta).",
  SELF_SIGNED_CERT_IN_CHAIN: "La cadena del servidor termina en una CA autofirmada que este equipo no conoce. Si es la CA de tu empresa o de pruebas, añádela en Ajustes.",
  DEPTH_ZERO_SELF_SIGNED_CERT: "El servidor usa un certificado autofirmado. Añádelo como CA en Ajustes o, solo para pruebas, envía sin verificar.",
  CERT_HAS_EXPIRED: "El certificado del servidor caducó.",
  CERT_NOT_YET_VALID: "El certificado del servidor aún no es válido: revisa la fecha del equipo o del servidor.",
  ERR_TLS_CERT_ALTNAME_INVALID: "El certificado no corresponde a este nombre de host: el servidor presenta un certificado para otro dominio.",
  CERT_REVOKED: "El certificado del servidor fue revocado.",
  CERT_SIGNATURE_FAILURE: "La firma del certificado del servidor no es válida.",
  ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED: "El servidor pide un certificado de cliente. Configúralo para este host y puerto en Ajustes.",
  ERR_SSL_TLSV1_ALERT_UNKNOWN_CA: "El servidor no acepta el certificado de cliente enviado: no lo firmó una CA en la que confía.",
  ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE: "El servidor cortó la negociación TLS; puede que pida un certificado de cliente o una versión de TLS distinta.",
};

/** Errors where the fix is about certificates: verification, a CA or a client certificate. */
export function isTlsError(code: string): boolean {
  return code in TLS_ERRORS || /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|ERR_SSL/.test(code);
}

/** Plain-language explanation for transport errors (the code is shown too). */
export function explainError(code: string, timeoutMs?: number): string {
  if (/TIMEDOUT/.test(code)) {
    return `Se agotó el tiempo de espera${timeoutMs ? ` (${formatMs(timeoutMs)})` : ""}. Puedes ampliarlo en los ajustes de la petición o, para todas, en Ajustes (Ctrl+,).`;
  }
  const tls = TLS_ERRORS[code];
  if (tls) return tls;
  if (isTlsError(code)) {
    return "El certificado TLS del servidor no es válido. Si es un entorno de pruebas, puedes desactivar la verificación en Ajustes.";
  }
  const known: Record<string, string> = {
    ECONNREFUSED: "El servidor rechazó la conexión. Comprueba que está en marcha y escucha en ese puerto.",
    ENOTFOUND: "No se encontró el dominio. Revisa la URL o tu conexión a internet.",
    EAI_AGAIN: "No se pudo resolver el dominio en este momento. Revisa tu conexión.",
    ECONNRESET: "El servidor cerró la conexión antes de responder.",
    EPROTO: "Error de protocolo al negociar TLS o HTTP.",
    RESPONSE_TOO_LARGE: "La respuesta supera el tamaño máximo. Puedes subirlo en Ajustes (Ctrl+,), sección Peticiones.",
    ENGINE_UNAVAILABLE: "El motor no está disponible en este momento; se está reiniciando.",
    ENGINE_EXITED: "El motor se detuvo mientras atendía la petición y se reiniciará solo.",
    TIMEOUT: "El motor no respondió a tiempo.",
    INVALID_PARAMS: "La petición tiene datos no válidos.",
    HANDSHAKE_REJECTED: "El servidor rechazó la conexión durante el saludo inicial. Revisa la ruta, las cabeceras o la autorización.",
    CONNECT_FAILED: "No se pudo establecer la conexión. Comprueba la URL, el puerto y que el servidor admite este protocolo.",
    INVALID_URL: "La URL no es válida para este protocolo.",
    INVALID_AUTH: "El campo auth de Socket.IO debe ser un objeto JSON.",
    SCRIPT_ERROR: "El script de antes de la petición falló, así que la petición no se envió. Corrígelo en Scripts.",
  };
  return known[code] ?? "La petición no se pudo completar.";
}
