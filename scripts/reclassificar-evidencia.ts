/**
 * Script de uma vez só (H4, item 2): reclassifica, em lote, os vídeos já extraídos antes de
 * `tipoConteudo`/`serveDeModelo` existirem (`extrairVideo`, versão 1.6.0). Sem isto, um vídeo
 * nunca reclassificado continua contando como evidência (`sql is not false` passa em null de
 * propósito, para não esvaziar a evidência de todo mundo da noite para o dia só porque o campo é
 * novo); este script é o jeito de fechar essa lacuna aos poucos, sem busca ao vivo nem reescrever
 * histórico.
 *
 * Só entra o que de fato pode virar evidência: dentro do piso de views do próprio setor
 * (`reguaDoSetor`), nos últimos 90 dias, já com análise e transcrição guardadas (mesmo filtro
 * estrutural de `condicoesEvidencia`, `servicos/pesquisa.ts`, sem o casamento por palavra-chave,
 * que não faz sentido para "reclassificar tudo que pode servir de evidência algum dia"). Vídeo
 * fora dessa faixa nunca vira evidência mesmo, reclassificar ele seria gasto sem efeito.
 *
 * Por padrão roda em modo DRY RUN: mostra quantos vídeos entrariam no lote, por setor, e o custo
 * estimado (a partir do custo médio real da tarefa `extrairVideo` já registrado em
 * `geracoes_ia`), sem gastar nada nem tocar no banco. Só envia o lote de verdade com `--confirmar`.
 *
 * NUNCA rodar `--confirmar` contra produção sem o sim explícito do Gustavo (`FLUXO.md`, "contas,
 * chaves e compras são dele"; `CLAUDE.md`, regra 14, migração e mudança de dado entre marcas
 * esperam o sim dele; mesmo espírito aqui, é gasto real de dinheiro em massa).
 *
 *   npx tsx scripts/reclassificar-evidencia.ts              # dry run, não gasta nada
 *   npx tsx scripts/reclassificar-evidencia.ts --confirmar   # envia o lote de verdade
 */
import { and, avg, count, eq, gte, isNotNull, isNull, ne } from "drizzle-orm";

import { db } from "../src/db";
import { geracoesIA, lotesIa, nichos, videos } from "../src/db/schema";
import { criarLote, type ItemLote } from "../src/ia/lote";
import * as extrairVideo from "../src/ia/prompts/extrairVideo";
import {
  DENTRO_DO_TETO_DE_DURACAO,
  incluirSeed,
  PERTENCE_AO_NICHO,
  reguaDoSetor,
} from "../src/servicos/pesquisa";

const DIA_MS = 24 * 60 * 60 * 1000;
function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * DIA_MS);
}

type Candidato = {
  id: number;
  titulo: string | null;
  transcricao: string | null;
  nomeNicho: string;
  termosNicho: string[];
  nichoId: number;
};

async function candidatosDoSetor(nichoId: number, nomeNicho: string, termosNicho: string[]): Promise<Candidato[]> {
  const regua = await reguaDoSetor(nichoId);
  const condicoes = [
    eq(videos.nichoId, nichoId),
    gte(videos.publicadoEm, diasAtras(90)),
    gte(videos.views, regua.pisoViews),
    isNotNull(videos.analise),
    isNotNull(videos.transcricao),
    isNull(videos.tipoConteudo),
    PERTENCE_AO_NICHO,
    DENTRO_DO_TETO_DE_DURACAO,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));

  const linhas = await db()
    .select({ id: videos.id, titulo: videos.titulo, transcricao: videos.transcricao })
    .from(videos)
    .where(and(...condicoes));

  return linhas.map((v) => ({ ...v, nomeNicho, termosNicho, nichoId }));
}

/** O custo médio real da tarefa, já pago em produção, é a base mais honesta de estimativa (melhor que contar tokens no escuro). */
async function custoMedioHistoricoUsd(): Promise<number | null> {
  const [linha] = await db()
    .select({ media: avg(geracoesIA.custoUsd), quantos: count() })
    .from(geracoesIA)
    .where(eq(geracoesIA.tarefa, "extrairVideo"));
  if (!linha || linha.quantos === 0 || linha.media === null) return null;
  return Number(linha.media);
}

async function main() {
  const confirmar = process.argv.includes("--confirmar");

  const todosNichos = await db().select({ id: nichos.id, nome: nichos.nome, termos: nichos.termos }).from(nichos);

  const porSetor: { nome: string; candidatos: Candidato[] }[] = [];
  for (const nicho of todosNichos) {
    const candidatos = await candidatosDoSetor(nicho.id, nicho.nome, nicho.termos ?? []);
    if (candidatos.length > 0) porSetor.push({ nome: nicho.nome, candidatos });
  }

  const total = porSetor.reduce((soma, s) => soma + s.candidatos.length, 0);
  console.log(`vídeos elegíveis a evidência, ainda sem tipoConteudo: ${total}`);
  for (const setor of porSetor) {
    console.log(`  ${setor.nome}: ${setor.candidatos.length}`);
  }

  if (total === 0) {
    console.log("\nnada para reclassificar.");
    return;
  }

  const custoMedio = await custoMedioHistoricoUsd();
  const custoPorVideoEmLote = custoMedio !== null ? custoMedio / 2 : null; // API de lote: metade do preço normal.
  console.log(
    custoPorVideoEmLote !== null
      ? `\ncusto médio real de extrairVideo (fora do lote): US$ ${custoMedio!.toFixed(5)}/vídeo`
      : "\nsem histórico de custo de extrairVideo ainda; sem base para estimar.",
  );
  if (custoPorVideoEmLote !== null) {
    console.log(`custo estimado em lote (metade do preço): US$ ${(custoPorVideoEmLote * total).toFixed(2)} no total`);
  }

  if (!confirmar) {
    console.log("\ndry run: nada foi enviado. Rode com --confirmar para enviar o lote de verdade.");
    console.log("NUNCA rodar --confirmar contra produção sem o sim explícito do Gustavo (CLAUDE.md, regra 14).");
    return;
  }

  const candidatos = porSetor.flatMap((s) => s.candidatos);
  const itens: ItemLote<extrairVideo.SaidaExtrairVideo>[] = candidatos.map((v) => ({
    customId: String(v.id),
    tarefa: "extrairVideo",
    nivel: extrairVideo.nivel,
    schema: extrairVideo.schema,
    sistemaEstavel: extrairVideo.montarSistemaEstavel(),
    entrada: extrairVideo.montarEntrada({
      titulo: v.titulo ?? "",
      transcricao: v.transcricao ?? "",
      nomeNicho: v.nomeNicho,
      termosNicho: v.termosNicho,
    }),
  }));

  const loteIdExterno = await criarLote(itens);
  await db()
    .insert(lotesIa)
    .values({
      tarefa: "extrairVideo",
      loteIdExterno,
      videoIds: candidatos.map((v) => v.id),
      status: "em_andamento",
    });

  console.log(`\nlote enviado: ${loteIdExterno} (${candidatos.length} vídeos)`);
  console.log("o job extrairColeta, já em produção, recolhe o resultado quando o lote terminar (até 24h).");
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((erro: unknown) => {
      console.error(erro);
      process.exitCode = 1;
    });
}
