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

import { ESPERA_DO_RENDER_COM_DISCO_CRITICO_S, GUARDA_DO_EDITADO_MS, TENTATIVAS_DO_RENDER } from "@/config/edicao";
import { db } from "@/db";
import { edicoes, type ConferenciaDoVideo, type Edicao } from "@/db/schema";
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
import { conferirVideo, type Conferencia } from "@/edicao/conferencia";
import { ErroDoRender, lerHdrDoBruto, renderizar, type EntradaDoRender } from "@/edicao/render";
import type { PerfilDeRender } from "@/edicao/render-grafo";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { logger } from "@/lib/log";
import { recusaPorDiscoCritico, type DepsDaRecusaPorDisco } from "@/servicos/disco";
import { fraseDaEdicao, type CodigoDaEdicao } from "@/textos/edicao";

export type PayloadRenderizarEdicao = { edicaoId: number; perfil: PerfilDeRender };

export type DepsDoRender = {
  agora?: () => Date;
  /** Quem enfileira o render (o padrão põe na fila `renderizar-edicao`). Os testes trocam para não depender da fila. */
  enfileirar?: (edicaoId: number, perfil: PerfilDeRender, emSegundos: number) => Promise<void>;
  /** O ffmpeg de verdade; os testes de falha trocam por uma função que erra. */
  renderizar?: (entrada: EntradaDoRender) => Promise<{ duracaoEsperadaS: number }>;
  lerHdr?: (caminho: string) => ReturnType<typeof lerHdrDoBruto>;
  /** A conferência do vídeo montado (os testes trocam para dar o resultado que quiserem). */
  conferir?: (caminho: string, esperado: { duracaoS: number; respiroFinalS: number }, resultado: NonNullable<Edicao["resultado"]>) => Promise<Conferencia>;
  /** Achado 10 da revisão de 03/11/2026: como medir o disco antes de montar (os testes dão o disco que quiserem). */
  disco?: DepsDaRecusaPorDisco;
};

/** O estado em que a edição espera a vez e o estado em que está sendo montada, para cada perfil. */
export const ESTADOS_DO_RENDER = {
  previa: { espera: "verificado", montando: "montando_previa" },
  final: { espera: "aprovada", montando: "montando_final" },
} as const;

/** Põe o render na fila. Cada tentativa tem a própria chave, para um pedido repetido não ser descartado nem duplicado. */
export async function enfileirarRender(edicaoId: number, perfil: PerfilDeRender, emSegundos = 0, tentativa: number | string = 0): Promise<void> {
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

/** A parte da chave do pg-boss do render refeito pela conferência: muda a cada rodada, para um reenvio depois de um "refazer" nunca ser descartado como duplicado do anterior. */
export function chaveDoRefeito(rodada: number): string {
  return `conferencia-${rodada}`;
}

type ConferenciaComTempo = Conferencia & { segundos: number; naoConferido?: boolean };

/** Mede a prévia e confere com o plano. Se a conferência em si falhar (o ffmpeg não leu, passou do tempo), a prévia segue sem ela: conferir não pode derrubar o que já foi montado. */
async function conferirOVideo(edicao: Edicao, caminho: string, duracaoS: number, deps: DepsDoRender): Promise<ConferenciaComTempo> {
  const resultado = edicao.resultado as NonNullable<Edicao["resultado"]>;
  const esperado = { duracaoS, respiroFinalS: resultado.edl.respiroFinal };
  const inicio = Date.now();
  try {
    const c = deps.conferir
      ? await deps.conferir(caminho, esperado, resultado)
      : await conferirVideo({ caminho, esperado: { perfil: "previa", ...esperado }, blocos: resultado.legenda.blocos, titulo: resultado.titulo });
    const comTempo = { ...c, segundos: (Date.now() - inicio) / 1000 };
    // Uma linha por conferência, para a Central calibrar os limites com vídeo real. Só números e o id da edição, nada da fala.
    const m = c.medidas;
    logger.info(
      {
        edicaoId: edicao.id,
        desfecho: c.graves.length > 0 ? "grave" : c.leves.length > 0 ? "aviso" : "ok",
        graves: c.graves.length,
        leves: c.leves.length,
        volumeLufs: m.volumeLufs ?? null,
        pretoMaxS: m.pretoMaxS ?? null,
        paradoMaxS: m.paradoMaxS ?? null,
        mudoMaxS: m.mudoMaxS ?? null,
        diferencaDeDuracaoS: m.diferencaDeDuracaoS ?? null,
        segundos: Math.round(comTempo.segundos * 100) / 100,
      },
      "edicao: conferencia do video",
    );
    return comTempo;
  } catch (erro) {
    logger.warn({ edicaoId: edicao.id, erro: erro instanceof Error ? erro.name : "erro" }, "edicao: a conferencia do video nao rodou");
    return { graves: [], leves: ["a conferencia do video nao rodou"], medidas: {}, segundos: (Date.now() - inicio) / 1000, naoConferido: true };
  }
}

function guardarConferencia(edicao: Pick<Edicao, "conferenciaDoVideo">, c: ConferenciaComTempo | null, agora: Date, desfecho?: ConferenciaDoVideo["desfecho"]): ConferenciaDoVideo | null {
  if (!c) return edicao.conferenciaDoVideo ?? null;
  return {
    rodada: (edicao.conferenciaDoVideo?.rodada ?? 0) + 1,
    desfecho: desfecho ?? (c.naoConferido ? "nao-conferido" : c.leves.length > 0 ? "aviso" : "ok"),
    graves: c.graves,
    leves: c.leves,
    medidas: c.medidas,
    segundosDaConferencia: Math.round(c.segundos * 100) / 100,
    conferidaEm: agora.toISOString(),
  };
}

/**
 * Defeito grave na prévia recém-montada (o arquivo já foi apagado). Na primeira vez a edição volta à vez e o render é refeito; se o defeito voltar, a edição vai para `para_revisao` com a frase
 * de sempre (a pessoa nunca vê termo técnico) e o motivo técnico fica na conferência guardada, para o admin.
 */
async function resolverDefeitoGrave(edicao: Edicao, conferencia: ConferenciaComTempo, deps: DepsDoRender): Promise<Record<string, unknown>> {
  const agora = new Date();
  const { montando, espera } = ESTADOS_DO_RENDER.previa;
  const rodadaNova = (edicao.conferenciaDoVideo?.rodada ?? 0) + 1;
  const refazer = rodadaNova <= 1;
  if (!refazer) {
    await db()
      .update(edicoes)
      .set({
        estado: "para_revisao",
        motivo: fraseDaEdicao("em-revisao"),
        caminhoPrevia: null,
        progressoDoRender: null,
        tentativasDoRender: 0,
        conferenciaDoVideo: guardarConferencia(edicao, conferencia, agora, "revisao"),
        atualizadaEm: agora,
      })
      .where(and(eq(edicoes.id, edicao.id), eq(edicoes.estado, montando)));
    logger.warn({ edicaoId: edicao.id, graves: conferencia.graves.length }, "edicao: defeito grave de novo na conferencia, foi para revisao");
    return { edicaoId: edicao.id, perfil: "previa", estado: "para_revisao", conferencia: "defeito-grave-repetido" };
  }
  await db()
    .update(edicoes)
    .set({ estado: espera, progressoDoRender: null, tentativasDoRender: 0, conferenciaDoVideo: guardarConferencia(edicao, conferencia, agora, "refeito"), atualizadaEm: agora })
    .where(and(eq(edicoes.id, edicao.id), eq(edicoes.estado, montando)));
  try {
    await (deps.enfileirar ?? ((id, p, s) => enfileirarRender(id, p, s, chaveDoRefeito(rodadaNova))))(edicao.id, "previa", 5);
  } catch (erro) {
    // A limpeza de hora em hora enfileira de novo o que ficou esperando sem ninguém pegar.
    logger.warn({ err: erro, edicaoId: edicao.id }, "edicao: nao foi possivel enfileirar o render refeito pela conferencia");
  }
  logger.warn({ edicaoId: edicao.id, graves: conferencia.graves.length }, "edicao: defeito grave na conferencia, o render sera refeito uma vez");
  return { edicaoId: edicao.id, perfil: "previa", estado: espera, conferencia: "refeito" };
}

export async function rodarRenderizarEdicao(edicaoId: number, perfil: PerfilDeRender, deps: DepsDoRender = {}): Promise<Record<string, unknown>> {
  if (!Number.isInteger(edicaoId) || edicaoId <= 0 || (perfil !== "previa" && perfil !== "final")) throw new Error("uso: npm run job -- renderizar-edicao <edicaoId> <previa|final>");
  const agora = deps.agora ? deps.agora() : new Date();
  const { espera, montando } = ESTADOS_DO_RENDER[perfil];

  // Achado 10 da revisão de 03/11/2026: com o disco do servidor em nível crítico nada novo é escrito. A edição fica onde está (esperando a vez), sem gastar tentativa, e o job volta daqui a 10
  // minutos; a limpeza do bruto vencido já foi pedida por `recusaPorDiscoCritico`. A pessoa continua vendo "esperando a vez" e nada falha.
  if (await recusaPorDiscoCritico(deps.disco)) {
    const [esperando] = await db()
      .update(edicoes)
      .set({ atualizadaEm: agora })
      .where(and(eq(edicoes.id, edicaoId), eq(edicoes.estado, espera)))
      .returning({ id: edicoes.id });
    // Quem não está esperando a vez (já terminou, falhou ou não existe) não volta para a fila.
    if (!esperando) return { edicaoId, perfil, pulou: "outro-estado" };
    try {
      await (deps.enfileirar ?? ((id, p, s) => enfileirarRender(id, p, s, `disco-${Math.floor(agora.getTime() / 1000 / ESPERA_DO_RENDER_COM_DISCO_CRITICO_S)}`)))(edicaoId, perfil, ESPERA_DO_RENDER_COM_DISCO_CRITICO_S);
    } catch (erro) {
      // A limpeza de hora em hora enfileira de novo o que ficou esperando sem ninguém pegar.
      logger.warn({ err: erro, edicaoId }, "edicao: nao foi possivel enfileirar o render de novo com o disco cheio");
    }
    return { edicaoId, perfil, pulou: "disco-cheio" };
  }

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
  let duracaoEsperadaS = resultado.edl.duracao + resultado.edl.respiroFinal;
  let conferencia: ConferenciaComTempo | null = null;

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
      duracaoEsperadaS = (await rodar(entrada)).duracaoEsperadaS;
    } catch (erro) {
      if (!hdr || !(erro instanceof ErroDoRender)) throw erro;
      logger.warn({ edicaoId, perfil }, "edicao: o render com HDR falhou, tentando sem o tratamento de cor");
      await rm(parcial, { force: true }).catch(() => undefined);
      duracaoEsperadaS = (await rodar({ ...entrada, hdr: null })).duracaoEsperadaS;
    }
    // A conferência vem antes do `rename`: um vídeo com defeito grave nunca chega ao nome que a pessoa vê.
    if (perfil === "previa") {
      conferencia = await conferirOVideo(edicao, parcial, duracaoEsperadaS, deps);
      if (conferencia.graves.length > 0) {
        await rm(parcial, { force: true }).catch(() => undefined);
        return await resolverDefeitoGrave(edicao, conferencia, deps);
      }
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
      .set({ estado: "previa_pronta", caminhoPrevia: relativo, progressoDoRender: null, tentativasDoRender: 0, conferenciaDoVideo: guardarConferencia(edicao, conferencia, fim), atualizadaEm: fim })
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

/**
 * Na partida do contêiner de render: o que estava sendo montado quando o contêiner anterior parou (um deploy, uma queda) volta para a vez e é enfileirado de novo, sem esperar os 40 minutos da
 * limpeza. Só este contêiner monta vídeo, e ele acabou de subir: nenhuma edição `montando_*` pode estar em andamento de verdade.
 */
export async function recolherRendersOrfaos(deps: Pick<DepsDoRender, "enfileirar"> = {}): Promise<number> {
  let recolhidos = 0;
  for (const perfil of ["previa", "final"] as const) {
    const { espera, montando } = ESTADOS_DO_RENDER[perfil];
    const voltaram = await db()
      .update(edicoes)
      .set({ estado: espera, progressoDoRender: null, atualizadaEm: new Date() })
      .where(eq(edicoes.estado, montando))
      .returning({ id: edicoes.id, tentativas: edicoes.tentativasDoRender });
    for (const linha of voltaram) {
      try {
        await (deps.enfileirar ?? ((id, p, s) => enfileirarRender(id, p, s, linha.tentativas)))(linha.id, perfil, 0);
      } catch (erro) {
        logger.warn({ err: erro, edicaoId: linha.id }, "edicao: nao foi possivel enfileirar o render recolhido");
      }
      recolhidos += 1;
    }
  }
  return recolhidos;
}
