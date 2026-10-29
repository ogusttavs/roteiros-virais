/**
 * E47 PR 4: o render da edição. Depois que o plano de corte está pronto (`verificado`), o contêiner de render (`roteiros-render`, um vídeo por vez) monta a PRÉVIA 540p; a pessoa assiste e
 * aprova (`aprovada`), e só então monta o vídeo FINAL 1080p. O processador só gasta com o que vai ser usado.
 *
 * O caminho de uma rodada: reserva a edição (um UPDATE condicional: `verificado` para `montando_previa`, ou `aprovada` para `montando_final`, contando a tentativa) -> confere que o bruto e o plano
 * ainda existem -> o ffmpeg escreve num arquivo `.parte` do volume (andamento no banco a cada poucos segundos) -> o arquivo vira `previa/ed-<id>.mp4` ou `editado/ed-<id>.mp4` por `rename`.
 * No final, o bruto e a prévia saem na hora (a pessoa já aprovou) e o editado ganha 7 dias de guarda.
 *
 * Quando o ffmpeg falha, a edição volta ao passo anterior e o próprio job se enfileira de novo depois de um minuto; na terceira tentativa perdida a edição falha com a frase e os arquivos saem.
 * Um bruto com HDR que o ffmpeg do servidor não consegue converter tenta uma vez mais sem o tratamento de cor (cores um pouco lavadas é melhor que nenhum vídeo).
 * Nada da fala, do título ou da legenda vai para log, resumo ou erro: só números e o estado.
 */
import { rename, rm } from "node:fs/promises";

import { and, eq, sql } from "drizzle-orm";

import { GUARDA_DO_EDITADO_MS, TENTATIVAS_DO_RENDER } from "@/config/edicao";
import { db } from "@/db";
import { edicoes, type Edicao } from "@/db/schema";
import {
  apagarArquivoDaEdicao,
  arquivoExiste,
  caminhoDeSaidaDoRender,
  caminhoNoVolume,
  garantirSubpasta,
  nomeRelativoDaPrevia,
  nomeRelativoDoEditado,
  SUBPASTA_DA_PREVIA,
  SUBPASTA_DO_EDITADO,
} from "@/edicao/arquivos";
import { ErroDoRender, lerHdrDoBruto, renderizar, type EntradaDoRender } from "@/edicao/render";
import type { PerfilDeRender } from "@/edicao/render-grafo";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { logger } from "@/lib/log";
import { fraseDaEdicao, type CodigoDaEdicao } from "@/textos/edicao";

export type PayloadRenderizarEdicao = { edicaoId: number; perfil: PerfilDeRender };

export type DepsDoRender = {
  agora?: () => Date;
  /** Quem enfileira o render (o padrão põe na fila `renderizar-edicao`). Os testes trocam para não depender da fila. */
  enfileirar?: (edicaoId: number, perfil: PerfilDeRender, emSegundos: number) => Promise<void>;
  /** O ffmpeg de verdade; os testes de falha trocam por uma função que erra. */
  renderizar?: (entrada: EntradaDoRender) => Promise<{ duracaoEsperadaS: number }>;
  lerHdr?: (caminho: string) => ReturnType<typeof lerHdrDoBruto>;
};

/** O estado em que a edição espera a vez e o estado em que está sendo montada, para cada perfil. */
export const ESTADOS_DO_RENDER = {
  previa: { espera: "verificado", montando: "montando_previa" },
  final: { espera: "aprovada", montando: "montando_final" },
} as const;

/** Põe o render na fila. Cada tentativa tem a própria chave, para um pedido repetido não ser descartado nem duplicado. */
export async function enfileirarRender(edicaoId: number, perfil: PerfilDeRender, emSegundos = 0, tentativa = 0): Promise<void> {
  await garantirBossPronto();
  await boss().send(FILAS.renderizarEdicao, { edicaoId, perfil } satisfies PayloadRenderizarEdicao, {
    singletonKey: `render-${perfil}-${edicaoId}-${tentativa}`,
    startAfter: emSegundos,
  });
}

/** Falha a edição com a frase e apaga tudo o que ela guarda (bruto, prévia, plano): o render não deu certo em todas as tentativas. */
async function falhar(edicao: Pick<Edicao, "id" | "caminhoBruto" | "caminhoPrevia">, codigo: CodigoDaEdicao, agora: Date): Promise<void> {
  await apagarArquivoDaEdicao(edicao.caminhoBruto);
  await apagarArquivoDaEdicao(edicao.caminhoPrevia);
  await db()
    .update(edicoes)
    .set({
      estado: "falhou",
      motivo: fraseDaEdicao(codigo),
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
    .where(eq(edicoes.id, edicao.id));
}

export async function rodarRenderizarEdicao(edicaoId: number, perfil: PerfilDeRender, deps: DepsDoRender = {}): Promise<Record<string, unknown>> {
  if (!Number.isInteger(edicaoId) || edicaoId <= 0 || (perfil !== "previa" && perfil !== "final")) throw new Error("uso: npm run job -- renderizar-edicao <edicaoId> <previa|final>");
  const agora = deps.agora ? deps.agora() : new Date();
  const { espera, montando } = ESTADOS_DO_RENDER[perfil];

  // Só passa quem consegue reservar: duas execuções nunca montam a mesma edição ao mesmo tempo.
  const [edicao] = await db()
    .update(edicoes)
    .set({ estado: montando, tentativasDoRender: sql`${edicoes.tentativasDoRender} + 1`, progressoDoRender: 0, atualizadaEm: agora })
    .where(and(eq(edicoes.id, edicaoId), eq(edicoes.estado, espera)))
    .returning();
  if (!edicao) {
    const [atual] = await db().select({ estado: edicoes.estado }).from(edicoes).where(eq(edicoes.id, edicaoId));
    return { edicaoId, perfil, pulou: atual?.estado ?? "inexistente" };
  }

  if (!edicao.resultado || !(await arquivoExiste(edicao.caminhoBruto))) {
    await falhar(edicao, "sumiu", agora);
    return { edicaoId, perfil, estado: "falhou", motivo: "sem-bruto-ou-plano" };
  }

  const subpasta = perfil === "previa" ? SUBPASTA_DA_PREVIA : SUBPASTA_DO_EDITADO;
  const relativo = perfil === "previa" ? nomeRelativoDaPrevia(edicaoId) : nomeRelativoDoEditado(edicaoId);
  await garantirSubpasta(subpasta);
  const parcial = caminhoDeSaidaDoRender(subpasta, edicaoId);
  const bruto = caminhoNoVolume(edicao.caminhoBruto as string);
  const { resultado } = edicao;
  const inicio = Date.now();

  const aoProgredir = (porcento: number) => {
    void db()
      .update(edicoes)
      .set({ progressoDoRender: porcento, atualizadaEm: new Date() })
      .where(and(eq(edicoes.id, edicaoId), eq(edicoes.estado, montando)))
      .catch(() => undefined);
  };

  try {
    const hdr = await (deps.lerHdr ?? lerHdrDoBruto)(bruto);
    const entrada: EntradaDoRender = { perfil, bruto, saida: parcial, edl: resultado.edl, blocos: resultado.legenda.blocos, titulo: resultado.titulo, hdr, aoProgredir };
    const rodar = deps.renderizar ?? renderizar;
    try {
      await rodar(entrada);
    } catch (erro) {
      if (!hdr || !(erro instanceof ErroDoRender)) throw erro;
      logger.warn({ edicaoId, perfil }, "edicao: o render com HDR falhou, tentando sem o tratamento de cor");
      await rm(parcial, { force: true }).catch(() => undefined);
      await rodar({ ...entrada, hdr: null });
    }
    await rename(parcial, caminhoNoVolume(relativo));
  } catch (erro) {
    await rm(parcial, { force: true }).catch(() => undefined);
    const nome = erro instanceof Error ? erro.name : "erro";
    logger.warn({ edicaoId, perfil, tentativas: edicao.tentativasDoRender, erro: nome }, "edicao: o render nao terminou");
    if (edicao.tentativasDoRender >= TENTATIVAS_DO_RENDER) {
      await falhar(edicao, "nao-montou", agora);
    } else {
      await db()
        .update(edicoes)
        .set({ estado: espera, progressoDoRender: null, atualizadaEm: new Date() })
        .where(and(eq(edicoes.id, edicaoId), eq(edicoes.estado, montando)));
      try {
        await (deps.enfileirar ?? ((id, p, s) => enfileirarRender(id, p, s, edicao.tentativasDoRender)))(edicaoId, perfil, 60);
      } catch (erroDaFila) {
        // A limpeza de hora em hora enfileira de novo o que ficou esperando sem ninguém pegar.
        logger.warn({ err: erroDaFila, edicaoId }, "edicao: nao foi possivel enfileirar o render de novo");
      }
    }
    throw erro;
  }

  const fim = new Date();
  if (perfil === "previa") {
    await db()
      .update(edicoes)
      .set({ estado: "previa_pronta", caminhoPrevia: relativo, progressoDoRender: null, tentativasDoRender: 0, atualizadaEm: fim })
      .where(and(eq(edicoes.id, edicaoId), eq(edicoes.estado, montando)));
  } else {
    // O vídeo final está pronto: o bruto e a prévia já cumpriram o papel e saem na hora (a fala da pessoa não fica guardada além do necessário).
    const [pronta] = await db()
      .update(edicoes)
      .set({
        estado: "pronta",
        caminhoEditado: relativo,
        editadoExpiraEm: new Date(fim.getTime() + GUARDA_DO_EDITADO_MS),
        caminhoBruto: null,
        caminhoPrevia: null,
        brutoApagadoEm: fim,
        palavras: null,
        energia: null,
        pedidosDeAjuste: null,
        progressoDoRender: null,
        tentativasDoRender: 0,
        atualizadaEm: fim,
      })
      .where(and(eq(edicoes.id, edicaoId), eq(edicoes.estado, montando)))
      .returning({ id: edicoes.id });
    if (pronta) {
      await apagarArquivoDaEdicao(edicao.caminhoBruto);
      await apagarArquivoDaEdicao(edicao.caminhoPrevia);
    }
  }
  return { edicaoId, perfil, estado: perfil === "previa" ? "previa_pronta" : "pronta", duracaoDoVideoS: Math.round(resultado.edl.duracao), segundosDeRender: Math.round((Date.now() - inicio) / 1000) };
}
