/**
 * Compara duas rodadas do golden set do carrossel: `npm run avaliar:carrossel:comparar -- <antes.json> <depois.json> [--md <arquivo.md>]`.
 * Imprime as contagens lado a lado e grava o Markdown com os textos dos dois, caso a caso (padrão: `avaliacoes-saida/carrossel-comparacao-<data>.md`).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { compararEmMarkdown, compararEmTexto, type Rodada } from "./avaliar-carrossel-regras";

const args = process.argv.slice(2);
const iMd = args.indexOf("--md");
const md = iMd >= 0 ? args[iMd + 1] : undefined;
const arquivos = args.filter((a, i) => !a.startsWith("--") && !(iMd >= 0 && i === iMd + 1));
if (arquivos.length !== 2) {
  console.error("uso: npm run avaliar:carrossel:comparar -- <antes.json> <depois.json> [--md arquivo.md]");
  process.exit(1);
}
const [antes, depois] = arquivos.map((f) => JSON.parse(readFileSync(f, "utf8")) as Rodada);
console.log(compararEmTexto(antes, depois));
const destino = md ?? path.join("avaliacoes-saida", `carrossel-comparacao-${new Date().toISOString().slice(0, 10)}.md`);
mkdirSync(path.dirname(path.resolve(destino)), { recursive: true });
writeFileSync(destino, compararEmMarkdown(antes, depois));
console.log(`\ntextos lado a lado: ${destino}`);
