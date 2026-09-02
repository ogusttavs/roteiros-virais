/**
 * Roda um job uma vez, direto (sem passar pelo worker nem pela fila):
 * `npm run job -- <nome>`. `npm run job -- listar` so imprime os
 * agendamentos. Usado nos testes com chave real desta etapa.
 */
import "dotenv/config";

import { listarAgendamentos } from "./agenda";
import { rodarColetaApify } from "./coleta-apify";
import { rodarColetaNoticias } from "./coleta-noticias";
import { rodarColetaYoutube } from "./coleta-youtube";
import { executarComRegistro } from "./execucoes";
import { FILAS } from "./fila";

const TAREFAS: Record<string, () => Promise<Record<string, unknown>>> = {
  [FILAS.coletaYoutube]: rodarColetaYoutube,
  [FILAS.coletaApify]: rodarColetaApify,
  [FILAS.coletaNoticias]: rodarColetaNoticias,
};

async function main(): Promise<void> {
  const nome = process.argv[2];

  if (!nome || nome === "listar") {
    console.log(listarAgendamentos());
    return;
  }

  const tarefa = TAREFAS[nome];
  if (!tarefa) {
    console.error(`job desconhecido: "${nome}". Use um de: ${Object.keys(TAREFAS).join(", ")}, ou "listar".`);
    process.exitCode = 1;
    return;
  }

  const resultado = await executarComRegistro(nome, tarefa);
  if (resultado.status === "erro") {
    console.error(`${nome} terminou com erro: ${resultado.erro}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${nome} rodou:`, JSON.stringify(resultado.resumo, null, 2));
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
