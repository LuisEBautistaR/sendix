# Guía rápida de Sendix

Tu primera petición a una API en 10 minutos, aunque nunca hayas usado un cliente de API.

## ¿Qué es un cliente de API?

Cuando una app muestra datos, se los pide a una **API**: un servidor que responde con información, casi siempre en JSON. Cada pregunta es una **petición** con un **método** (`GET` para leer, `POST` para crear…) y una **URL**.

Un **cliente de API** como Sendix te deja hacer esas peticiones a mano y ver exactamente qué responde el servidor. Sirve para probar una API mientras la construyes, entender una que vas a usar o comprobar que sigue funcionando.

En esta guía usarás **JSONPlaceholder**, una API pública de prueba que cualquiera puede usar: `https://jsonplaceholder.typicode.com`.

## Paso 1. Instala Sendix

1. Descarga el instalador de [protohub.digital/sendix](https://protohub.digital/sendix/).
2. Ábrelo. Si Windows muestra un aviso azul, pulsa **Más información** y luego **Ejecutar de todas formas**. Aparece porque el instalador todavía no está firmado.
3. Sigue los pasos. No necesitas permisos de administrador ni crear una cuenta.

## Paso 2. Haz tu primera petición

Al abrir Sendix ya tienes una pestaña **Nueva petición**.

1. Deja el método en **GET**.
2. En la URL escribe:

   ```
   https://jsonplaceholder.typicode.com/users/1
   ```

3. Pulsa **Enviar** (o `Ctrl Enter`).

A la derecha aparece la respuesta:
- arriba, **200 OK**: el servidor encontró lo que pediste;
- una barra que reparte el tiempo entre conexión, espera y descarga;
- el cuerpo, que empieza así:

```json
{
  "id": 1,
  "name": "Leanne Graham",
  "username": "Bret",
  "email": "Sincere@april.biz",
  "address": {
    "city": "Gwenborough",
    …
```

## Paso 3. Lee la respuesta

En la respuesta tienes varias pestañas:

| Pestaña | Qué ves |
|---|---|
| **Cuerpo** | Lo que respondió el servidor, con colores. **Formateado** lo ordena; **Crudo** lo muestra tal cual llegó. |
| **Cabeceras** | Datos que acompañan la respuesta, como `Content-Type: application/json`. |
| **Cookies** | Las cookies que el servidor pidió guardar. |
| **Cronología** | El tiempo de cada fase y la petición exacta que salió de Sendix. |

Prueba también:

- **Plegar:** pulsa el triángulo junto a `"address"` para ocultarlo.
- **Buscar:** pulsa la lupa (o `Ctrl F` dentro del cuerpo) y escribe `Bret`.
- **Filtrar:** en el campo **JSONPath** escribe `$.address.city`. Solo queda `"Gwenborough"`.

Cambia la URL a `https://jsonplaceholder.typicode.com/users/999` y envía: verás **404 Not Found**, porque ese usuario no existe.

## Paso 4. Envía datos con POST

Leer es `GET`; para **crear** algo se usa `POST` con un **cuerpo**.

1. Cambia el método a **POST**.
2. Pon la URL `https://jsonplaceholder.typicode.com/posts`.
3. Abre la pestaña **Cuerpo**, elige **Texto o JSON** y, en el formato, **JSON**.
4. Escribe:

   ```json
   {
     "title": "Hola desde Sendix",
     "body": "Mi primera petición POST",
     "userId": 1
   }
   ```

5. Envía.

La respuesta es **201 Created** y devuelve lo que mandaste con un `"id": 101` nuevo. JSONPlaceholder no guarda nada de verdad, así que puedes repetirlo sin miedo.

Sendix añade solo la cabecera `Content-Type: application/json` porque elegiste JSON. Si el JSON tiene un error, **Formatear** no lo toca y el servidor responderá con un error.

## Paso 5. Guarda tus peticiones en una colección

Una **colección** es un grupo de peticiones guardadas. Sendix las guarda como archivos en una **carpeta de trabajo** tuya, en el mismo formato que Postman, así que puedes ponerla en git.

1. En la barra de la izquierda pulsa **Abrir carpeta…** y elige una carpeta vacía, por ejemplo `Documentos\mis-apis`.
2. Vuelve a la pestaña del `POST` y pulsa `Ctrl S`.
3. En **Guardar petición** escribe el nombre `Crear post`, elige **Nueva colección…** y llámala `JSONPlaceholder`.
4. Pulsa **Guardar**.

La colección aparece en la barra de la izquierda con tu petición. Cuando cambies algo, la pestaña muestra un punto: `Ctrl S` guarda.

## Paso 6. Usa variables y entornos

Escribir la misma dirección en cada petición es pesado. Una **variable** guarda un valor con nombre y se usa así: `{{base}}`.

1. En el rail (la columna de iconos de la izquierda) pulsa **Entornos** (las capas).
2. Pulsa **+** para crear un entorno y llámalo `Pruebas`.
3. Añade la variable `base` con el valor `https://jsonplaceholder.typicode.com` y pulsa **Guardar**.
4. Arriba a la derecha, en **Entorno**, elige **Pruebas**.
5. En tu petición cambia la URL a `{{base}}/posts` y envía.

La variable se ve resaltada en la URL; si sale en rojo es que no tiene valor en el entorno activo. Para pasar a otro servidor (por ejemplo, producción) solo cambias de entorno.

> Si una variable es una contraseña o un token, marca la casilla del **candado** en su fila. Se guarda cifrada en tu equipo y nunca se escribe en la carpeta.

## Paso 7. Comprueba la respuesta con un test

Un **test** es una comprobación automática que se ejecuta con cada respuesta.

1. En tu petición abre **Scripts** y elige **Después de la respuesta**.
2. Escribe:

   ```js
   pm.test("Se creó el post", () => {
     pm.response.to.have.status(201);
     pm.expect(pm.response.json().title).to.eql("Hola desde Sendix");
   });
   ```

3. Envía. En la respuesta, la pestaña **Tests** muestra **PASA** en verde.

Es la misma API `pm.*` de Postman, así que los tests que ya tengas funcionan igual. A la derecha del editor hay **fragmentos** listos para insertar.

Para comprobar toda la colección de una vez, abre el menú de la colección (los tres puntos) y elige **Ejecutar…**. El ejecutor envía cada petición en orden y te dice cuáles pasan y cuáles fallan.

## Más funciones, paso a paso

### Trae lo que ya tienes

Con el icono **Importar** (la flecha hacia abajo, junto a **Colecciones**) puedes abrir:

- colecciones y entornos exportados de **Postman** (v2.0 y v2.1);
- una especificación **OpenAPI** o **Swagger** (`.yaml` o `.json`): Sendix crea una petición por operación;
- una captura **HAR** del navegador: se quitan las cookies y las cabeceras `Authorization`.

¿Tienes un comando `curl`? Pégalo entero en la URL, o en **Importar → Comando cURL…**, y Sendix lo convierte en la petición, con su método, cabeceras y cuerpo.

Y al revés: el botón `>_` junto a **Guardar** copia la petición como comando `curl` para bash, cmd o PowerShell. Los secretos no se copian salvo que lo pidas.

### Ejecuta la colección con datos

En el ejecutor (**Ejecutar…**) puedes:

1. Elegir qué peticiones corren y en qué orden (casillas y flechas).
2. Poner varias **iteraciones** y un **archivo de datos** CSV o JSON: cada fila alimenta una vuelta. Una columna `email` se usa como `{{email}}`.
3. Detenerte en el primer fallo, empezar sin cookies o guardar al final las variables que dejen los scripts.

Cada ejecución queda en **Ejecuciones anteriores**, para verla, repetirla o exportarla a JSON.

### WebSocket, Socket.IO y gRPC

En el selector de método de una pestaña nueva, en el grupo **Tiempo real**, elige **WebSocket** o **Socket.IO** para abrir una conexión, o **gRPC** para llamar a un servicio gRPC. El [manual](MANUAL.md#11-websocket-y-socketio) explica cada uno.

### Ajusta Sendix a tu manera

En **Ajustes** (`Ctrl ,` o el icono de los deslizadores, abajo en el rail) eliges:
- el tema claro, oscuro o el de Windows;
- el tamaño de letra del código;
- el tiempo máximo de las peticiones;
- el proxy y los certificados si tu empresa los usa.

## Palabras que vas a ver

| Palabra | Qué es |
|---|---|
| **API** | Un servidor que responde a peticiones con datos. |
| **Endpoint / URL** | La dirección a la que haces la petición, como `/users/1`. |
| **Método** | Qué quieres hacer: `GET` leer, `POST` crear, `PUT`/`PATCH` cambiar, `DELETE` borrar. |
| **Estado** | El número de la respuesta: `2xx` bien, `4xx` error tuyo (como 404, no existe), `5xx` error del servidor. |
| **Cabecera** | Un dato extra de la petición o la respuesta, como `Content-Type` o `Authorization`. |
| **Cuerpo** | El contenido que envías o recibes, casi siempre JSON. |
| **Colección** | Un grupo de peticiones guardadas, en formato de Postman v2.1. |
| **Entorno** | Un conjunto de variables (por ejemplo, desarrollo o producción). |
| **Variable** | Un valor con nombre que se usa como `{{nombre}}`. |
| **Test** | Una comprobación automática sobre la respuesta, con `pm.test`. |

## Si algo sale mal

| Ves | Qué hacer |
|---|---|
| **No hubo respuesta** con `ENOTFOUND` | La dirección está mal escrita o no tienes internet. |
| **No hubo respuesta** con `ECONNREFUSED` | No hay nada escuchando en esa dirección y puerto: ¿está encendido tu servidor? |
| **Se agotó el tiempo de espera** | El servidor tarda demasiado. Sube el tiempo en **Ajustes** de la petición o en **Ajustes** de Sendix. |
| Un error de **certificado** | El servidor usa un certificado que tu equipo no reconoce. Si es de pruebas, pulsa **Reenviar sin verificar esta petición**; si es de tu empresa, añade su CA en **Ajustes → Red y certificados**. |
| Una variable en **rojo** | No tiene valor en el entorno activo: revisa que elegiste el entorno correcto arriba a la derecha. |
| Windows avisa al instalar | Es normal: pulsa **Más información** y **Ejecutar de todas formas**. Puedes comprobar la huella SHA-256 en la página de descarga. |

## ¿Y después?

El [manual de uso](MANUAL.md) explica cada función por tarea: autorización, scripts, el ejecutor, WebSocket, gRPC, ajustes de red y más.
