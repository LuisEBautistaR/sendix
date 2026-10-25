/** Autocompletion for the script editor: the pm API Sendix supports, and variable names inside get/set calls. */
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";

const API: Array<[string, string, string?]> = [
  ["pm.test", 'pm.test("nombre", () => {\n  \n});', "Define un test"],
  ["pm.expect", "pm.expect()", "Aserción (Chai)"],
  ["pm.response.code", "pm.response.code", "Código de estado"],
  ["pm.response.status", "pm.response.status", "Texto del estado"],
  ["pm.response.json", "pm.response.json()", "Cuerpo como JSON"],
  ["pm.response.text", "pm.response.text()", "Cuerpo como texto"],
  ["pm.response.responseTime", "pm.response.responseTime", "Tiempo en ms"],
  ["pm.response.headers.get", 'pm.response.headers.get("")', "Cabecera de la respuesta"],
  ["pm.response.to.have.status", "pm.response.to.have.status(200)", "Aserción de estado"],
  ["pm.response.to.have.header", 'pm.response.to.have.header("")', "Aserción de cabecera"],
  ["pm.response.to.have.jsonBody", "pm.response.to.have.jsonBody()", "Aserción de cuerpo JSON"],
  ["pm.environment.get", 'pm.environment.get("")', "Variable del entorno"],
  ["pm.environment.set", 'pm.environment.set("", )', "Guarda en el entorno (sesión)"],
  ["pm.environment.unset", 'pm.environment.unset("")', "Quita del entorno (sesión)"],
  ["pm.collectionVariables.get", 'pm.collectionVariables.get("")', "Variable de la colección"],
  ["pm.collectionVariables.set", 'pm.collectionVariables.set("", )', "Guarda en la colección (sesión)"],
  ["pm.collectionVariables.unset", 'pm.collectionVariables.unset("")', "Quita de la colección (sesión)"],
  ["pm.variables.get", 'pm.variables.get("")', "Variable con prioridad de ámbitos"],
  ["pm.variables.set", 'pm.variables.set("", )', "Variable local de esta ejecución"],
  ["pm.globals.get", 'pm.globals.get("")', "Variable global"],
  ["pm.iterationData.get", 'pm.iterationData.get("")', "Columna del archivo de datos"],
  ["pm.request.url", "pm.request.url", "URL de la petición"],
  ["pm.request.method", "pm.request.method", "Método"],
  ["pm.request.headers.add", 'pm.request.headers.add({ key: "", value: "" })', "Añade una cabecera"],
  ["pm.request.headers.upsert", 'pm.request.headers.upsert({ key: "", value: "" })', "Añade o reemplaza una cabecera"],
  ["pm.request.body", "pm.request.body", "Cuerpo de la petición"],
  ["pm.info.requestName", "pm.info.requestName", "Nombre de la petición"],
  ["pm.info.iteration", "pm.info.iteration", "Iteración actual (desde 0)"],
  ["pm.cookies.get", 'pm.cookies.get("")', "Cookie de la respuesta"],
  ["pm.sendRequest", "pm.sendRequest(url, (err, res) => {\n  \n});", "Envía otra petición"],
  ["console.log", "console.log()", "Escribe en la consola"],
  ["console.warn", "console.warn()"],
  ["console.error", "console.error()"],
];

const OPTIONS: Completion[] = API.map(([label, apply, detail]) => ({ label, apply, type: "function", ...(detail ? { detail } : {}) }));

/** Snippets for the side list of the Scripts panel. */
export const SNIPPETS: Array<{ label: string; phase: "prerequest" | "test"; code: string }> = [
  { label: "Estado 200", phase: "test", code: 'pm.test("El estado es 200", () => {\n  pm.response.to.have.status(200);\n});' },
  { label: "Tiempo menor a 500 ms", phase: "test", code: 'pm.test("Responde en menos de 500 ms", () => {\n  pm.expect(pm.response.responseTime).to.be.below(500);\n});' },
  { label: "El cuerpo es JSON", phase: "test", code: 'pm.test("El cuerpo es JSON", () => {\n  pm.response.to.have.jsonBody();\n});' },
  { label: "Propiedad en el JSON", phase: "test", code: 'pm.test("Tiene la propiedad id", () => {\n  pm.expect(pm.response.json()).to.have.property("id");\n});' },
  { label: "Guardar un valor del JSON", phase: "test", code: 'pm.environment.set("token", pm.response.json().token);' },
  { label: "Cabecera presente", phase: "test", code: 'pm.test("Tiene Content-Type", () => {\n  pm.response.to.have.header("Content-Type");\n});' },
  { label: "Marca de tiempo", phase: "prerequest", code: 'pm.variables.set("ahora", new Date().toISOString());' },
  { label: "Añadir cabecera", phase: "prerequest", code: 'pm.request.headers.upsert({ key: "X-Request-Id", value: crypto.randomUUID() });' },
  { label: "Registrar la URL", phase: "prerequest", code: "console.log(pm.request.method, pm.request.url.toString());" },
];

export function pmCompletions(variables: () => string[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const inString = ctx.matchBefore(/pm\.(environment|collectionVariables|variables|globals)\.(get|set|unset)\(\s*["'][\w.-]*/);
    if (inString) {
      const quote = inString.text.search(/["']/);
      return { from: inString.from + quote + 1, options: variables().map((v) => ({ label: v, type: "variable" })), validFor: /^[\w.-]*$/ };
    }
    const word = ctx.matchBefore(/[\w$.]+/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    if (!/^(p|pm|c|co|con|cons|conso|consol|console)(\.|$)/.test(word.text) && !ctx.explicit) return null;
    return { from: word.from, options: OPTIONS, validFor: /^[\w$.]*$/ };
  };
}
