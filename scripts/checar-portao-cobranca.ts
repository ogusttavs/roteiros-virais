/**
 * Ponto de entrada de linha de comando (npm run checar-portao-cobranca). As regras estão em checar-portao-cobranca-regras.ts, sem process.exit, para dar para testar.
 */
import { verificarTudo } from "./checar-portao-cobranca-regras";

const { problemas, acoes, rotas } = verificarTudo();

if (problemas.length === 0) {
  console.log(`checar-portao-cobranca: ${acoes} arquivo(s) verificado(s) e ${rotas} rota(s) /api, nenhum problema.`);
  process.exit(0);
}

console.error(`checar-portao-cobranca: ${problemas.length} problema(s) encontrado(s):\n`);
for (const p of problemas) {
  console.error(`  ${p.arquivo}:${p.linha} - ${p.motivo}`);
}
process.exit(1);
