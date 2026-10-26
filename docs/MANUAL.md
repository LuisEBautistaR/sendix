# Manual de uso de Sendix

Sendix es un cliente de API para Windows: envías peticiones HTTP, conectas por WebSocket y Socket.IO, llamas servicios gRPC y guardas todo como colecciones de Postman v2.1 en una carpeta tuya.

¿Es la primera vez? Empieza por la [guía rápida](GUIA-RAPIDA.md). Este manual explica cada función por tarea; el [README](../README.md) tiene los detalles técnicos y de seguridad.

**Contenido**

1. [Instalar](#1-instalar)
2. [Conceptos](#2-conceptos)
3. [La ventana](#3-la-ventana)
4. [Componer una petición](#4-componer-una-petición)
5. [Leer la respuesta](#5-leer-la-respuesta)
6. [Colecciones y carpeta de trabajo](#6-colecciones-y-carpeta-de-trabajo)
7. [Variables, entornos y secretos](#7-variables-entornos-y-secretos)
8. [Importar](#8-importar)
9. [Scripts y tests](#9-scripts-y-tests)
10. [Ejecutar una colección](#10-ejecutar-una-colección)
11. [WebSocket y Socket.IO](#11-websocket-y-socketio)
12. [gRPC](#12-grpc)
13. [Ajustes](#13-ajustes)
14. [Red: proxy y certificados](#14-red-proxy-y-certificados)
15. [Con Mockix](#15-con-mockix) (próxima versión)
16. [Historial y datos de este equipo](#16-historial-y-datos-de-este-equipo)
17. [Atajos de teclado](#17-atajos-de-teclado)
18. [Problemas frecuentes](#18-problemas-frecuentes)

## 1. Instalar

Descarga `Sendix-<versión>-setup.exe` de [protohub.digital/sendix](https://protohub.digital/sendix/) o de [GitHub Releases](https://github.com/LuisEBautistaR/sendix/releases/latest). Funciona en Windows 10 y 11 de 64 bits, se instala solo para tu usuario, sin permisos de administrador, y no pide cuenta.

- **Aviso de Windows:** el instalador todavía no está firmado, así que SmartScreen puede avisar la primera vez. Pulsa «Más información» y luego «Ejecutar de todas formas». Para asegurarte de que el archivo es el original, compara su huella SHA-256 con la de la página de descarga: `(Get-FileHash .\Sendix-<versión>-setup.exe).Hash` en PowerShell.
- **Actualizaciones:** Sendix busca versiones nuevas al arrancar, las descarga sola y las instala al reiniciar. En **Estado del sistema** (el icono del pulso, abajo en el rail) ves el estado y puedes buscar o reiniciar para instalar.
- **Desinstalar:** desde Configuración de Windows. Tu carpeta de trabajo no se toca.

## 2. Conceptos

| Palabra | Qué es |
|---|---|
| **Carpeta de trabajo** | Una carpeta tuya donde Sendix guarda colecciones y entornos como archivos. Puedes ponerla en git. |
| **Colección** | Un grupo de peticiones y carpetas, en un archivo de Postman v2.1. |
| **Petición** | Método, URL, cabeceras, cuerpo, autorización, scripts y ajustes. |
| **Entorno** | Un conjunto de variables (desarrollo, pruebas, producción…). Solo uno está activo a la vez. |
| **Variable** | Un valor con nombre que se usa como `{{nombre}}` en la URL, las cabeceras, el cuerpo o la autorización. |
| **Secreto** | Una variable de entorno cifrada en tu equipo que nunca se escribe en la carpeta. |
| **Motor** | El proceso aparte que envía las peticiones y ejecuta los scripts. Si falla, se reinicia solo. |

```
mis-apis/                                 ← la carpeta de trabajo (abre esta)
├─ sendix.workspace.json
├─ collections/
│  └─ JSONPlaceholder.postman_collection.json
└─ environments/
   └─ Pruebas.postman_environment.json
```

Los archivos son los mismos que exporta Postman: puedes abrirlos en Postman, en Newman o en Mockix.

## 3. La ventana

- **Barra de título:** la carpeta de trabajo abierta (con su menú para abrir otra, verla en el explorador o cerrarla) y, a la derecha, el **entorno activo**.
- **Rail (iconos de la izquierda):** Colecciones, Entornos e Historial. Abajo, **Ajustes** y **Estado del sistema**.
- **Barra lateral:** el árbol de colecciones, la lista de entornos o el historial, según el icono elegido.
- **Pestañas:** cada petición se abre en su pestaña. Un punto en la pestaña indica cambios sin guardar.
- **Petición y respuesta:** lado a lado. Arrastra el divisor para dar más ancho a una u otra. Con las flechas del teclado también se mueve y con doble clic vuelve al ancho original; Sendix lo recuerda.
- **Barra de estado:** el estado del motor, la carpeta abierta y el aviso de **variables de sesión** (sección 9).

## 4. Componer una petición

**Método y URL.** Elige el método y escribe la URL. Los parámetros de la consulta (`?pagina=2&orden=fecha`) aparecen en la pestaña **Parámetros** y se mantienen sincronizados. Si desmarcas uno, sale de la URL pero queda en la tabla para volver a usarlo. Pegar un comando `curl` en la URL lo convierte en la petición.

**Autorización.** En **Autorización** eliges:

| Tipo | Qué envía |
|---|---|
| **Heredar de la carpeta o colección** | La autorización de la carpeta o la colección que la contiene (solo en peticiones guardadas). |
| **Sin autorización** | Nada. |
| **Bearer token** | `Authorization: Bearer <token>`. |
| **Básica** | Usuario y contraseña en `Authorization: Basic …`. |
| **Clave de API** | Un nombre y un valor en una cabecera o en la consulta. |

Las autorizaciones que Sendix aún no edita (OAuth 2.0, Digest, AWS…) se conservan del archivo y se envían igual.

**Cabeceras.** Una tabla de nombre y valor; cada fila se puede desactivar sin borrarla. Al enviar se añaden las cabeceras estándar (`Host`, `Accept`, `Accept-Encoding`, `Connection`), `User-Agent: Sendix/<versión>` y, si el cuerpo es JSON, `Content-Type`; no se añaden cabeceras de rastreo como `Postman-Token`. La **Cronología** muestra las que salieron de verdad.

**Cuerpo.** En **Cuerpo** eliges:
- **Ninguno**.
- **Texto o JSON**, con formato JSON, Texto, XML, HTML o JavaScript. El editor resalta la sintaxis, marca las `{{variables}}` y **Formatear** ordena el JSON.
- **x-www-form-urlencoded**.
- **form-data**, de momento solo con campos de texto.

**Ajustes de la petición.** En **Ajustes**:
- **Básicos:** tiempo máximo, seguir redirecciones y verificar el certificado TLS.
- **Avanzado:** cada opción admite «Heredar», «Sí» o «No», y se guarda en el `protocolProfileBehavior` del archivo.
  - Máximo de redirecciones.
  - Método original al redirigir.
  - Authorization al redirigir.
  - Quitar Referer.
  - Enviar la URL sin codificar.
  - Sin cookies.

  «Heredar» usa lo que digan la carpeta o la colección.

**Enviar.** **Enviar** o `Ctrl Enter`. Mientras espera, **Cancelar** la corta.

## 5. Leer la respuesta

Arriba ves el **estado** (verde 2xx, rojo 4xx y 5xx), el tiempo total, el tamaño y una **barra de tiempos** que reparte la petición entre DNS, conexión, TLS, espera y descarga.

| Pestaña | Contenido |
|---|---|
| **Cuerpo** | **Formateado** (JSON y XML ordenados, con plegado), **Crudo** (tal cual llegó) y **Vista previa** para HTML e imágenes. |
| **Cabeceras** | Las cabeceras de la respuesta. |
| **Cookies** | Las cookies que el servidor estableció, con dominio, ruta y caducidad. |
| **Tests** | El resultado de cada `pm.test` (sección 9). |
| **Consola** | Lo que escribieron los scripts con `console.log`. |
| **Cronología** | El tiempo de cada fase y la petición real que se envió, con sus cabeceras. |

- **Buscar:** la lupa o `Ctrl F` dentro del cuerpo, con opciones de mayúsculas, expresión regular y palabra completa.
- **Filtrar:** con **JSONPath** en respuestas JSON (`$.productos[*].nombre`, `$.items[?(@.precio > 100)]`) o con **XPath** en XML (`//producto/nombre`). Copiar copia el resultado filtrado.
- **Leer como:** el selector junto a las vistas fuerza el formato (JSON, XML, HTML o Texto) cuando el servidor no lo indica bien.
- **Vista previa de HTML:** se muestra aislada, sin ejecutar scripts ni cargar nada de internet.
- **Respuestas grandes:** se ven completas. Por encima de 5 MB se muestran sin colores para que el desplazamiento siga fluido. El límite de descarga se cambia en Ajustes.

Si no hubo respuesta, Sendix explica la causa en palabras (dirección mal escrita, servidor apagado, tiempo agotado, certificado…) y muestra el código del error.

## 6. Colecciones y carpeta de trabajo

**Abrir una carpeta.** **Abrir carpeta…** en la barra lateral, o el menú de la barra de título. Puede estar vacía o tener colecciones exportadas de Postman. Sendix recuerda las carpetas recientes y abre la última al arrancar.

**Crear.** El **+** de la barra lateral crea una colección. El menú de una colección o carpeta (los tres puntos) permite:
- crear una petición o una carpeta;
- ejecutarla;
- renombrarla;
- duplicar un elemento;
- eliminarla.

**Guardar.** `Ctrl S` guarda la pestaña. Si la petición es nueva, Sendix pregunta el nombre, la colección y la carpeta.

**Sin pérdidas.** Al guardar, Sendix solo reescribe lo que cambiaste. Los ejemplos, las descripciones y lo que aún no edita se conservan tal cual, y guardar sin cambios deja el archivo idéntico. Así un `git diff` muestra solo tu cambio.

## 7. Variables, entornos y secretos

**Dónde viven las variables.** Las variables vienen de dos sitios:
- **la colección:** en su archivo;
- **el entorno activo:** tiene prioridad si se repite un nombre.

**Crear un entorno.** En **Entornos** (rail) pulsa **+**, escribe un nombre, añade variables y pulsa **Guardar** (`Ctrl S`). Elige el entorno activo en **Entorno**, arriba a la derecha.

**Usarlas.** Escribe `{{nombre}}` en la URL, las cabeceras, el cuerpo, la autorización o los mensajes de tiempo real. En la URL se ven resaltadas, y en rojo si no tienen valor. La vista previa de la petición muestra cómo quedará.

**Secretos.** Marca la casilla del **candado** en una variable del entorno:
- su valor se cifra con Windows en tu perfil y nunca se escribe en la carpeta;
- la interfaz no lo recibe nunca: se añade solo al enviar;
- en la consola y en los tests aparece como `••••••••`.

**Variables de sesión.** Lo que guardan los scripts con `pm.environment.set` o `pm.collectionVariables.set`:
- se usa en las siguientes peticiones, pero **no se escribe en los archivos**: dura hasta cerrar Sendix;
- la barra de estado avisa cuando hay valores de sesión, y **Olvidar** los borra;
- para escribirlos en los archivos, usa la opción del ejecutor (sección 10).

## 8. Importar

El icono **Importar** de la barra lateral acepta:

| Archivo | Resultado |
|---|---|
| Colección de Postman v2.0 o v2.1 | Una colección (la v2.0 se convierte). |
| Entorno de Postman | Un entorno; sus valores secretos pasan al almacén cifrado. |
| OpenAPI 3 o Swagger 2 (`.json` o `.yaml`) | Una colección con una petición por operación. |
| HAR (captura del navegador) | Una colección con las peticiones capturadas, sin cookies ni `Authorization`. |

Y pegar un comando `curl` en la URL lo convierte en la petición.

## 9. Scripts y tests

En **Scripts** hay dos momentos:

- **Antes de la petición:** prepara variables, cabeceras o firmas. Si falla, la petición no se envía.
- **Después de la respuesta:** escribe tests y guarda valores para otras peticiones.

Usan la misma API `pm.*` de Postman: `pm.test`, `pm.expect`, `pm.response`, `pm.environment`, `pm.collectionVariables`, `pm.iterationData`, `pm.sendRequest`… Los scripts de la colección y de cada carpeta se ejecutan antes que los de la petición, como en Postman.

```js
pm.test("El estado es 200", () => pm.response.to.have.status(200));
pm.test("Hay productos", () => pm.expect(pm.response.json().productos).to.not.be.empty);
pm.environment.set("token", pm.response.json().token);
```

- El editor autocompleta `pm.*` y los nombres de variables, y a la derecha tiene **fragmentos** listos para insertar.
- Cada script tiene un tiempo máximo de 30 segundos y corre aislado, sin acceso a tus archivos.

## 10. Ejecutar una colección

Desde el menú de una colección o carpeta, **Ejecutar…**.

1. **Orden de ejecución:**
   - marca qué peticiones corren;
   - usa las flechas para cambiar el orden;
   - **Orden de la colección** lo restablece.
2. **Iteraciones y retraso:** cuántas vueltas y cuántos milisegundos esperar entre peticiones.
3. **Datos:** un archivo CSV o JSON (un arreglo de objetos). Cada fila alimenta una iteración: una columna `email` se usa como `{{email}}` o `pm.iterationData.get("email")`. Si hay más iteraciones que filas, se repite la última.
4. **Opciones:**
   - **Detener en el primer fallo:** sin respuesta, un test que falla o un script con error.
   - **Guardar las variables al terminar:** escribe en el entorno activo y en la colección lo que dejaron los scripts; los secretos siguen cifrados.
   - **Conservar las respuestas:** cabeceras y cuerpo, hasta 256 KB por fila, para verlos al expandirla mientras Sendix siga abierto.
   - **Guardar la salida de consola.**
   - **Cookies:** las de Sendix, o empezar sin cookies y, al terminar, añadir las de la ejecución o descartarlas.

Mientras corre ves el progreso, los tests y el tiempo de cada petición; **Con fallos** filtra las que fallaron y cada fila se expande con su detalle.

**Ejecuciones anteriores.** Guarda las últimas 50 de cada equipo:
- **Ver:** sus resultados;
- **Repetir:** con la misma selección y opciones;
- **Exportar:** a JSON;
- **Borrar**.

Aún no se admite `setNextRequest`: el orden es siempre el que elegiste.

## 11. WebSocket y Socket.IO

En una pestaña nueva, en el selector de método, grupo **Tiempo real**, elige **WebSocket** o **Socket.IO** y escribe la URL (`ws://`, `wss://`, `http://` o `https://`).

- **WebSocket:**
  - cabeceras y subprotocolos al conectar;
  - mensajes de texto o binarios;
  - los códigos de cierre vienen explicados.
- **Socket.IO** (servidores v3 y v4):
  - la ruta del servidor y el `auth` del saludo en JSON;
  - recibe cualquier evento;
  - emite un evento con sus argumentos y espera su respuesta (*ack*).
- **Registro:**
  - cada mensaje con hora y tamaño;
  - filtro y búsqueda;
  - detalle en JSON formateado o volcado hexadecimal.
- **Reconexión opcional:** con espera creciente si la conexión se corta, nunca si la cierras tú.
- **Guardar:** las conexiones y sus mensajes se guardan en la colección junto a tus peticiones.

## 12. gRPC

En una pestaña nueva, en el selector de método, elige **gRPC** y escribe la dirección del servidor (`localhost:50051`).

1. **Definición:** por **reflexión** del servidor o cargando tus archivos `.proto` y sus rutas de importación. Sendix solo lee los archivos que eliges.
2. **Método:** elige servicio y método. Sendix genera un **mensaje de ejemplo** desde el esquema y avisa si escribes un campo que no existe.
3. **Llamada:**
   - unaria;
   - stream del servidor;
   - stream del cliente: envías varios mensajes y terminas;
   - bidireccional.
4. **Metadatos:** también binarios (`-bin` en base64).
5. **Seguridad:** TLS verificado, TLS sin verificar para pruebas o **mTLS** con CA, certificado y clave; además, el *deadline*.

La respuesta muestra el estado gRPC explicado, las cabeceras, los *trailers* y los mensajes del stream.

## 13. Ajustes

**Ajustes** (`Ctrl ,` o el icono de los deslizadores en el rail) se guardan en tu perfil y se aplican al momento.

| Sección | Opciones |
|---|---|
| **Apariencia** | Tema **Sistema** (sigue a Windows), **Claro** u **Oscuro**. |
| **Editor de código** | Tamaño de letra (también en las respuestas), sangría de 2 o 4 espacios y cierre automático de llaves y comillas. |
| **Peticiones** | Tiempo máximo para peticiones nuevas y guardadas, tamaño máximo de respuesta, verificar certificados TLS, seguir redirecciones y enviar `Cache-Control: no-cache`. |
| **Red y certificados** | Proxy, CA propia y certificados de cliente (sección 14). |
| **Datos de este equipo** | La carpeta del perfil, borrar el historial y la versión. |

Los interruptores globales de TLS y redirecciones **solo pueden desactivar**: si apagas la verificación aquí, ninguna petición verifica certificados, aunque la suya diga que sí. Se aplica también a WebSocket, Socket.IO, gRPC y al ejecutor.

## 14. Red: proxy y certificados

**Proxy** (solo para peticiones HTTP):

- **Sin proxy:** conexión directa.
- **Del sistema:** Sendix pregunta a Windows qué proxy usar para cada URL, también con archivos PAC.
- **Propio:** servidor (`host:puerto`), usuario y contraseña. La contraseña se guarda cifrada.

**Excepciones** lista los hosts que no usan el proxy, separados por comas: nombres exactos (`localhost`), `*.interno.empresa` o `.interno.empresa`.

**CA propia.** Un archivo PEM con la autoridad de certificación de tu empresa. Sendix confía en ella además de en las de Windows.

**Certificados de cliente.** Para servidores que piden identificarte con un certificado (mTLS):
1. Escribe el **host** o `host:puerto` (sin puerto, el 443).
2. Elige el **CRT** y la **KEY**, o un **PFX**/P12.
3. Escribe la contraseña si tiene, y pulsa **Añadir**.

El certificado solo se envía a ese host y puerto. Sendix solo lee los archivos que eliges en el diálogo.

**Errores de certificado.** Cuando un servidor presenta un certificado que no se puede verificar, Sendix explica por qué y ofrece:
- **Reenviar sin verificar esta petición:** solo para servidores de prueba;
- ir a **CA y certificados de cliente en Ajustes**.

## 15. Con Mockix

> **A partir de la próxima versión.** La 0.2.1 todavía no incluye esta integración.

[Mockix](https://protohub.digital/mockix/) simula APIs; las dos apps se hablan con enlaces y siempre piden confirmación.

- **De Mockix a Sendix:** en Mockix, **Abrir en Sendix** abre una petición del log.
  - Sendix muestra método, URL, cabeceras y cuerpo, y pregunta **¿Abrir esta petición?**
  - Si aceptas, se abre en una pestaña nueva sin guardar; nada se envía hasta que pulses **Enviar**.
- **De Sendix a Mockix:** en el menú de una colección, **Crear mock desde esta colección**.
  - Solo aparece si Mockix está instalado.
  - Mockix recibe el archivo de la colección y pide confirmación antes de importarla.
  - Si tu carpeta de trabajo también es un workspace de Mockix, importa en ella; si no, en el workspace que Mockix tenga abierto.

## 16. Historial y datos de este equipo

**Historial** (rail) guarda las últimas peticiones enviadas, agrupadas por día.
- Al abrir una, vuelve a una pestaña.
- **Sin credenciales:** guarda la petición sin `Authorization`, cookies, tokens ni contraseñas, y tampoco los cuerpos de las respuestas.
- **Borrar historial:** en **Ajustes → Datos de este equipo**.

En la carpeta del perfil (`%APPDATA%\Sendix`) están:
- `settings.json`: ajustes y carpetas recientes;
- `sendix.db`: historial y ejecuciones;
- `secrets.bin`: secretos cifrados.

Tu carpeta de trabajo no guarda nada de esto.

## 17. Atajos de teclado

| Atajo | Acción |
|---|---|
| `Ctrl Enter` | Enviar la petición, conectar o enviar el mensaje |
| `Ctrl S` | Guardar la pestaña |
| `Ctrl T` | Nueva pestaña |
| `Ctrl W` | Cerrar la pestaña |
| `Ctrl L` | Ir a la URL |
| `Ctrl ,` | Abrir Ajustes |
| `Ctrl F` | Buscar dentro del cuerpo o del editor |

## 18. Problemas frecuentes

| Problema | Qué hacer |
|---|---|
| **ENOTFOUND** | La dirección está mal escrita o no hay conexión a internet. |
| **ECONNREFUSED** | No hay nada escuchando en esa dirección y puerto: arranca tu servidor o revisa el puerto. |
| **Se agotó el tiempo de espera** | Sube el tiempo máximo en los ajustes de la petición o en **Ajustes → Peticiones**. |
| **Error de certificado** | Para pruebas, **Reenviar sin verificar esta petición**; para la CA de tu empresa, **Ajustes → Red y certificados**. |
| **El servidor pide un certificado de cliente** | Añádelo en **Ajustes → Red y certificados** con el host y el puerto exactos. |
| **La respuesta supera el tamaño máximo** | Súbelo en **Ajustes → Peticiones**. |
| **Una variable sale en rojo** | No tiene valor en el entorno activo: revisa el selector **Entorno**. |
| **«El script de antes de la petición falló»** | Corrígelo en **Scripts**; el error y la consola dicen dónde. |
| **Motor reiniciando** | Un script o una respuesta tumbó el motor; se reinicia solo. **Estado del sistema** muestra qué pasó. |
| **Windows avisa al instalar** | El instalador no está firmado: «Más información» → «Ejecutar de todas formas», y compara la huella SHA-256. |
