/**
 * Ponto de entrada de linha de comando (npm run checar-ver-como). As regras estão em checar-ver-como-regras.ts, sem process.exit, para dar para testar.
 */
import { listarArquivos, verificarArquivo } from "./checar-ver-como-regras";

const arquivos = listarArquivos();
const problemas = arquivos.flatMap(verificarArquivo);

if (problemas.length === 0) {
  console.log(`checar-ver-como: ${arquivos.length} arquivo(s) de Server Actions verificado(s), nenhum problema.`);
  process.exit(0);
}

console.error(`checar-ver-como: ${problemas.length} problema(s) encontrado(s):\n`);
for (const p of problemas) {
  console.error(`  ${p.arquivo}:${p.linha} - ${p.motivo}`);
}
process.exit(1);
