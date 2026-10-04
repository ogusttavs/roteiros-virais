/**
 * Script de uma vez só (E44 PR 1): classifica o FORMATO (as treze chaves do estudo mais os valores que nunca servem de modelo, `config/formatos.ts`) dos vídeos já
 * analisados antes de `videos.formato_catalogo` existir (`extrairVideo`, versão 1.11.0). Mesmo caminho de `reclassificar-evidencia.ts` (H4): o lote reextrai a ficha
 * com o prompt novo e o job `extrairColeta` grava tudo, inclusive o formato, quando o lote termina. Vídeo sem `formato_catalogo` continua passando pelo corte da H4
 * até aqui (`condicaoDeFormato`, `servicos/pesquisa.ts`: nulo passa), então rodar isto aos poucos nunca esvazia a evidência de ninguém.
 *
 * Só entra o que de fato pode virar evidência: dentro do piso de views do próprio setor, nos últimos 90 dias, com análise e transcrição guardadas (mesmo filtro de
 * `reclassificar-evidencia.ts`). Vídeo sem fala não entra (a análise dele é de quadros; o `extrair-sem-fala.ts` já grava o formato na hora).
 *
 * Por padrão roda em DRY RUN: mostra quantos vídeos entrariam no lote, por setor, e o custo estimado (a partir do custo médio real da tarefa `extrairVideo` em
 * `geracoes_ia`, em lote a metade), sem gastar nada nem tocar no banco. Só envia o lote com `--confirmar`.
 *
 * NUNCA rodar `--confirmar` contra produção sem o sim explícito do Gustavo (`CLAUDE.md`, regra 14: é gasto real de dinheiro em massa; a ordem da E44 PR 1 estimou
 * uns US$ 1,50 para uns 1.450 vídeos).
 *
 *   npx tsx scripts/reclassificar-formato.ts              # dry run, não gasta nada
 *   npx tsx scripts/reclassificar-formato.ts --confirmar   # envia o lote de verdade
 */
import { and, avg, count, eq, gte, isNotNull, isNull, ne, sql } from "drizzle-orm";

import { db } from "../src/db";
import { contas, geracoesIA, lotesIa, nichos, videos } from "../src/db/schema";
import { criarLote, type ItemLote } from "../src/ia/lote";
import * as extrairVideo from "../src/ia/prompts/extrairVideo";
import { TAMANHO_MINIMO_TRANSCRICAO } from "../src/jobs/extracao-comum";
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
  descricao: string | null;
  handle: string | null;
  transcricao: string | null;
  nomeNicho: string;
  termosNicho: string[];
  nichoId: number;
};

/** Exportada só para o teste de integração conferir o filtro e o custo sem rodar o lote. */
export async function candidatosDoSetor(nichoId: number, nomeNicho: string, termosNicho: string[]): Promise<Candidato[]> {
  const regua = await reguaDoSetor(nichoId);
  const condicoes = [
    eq(videos.nichoId, nichoId),
    gte(videos.publicadoEm, diasAtras(90)),
    gte(videos.views, regua.pisoViews),
    isNotNull(videos.analise),
    isNotNull(videos.transcricao),
    // Este script usa `extrairVideo`, que lê a transcrição; vídeo do caminho sem fala (`semFala = true`, `extrair-sem-fala.ts`, que já grava o formato na hora) ou com
    // transcrição curta demais (mesmo piso de `extracao-comum.ts`) não passa por aqui.
    sql`${videos.semFala} is not true`,
    sql`char_length(trim(${videos.transcricao})) >= ${TAMANHO_MINIMO_TRANSCRICAO}`,
    isNull(videos.formatoCatalogo),
    PERTENCE_AO_NICHO,
    DENTRO_DO_TETO_DE_DURACAO,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));

  const linhas = await db()
    .select({ id: videos.id, titulo: videos.titulo, descricao: videos.descricao, handle: contas.handle, transcricao: videos.transcricao })
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
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

export type Plano = {
  total: number;
  porSetor: { nome: string; candidatos: Candidato[] }[];
  /** O custo médio real de `extrairVideo` fora do lote, ou nulo sem histórico. */
  custoMedioUsd: number | null;
  /** O custo estimado em lote (metade do preço), ou nulo sem histórico. */
  custoEstimadoUsd: number | null;
  /** Quantos vídeos já estão num lote em andamento (ficam de fora do plano). */
  jaEmLote: number;
};

/** O que o dry run mostra, sem gastar nada: quantos vídeos entram, por setor, e o custo estimado. Exportada para o teste de integração. */
export async function planejarReclassificacao(): Promise<Plano> {
  const todosNichos = await db().select({ id: nichos.id, nome: nichos.nome, termos: nichos.termos }).from(nichos);
  const porSetor: { nome: string; candidatos: Candidato[] }[] = [];
  for (const nicho of todosNichos) {
    const candidatos = await candidatosDoSetor(nicho.id, nicho.nome, nicho.termos ?? []);
    if (candidatos.length > 0) porSetor.push({ nome: nicho.nome, candidatos });
  }
  // Vídeo que já está num lote em andamento (enviado e ainda não recolhido, até 24 h) não entra de novo: rodar `--confirmar` duas vezes seguidas gastaria em dobro.
  const emAndamento = new Set<number>();
  const lotes = await db().select({ videoIds: lotesIa.videoIds }).from(lotesIa).where(and(eq(lotesIa.tarefa, "extrairVideo"), eq(lotesIa.status, "em_andamento")));
  for (const lote of lotes) for (const id of lote.videoIds ?? []) emAndamento.add(id);
  if (emAndamento.size > 0) {
    for (const setor of porSetor) setor.candidatos = setor.candidatos.filter((c) => !emAndamento.has(c.id));
  }
  const total = porSetor.reduce((soma, s) => soma + s.candidatos.length, 0);
  const custoMedioUsd = await custoMedioHistoricoUsd();
  // API de lote: metade do preço normal.
  const custoEstimadoUsd = custoMedioUsd !== null ? (custoMedioUsd / 2) * total : null;
  return { total, porSetor: porSetor.filter((s) => s.candidatos.length > 0), custoMedioUsd, custoEstimadoUsd, jaEmLote: emAndamento.size };
}

async function main() {
  const confirmar = process.argv.includes("--confirmar");
  const { total, porSetor, custoMedioUsd, custoEstimadoUsd, jaEmLote } = await planejarReclassificacao();

  console.log(`vídeos elegíveis a evidência, ainda sem formato_catalogo: ${total}${jaEmLote > 0 ? ` (fora ${jaEmLote} que já estão num lote em andamento)` : ""}`);
  for (const setor of porSetor) {
    console.log(`  ${setor.nome}: ${setor.candidatos.length}`);
  }

  if (total === 0) {
    console.log("\nnada para reclassificar.");
    return;
  }

  console.log(
    custoMedioUsd !== null
      ? `\ncusto médio real de extrairVideo (fora do lote): US$ ${custoMedioUsd.toFixed(5)}/vídeo`
      : "\nsem histórico de custo de extrairVideo ainda; sem base para estimar.",
  );
  if (custoEstimadoUsd !== null) {
    console.log(`custo estimado em lote (metade do preço): US$ ${custoEstimadoUsd.toFixed(2)} no total`);
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
      descricao: v.descricao,
      handle: v.handle,
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
