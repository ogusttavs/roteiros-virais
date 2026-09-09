/**
 * Roda um job uma vez, direto (sem passar pelo worker nem pela fila):
 * `npm run job -- <nome>`. `npm run job -- listar` so imprime os
 * agendamentos. Usado nos testes com chave real desta etapa.
 */
import "dotenv/config";

import { listarAgendamentos } from "./agenda";
import { rodarAnalisarVisual } from "./analisar-visual";
import { rodarColetaApify } from "./coleta-apify";
import { rodarColetaMeioDia } from "./coleta-meio-dia";
import { rodarColetaNoticias } from "./coleta-noticias";
import { rodarColetaYoutube } from "./coleta-youtube";
import { rodarContasBase } from "./contas-base";
import { rodarCurvaCliente } from "./curva-cliente";
import { rodarDescobertaInstagram } from "./descoberta-instagram";
import { executarComRegistro } from "./execucoes";
import { rodarExtrair } from "./extrair";
import { rodarExtrairColeta } from "./extrair-coleta";
import { FILAS } from "./fila";
import { rodarLembrete } from "./lembrete";
import { rodarMetaContas } from "./meta-contas";
import { rodarMetaHashtags } from "./meta-hashtags";
import { rodarModeloNicho } from "./modelo-nicho";
import { rodarPontuar } from "./pontuar";
import { rodarTemasDoDia } from "./temas-do-dia";
import { rodarTranscrever } from "./transcrever";
import { rodarVigilancia } from "./vigilancia";

/**
 * Toda entrada embrulhada numa arrow function, mesmo as que ignoram o
 * argumento (ajuste 1 da revisão do PR #36): `executarComRegistro` chama
 * `tarefa(execucao.id)`, e uma referência direta a uma função com
 * `nichoId?: number` como primeiro parâmetro (`rodarColetaYoutube`,
 * `rodarColetaNoticias`, `rodarMetaContas`, `rodarMetaHashtags`,
 * `rodarDescobertaInstagram`) recebia o id da execução ali, filtrava por um
 * nicho que não existe e terminava "ok" sem processar nada; o `typecheck`
 * não pega porque uma função com menos parâmetros é atribuível a um tipo
 * com mais. Só `rodarColetaApify` e `rodarColetaMeioDia` de fato usam o id.
 * Exportada para o teste (`rodar.test.ts`) chamar cada entrada direto.
 */
export const TAREFAS: Record<string, (execucaoId: number) => Promise<Record<string, unknown>>> = {
  [FILAS.coletaYoutube]: () => rodarColetaYoutube(),
  [FILAS.coletaApify]: (execucaoId) => rodarColetaApify(undefined, execucaoId),
  [FILAS.coletaMeioDia]: (execucaoId) => rodarColetaMeioDia(execucaoId),
  [FILAS.coletaNoticias]: () => rodarColetaNoticias(),
  [FILAS.contasBase]: () => rodarContasBase(),
  [FILAS.metaContas]: () => rodarMetaContas(),
  [FILAS.metaHashtags]: () => rodarMetaHashtags(),
  [FILAS.descobertaInstagram]: () => rodarDescobertaInstagram(),
  [FILAS.pontuar]: () => rodarPontuar(),
  [FILAS.vigilancia]: () => rodarVigilancia(),
  [FILAS.transcrever]: () => rodarTranscrever(),
  [FILAS.extrair]: () => rodarExtrair(),
  [FILAS.extrairColeta]: () => rodarExtrairColeta(),
  [FILAS.analisarVisual]: () => rodarAnalisarVisual(),
  [FILAS.modeloNicho]: () => rodarModeloNicho(),
  [FILAS.temasDoDia]: () => rodarTemasDoDia(),
  [FILAS.lembrete]: () => rodarLembrete(),
  [FILAS.curvaCliente]: () => rodarCurvaCliente(),
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

/**
 * So dispara ao rodar `tsx src/jobs/rodar.ts` direto (`npm run job`), nunca
 * quando `rodar.test.ts` importa `TAREFAS` (mesmo raciocinio de
 * `scripts/avaliar-briefing.ts`, "require.main e o script que foi chamado
 * na linha de comando").
 */
if (require.main === module) {
  main().catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  });
}
