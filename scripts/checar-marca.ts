/**
 * Ponto de entrada de linha de comando (npm run checar-marca). As regras estão em checar-marca-regras.ts, sem process.exit, para dar para testar.
 */
import { listarArquivos, verificarArquivo } from "./checar-marca-regras";

const arquivos = listarArquivos();
const problemas = arquivos.flatMap(verificarArquivo);

if (problemas.length === 0) {
  console.log(`checar-marca: ${arquivos.length} arquivo(s) de src/ verificado(s), nenhuma marca da empresa.`);
  process.exit(0);
}

console.error(`checar-marca: ${problemas.length} problema(s) encontrado(s):\n`);
for (const p of problemas) {
  console.error(`  ${p.arquivo}:${p.linha} - ${p.motivo}`);
}
process.exit(1);
