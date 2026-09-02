/**
 * Ponto de entrada de linha de comando (npm run checar-texto). As regras estao
 * em checar-texto-regras.ts, sem process.exit, para dar para testar.
 */
import { listarArquivos, verificarArquivo } from "./checar-texto-regras";

const arquivos = listarArquivos();
const problemas = arquivos.flatMap(verificarArquivo);

if (problemas.length === 0) {
  console.log(`checar-texto: ${arquivos.length} arquivo(s) verificado(s), nenhum problema.`);
  process.exit(0);
}

console.error(`checar-texto: ${problemas.length} problema(s) encontrado(s):\n`);
for (const p of problemas) {
  console.error(`  ${p.arquivo}:${p.linha} - ${p.motivo}`);
}
process.exit(1);
