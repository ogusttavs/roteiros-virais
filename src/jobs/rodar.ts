/**
 * Roda um job uma vez, direto (sem passar pelo worker nem pela fila):
 * `npm run job -- <nome>`. `npm run job -- listar` so imprime os
 * agendamentos. Usado nos testes com chave real desta etapa.
 */
import "dotenv/config";

import { listarAgendamentos } from "./agenda";
import { rodarAnalisarVisual } from "./analisar-visual";
import { rodarColetaApify } from "./coleta-apify";
import { rodarColetaNoticias } from "./coleta-noticias";
import { rodarColetaYoutube } from "./coleta-youtube";
import { executarComRegistro } from "./execucoes";
import { rodarExtrair } from "./extrair";
import { rodarExtrairColeta } from "./extrair-coleta";
import { FILAS } from "./fila";
import { rodarModeloNicho } from "./modelo-nicho";
import { rodarPontuar } from "./pontuar";
import { rodarTranscrever } from "./transcrever";
import { rodarVigilancia } from "./vigilancia";

const TAREFAS: Record<string, () => Promise<Record<string, unknown>>> = {
  [FILAS.coletaYoutube]: rodarColetaYoutube,
  [FILAS.coletaApify]: rodarColetaApify,
  [FILAS.coletaNoticias]: rodarColetaNoticias,
  [FILAS.pontuar]: rodarPontuar,
  [FILAS.vigilancia]: rodarVigilancia,
  [FILAS.transcrever]: rodarTranscrever,
  [FILAS.extrair]: rodarExtrair,
  [FILAS.extrairColeta]: rodarExtrairColeta,
  [FILAS.analisarVisual]: rodarAnalisarVisual,
  [FILAS.modeloNicho]: rodarModeloNicho,
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
