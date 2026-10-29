/**
 * Job `limpar-edicoes` (E47 PR 2): de hora em hora, cuida da guarda dos vídeos da edição. Decisão do Gustavo em 29/10/2026: o vídeo bruto sai sozinho em 48 horas e o editado em 7 dias. O que
 * este job faz, nesta ordem:
 *
 *  1. Falha o envio que parou (a edição ficou `subindo` por mais de 45 minutos: o celular dormiu, a aba fechou).
 *  2. Devolve a `guardado` (ou falha, se já foram 3 tentativas) a transcrição que parou no meio (o worker caiu).
 *  3. Apaga o bruto que passou de `bruto_expira_em` e o editado que passou de `editado_expira_em`. Junto com o bruto saem as palavras e a curva de energia (são a fala da pessoa). Quando não sobra
 *     nenhum arquivo, a edição passa a `expirada`; a linha fica, para a cota do mês e o histórico.
 *  4. Enfileira de novo a transcrição que a fila perdeu (edição `guardado` há mais de 10 minutos) e a decisão da edição (E47 PR 3: `transcrito` ou `decidido` há mais de 10 minutos, até 3 rodadas);
 *     a decisão que parou no meio (`decidindo` há mais de 20 minutos) volta ao passo anterior ou, na terceira rodada, falha. O plano e a decisão saem junto com o último arquivo (têm a fala da pessoa).
 *  4c. (E47 PR 4) O render: o que está sendo montado sem sinal há 40 minutos volta para a vez (ou falha na terceira tentativa) e o que espera a vez há mais de 10 minutos é enfileirado de novo. Junto
 *     com o bruto sai a prévia (só serve com o bruto por perto).
 *  5. Varre o volume: arquivo cujo nome não está em nenhuma linha viva (a linha foi apagada, o arquivo já tinha sido dado como apagado, o processo caiu antes de gravar o caminho) e `.parte` de
 *     envio que morreu. Assim nunca sobra arquivo órfão.
 *
 * O resumo (que a tela de rotinas do admin mostra) tem só números.
 */
import { and, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";

import {
  DECISAO_ESQUECIDA_APOS_MS,
  DECISAO_PARADA_APOS_MS,
  ENVIO_DA_EDICAO_PARADO_APOS_MS,
  PARTE_VELHA_APOS_MS,
  RENDER_ESQUECIDO_APOS_MS,
  RENDER_PARADO_APOS_MS,
  TENTATIVAS_DA_DECISAO,
  TENTATIVAS_DO_RENDER,
  TENTATIVAS_DA_TRANSCRICAO,
  TRANSCRICAO_ESQUECIDA_APOS_MS,
  TRANSCRICAO_PARADA_APOS_MS,
} from "@/config/edicao";
import { db } from "@/db";
import { edicoes } from "@/db/schema";
import { apagarArquivoDaEdicao, varrerSobrasDoVolume } from "@/edicao/arquivos";
import type { PerfilDeRender } from "@/edicao/render-grafo";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { logger } from "@/lib/log";
import { enfileirarRender, ESTADOS_DO_RENDER } from "@/servicos/render-edicao";
import { fraseDaEdicao } from "@/textos/edicao";

/** Um arquivo sem dono só é apagado depois de tanto tempo: o que acabou de ser renomeado ainda não teve o caminho gravado na linha. */
export const IDADE_MINIMA_DO_ORFAO_MS = 10 * 60 * 1000;

export type DepsDaLimpeza = {
  agora?: () => Date;
  enfileirar?: (edicaoId: number) => Promise<void>;
  /** Quem enfileira a decisão da edição que ficou parada (o padrão põe na fila `decidir-edicao`). */
  enfileirarDecisao?: (edicaoId: number) => Promise<void>;
  /** E47 PR 4: quem enfileira o render da prévia ou do final que ficou parado (o padrão põe na fila `renderizar-edicao`). */
  enfileirarRender?: (edicaoId: number, perfil: PerfilDeRender, emSegundos: number) => Promise<void>;
};

async function enfileirarTranscricao(edicaoId: number): Promise<void> {
  await garantirBossPronto();
  await boss().send(FILAS.transcreverEdicao, { edicaoId }, { singletonKey: `edicao-${edicaoId}` });
}

async function enfileirarDecisao(edicaoId: number): Promise<void> {
  await garantirBossPronto();
  await boss().send(FILAS.decidirEdicao, { edicaoId }, { singletonKey: `decisao-${edicaoId}` });
}

export async function rodarLimparEdicoes(deps: DepsDaLimpeza = {}): Promise<Record<string, unknown>> {
  const agora = deps.agora ? deps.agora() : new Date();
  const antes = (ms: number) => new Date(agora.getTime() - ms);

  // 1. O envio que parou.
  const enviosParados = await db()
    .update(edicoes)
    .set({ estado: "falhou", motivo: fraseDaEdicao("envio-parado"), atualizadaEm: agora })
    .where(and(eq(edicoes.estado, "subindo"), lt(edicoes.atualizadaEm, antes(ENVIO_DA_EDICAO_PARADO_APOS_MS))))
    .returning({ id: edicoes.id });

  // 2. A transcrição que parou no meio.
  const paradas = await db()
    .select({ id: edicoes.id, tentativas: edicoes.tentativas, caminhoBruto: edicoes.caminhoBruto })
    .from(edicoes)
    .where(and(eq(edicoes.estado, "transcrevendo"), lt(edicoes.atualizadaEm, antes(TRANSCRICAO_PARADA_APOS_MS))));
  let transcricoesDevolvidas = 0;
  let transcricoesDesistidas = 0;
  for (const parada of paradas) {
    if (parada.tentativas < TENTATIVAS_DA_TRANSCRICAO) {
      await db().update(edicoes).set({ estado: "guardado", atualizadaEm: agora }).where(and(eq(edicoes.id, parada.id), eq(edicoes.estado, "transcrevendo")));
      transcricoesDevolvidas += 1;
    } else {
      await apagarArquivoDaEdicao(parada.caminhoBruto);
      await db()
        .update(edicoes)
        .set({ estado: "falhou", motivo: fraseDaEdicao("demorou"), caminhoBruto: null, brutoApagadoEm: agora, atualizadaEm: agora })
        .where(and(eq(edicoes.id, parada.id), eq(edicoes.estado, "transcrevendo")));
      transcricoesDesistidas += 1;
    }
  }

  // 2b. A decisão que parou no meio (E47 PR 3): volta ao passo anterior (`decidido`, se o plano já estava guardado; senão `transcrito`) ou, na terceira rodada, falha.
  const decisoesParadas = await db()
    .select({ id: edicoes.id, tentativas: edicoes.tentativasDaDecisao, caminhoBruto: edicoes.caminhoBruto })
    .from(edicoes)
    .where(and(eq(edicoes.estado, "decidindo"), lt(edicoes.atualizadaEm, antes(DECISAO_PARADA_APOS_MS))));
  let decisoesDevolvidas = 0;
  let decisoesDesistidas = 0;
  for (const parada of decisoesParadas) {
    if (parada.tentativas < TENTATIVAS_DA_DECISAO) {
      await db()
        .update(edicoes)
        .set({ estado: sql`case when ${edicoes.resultado} is not null then 'decidido' else 'transcrito' end`, atualizadaEm: agora })
        .where(and(eq(edicoes.id, parada.id), eq(edicoes.estado, "decidindo")));
      decisoesDevolvidas += 1;
    } else {
      await apagarArquivoDaEdicao(parada.caminhoBruto);
      await db()
        .update(edicoes)
        .set({ estado: "falhou", motivo: fraseDaEdicao("nao-montou"), caminhoBruto: null, brutoApagadoEm: agora, palavras: null, energia: null, decisao: null, resultado: null, atualizadaEm: agora })
        .where(and(eq(edicoes.id, parada.id), eq(edicoes.estado, "decidindo")));
      decisoesDesistidas += 1;
    }
  }

  // 3. A guarda: o bruto em 48 horas e o editado em 7 dias.
  const brutosVencidos = await db()
    .select({ id: edicoes.id, caminhoBruto: edicoes.caminhoBruto, caminhoPrevia: edicoes.caminhoPrevia })
    .from(edicoes)
    .where(and(isNull(edicoes.brutoApagadoEm), isNotNull(edicoes.brutoExpiraEm), lte(edicoes.brutoExpiraEm, agora)));
  for (const vencido of brutosVencidos) {
    await apagarArquivoDaEdicao(vencido.caminhoBruto);
    // A prévia só serve enquanto o bruto existe (aprovar e refazer precisam dele): sai junto.
    await apagarArquivoDaEdicao(vencido.caminhoPrevia);
    await db()
      .update(edicoes)
      .set({ caminhoBruto: null, caminhoPrevia: null, brutoApagadoEm: agora, palavras: null, energia: null, pedidosDeAjuste: null, progressoDoRender: null })
      .where(eq(edicoes.id, vencido.id));
  }
  const editadosVencidos = await db()
    .select({ id: edicoes.id, caminhoEditado: edicoes.caminhoEditado })
    .from(edicoes)
    .where(and(isNull(edicoes.editadoApagadoEm), isNotNull(edicoes.editadoExpiraEm), lte(edicoes.editadoExpiraEm, agora)));
  for (const vencido of editadosVencidos) {
    await apagarArquivoDaEdicao(vencido.caminhoEditado);
    await db().update(edicoes).set({ caminhoEditado: null, editadoApagadoEm: agora, resultado: null, decisao: null }).where(eq(edicoes.id, vencido.id));
  }
  // Sem nenhum arquivo e com o bruto já apagado pela guarda: a edição acabou.
  const expiradas = await db()
    .update(edicoes)
    .set({ estado: "expirada", decisao: null, resultado: null, atualizadaEm: agora })
    .where(
      and(
        inArray(edicoes.estado, ["guardado", "transcrevendo", "transcrito", "decidindo", "decidido", "verificado", "montando_previa", "previa_pronta", "aprovada", "montando_final", "pronta", "para_revisao"]),
        isNotNull(edicoes.brutoApagadoEm),
        isNull(edicoes.caminhoBruto),
        isNull(edicoes.caminhoEditado),
      ),
    )
    .returning({ id: edicoes.id });

  // 4. A transcrição que a fila perdeu.
  const esquecidas = await db()
    .select({ id: edicoes.id })
    .from(edicoes)
    .where(and(eq(edicoes.estado, "guardado"), lt(edicoes.atualizadaEm, antes(TRANSCRICAO_ESQUECIDA_APOS_MS)), lt(edicoes.tentativas, TENTATIVAS_DA_TRANSCRICAO)));
  let reenfileiradas = 0;
  for (const esquecida of esquecidas) {
    try {
      await (deps.enfileirar ?? enfileirarTranscricao)(esquecida.id);
      reenfileiradas += 1;
    } catch (erro) {
      logger.warn({ err: erro, edicaoId: esquecida.id }, "edicao: nao foi possivel enfileirar a transcricao esquecida");
    }
  }

  // 4b. A decisão que a fila perdeu, ou que parou porque a IA estava fora do ar (E47 PR 3): `transcrito` ou `decidido` há mais de 10 minutos.
  const decisoesEsquecidas = await db()
    .select({ id: edicoes.id })
    .from(edicoes)
    .where(and(inArray(edicoes.estado, ["transcrito", "decidido"]), lt(edicoes.atualizadaEm, antes(DECISAO_ESQUECIDA_APOS_MS)), lt(edicoes.tentativasDaDecisao, TENTATIVAS_DA_DECISAO)));
  let decisoesReenfileiradas = 0;
  for (const esquecida of decisoesEsquecidas) {
    try {
      await (deps.enfileirarDecisao ?? enfileirarDecisao)(esquecida.id);
      decisoesReenfileiradas += 1;
    } catch (erro) {
      logger.warn({ err: erro, edicaoId: esquecida.id }, "edicao: nao foi possivel enfileirar a decisao esquecida");
    }
  }

  // 4c. O render (E47 PR 4). O que está sendo montado sem sinal há muito tempo (o contêiner de render caiu) volta para a vez ou, na terceira tentativa perdida, falha; o que espera a vez e a
  // fila perdeu é enfileirado de novo.
  let rendersDevolvidos = 0;
  let rendersDesistidos = 0;
  let rendersReenfileirados = 0;
  for (const perfil of ["previa", "final"] as const) {
    const { espera, montando } = ESTADOS_DO_RENDER[perfil];
    const paradas = await db()
      .select({ id: edicoes.id, tentativas: edicoes.tentativasDoRender, caminhoBruto: edicoes.caminhoBruto, caminhoPrevia: edicoes.caminhoPrevia })
      .from(edicoes)
      .where(and(eq(edicoes.estado, montando), lt(edicoes.atualizadaEm, antes(RENDER_PARADO_APOS_MS))));
    for (const parada of paradas) {
      if (parada.tentativas < TENTATIVAS_DO_RENDER) {
        await db()
          .update(edicoes)
          .set({ estado: espera, progressoDoRender: null, atualizadaEm: agora })
          .where(and(eq(edicoes.id, parada.id), eq(edicoes.estado, montando)));
        rendersDevolvidos += 1;
      } else {
        await apagarArquivoDaEdicao(parada.caminhoBruto);
        await apagarArquivoDaEdicao(parada.caminhoPrevia);
        await db()
          .update(edicoes)
          .set({
            estado: "falhou",
            motivo: fraseDaEdicao("nao-montou"),
            caminhoBruto: null,
            caminhoPrevia: null,
            brutoApagadoEm: agora,
            palavras: null,
            energia: null,
            decisao: null,
            resultado: null,
            pedidosDeAjuste: null,
            progressoDoRender: null,
            atualizadaEm: agora,
          })
          .where(and(eq(edicoes.id, parada.id), eq(edicoes.estado, montando)));
        rendersDesistidos += 1;
      }
    }
    const esquecidas = await db()
      .select({ id: edicoes.id, tentativas: edicoes.tentativasDoRender })
      .from(edicoes)
      .where(and(eq(edicoes.estado, espera), lt(edicoes.atualizadaEm, antes(RENDER_ESQUECIDO_APOS_MS)), lt(edicoes.tentativasDoRender, TENTATIVAS_DO_RENDER)));
    for (const esquecida of esquecidas) {
      try {
        await (deps.enfileirarRender ?? ((id, p, s) => enfileirarRender(id, p, s, esquecida.tentativas)))(esquecida.id, perfil, 0);
        rendersReenfileirados += 1;
      } catch (erro) {
        logger.warn({ err: erro, edicaoId: esquecida.id }, "edicao: nao foi possivel enfileirar o render esquecido");
      }
    }
  }

  // 5. O que ficou no volume sem dono.
  const comArquivo = await db()
    .select({ bruto: edicoes.caminhoBruto, editado: edicoes.caminhoEditado, previa: edicoes.caminhoPrevia })
    .from(edicoes)
    .where(or(isNotNull(edicoes.caminhoBruto), isNotNull(edicoes.caminhoEditado), isNotNull(edicoes.caminhoPrevia)));
  const nomesComDono = new Set<string>();
  for (const linha of comArquivo) {
    if (linha.bruto) nomesComDono.add(linha.bruto);
    if (linha.editado) nomesComDono.add(linha.editado);
    if (linha.previa) nomesComDono.add(linha.previa);
  }
  const sobras = await varrerSobrasDoVolume(nomesComDono, agora, IDADE_MINIMA_DO_ORFAO_MS, PARTE_VELHA_APOS_MS);

  return {
    enviosParados: enviosParados.length,
    transcricoesDevolvidas,
    transcricoesDesistidas,
    decisoesDevolvidas,
    decisoesDesistidas,
    decisoesReenfileiradas,
    rendersDevolvidos,
    rendersDesistidos,
    rendersReenfileirados,
    brutosApagados: brutosVencidos.length,
    editadosApagados: editadosVencidos.length,
    expiradas: expiradas.length,
    reenfileiradas,
    arquivosSemDono: sobras.orfaos,
    partesVelhas: sobras.partes,
  };
}
