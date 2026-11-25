/**
 * E68 A2: o render do vídeo de animação, no contêiner `roteiros-render` (um vídeo por vez, a mesma trava de CPU da edição). O mesmo ciclo da edição (E47 PR 4): a PRÉVIA 540 por 960 primeiro; a pessoa
 * assiste e aprova (`fazendo_final`), e só então o FINAL 1080 por 1920. O processador só gasta com o que vai ser usado.
 *
 * O caminho de uma rodada: reserva a animação (UPDATE condicional que conta a tentativa e põe `progresso` em 0: `pedida` vira `fazendo_previa`; o final espera em `fazendo_final` com `progresso`
 * nulo) -> o motor (`renderizarAnimacao`) escreve num `.parte` do volume, com o andamento no banco a cada poucos segundos -> o arquivo vira `animacao/an-<id>-previa.mp4` ou `-final.mp4` por
 * `rename`. No final, a prévia sai (a pessoa já aprovou) e o vídeo ganha 7 dias de guarda.
 *
 * Falha: na primeira tentativa perdida a animação volta para a vez e o próprio job se enfileira depois de 30 segundos; na segunda (ou numa entrada inválida, que não melhora tentando de novo) ela
 * vira `falhou` com a frase para a pessoa (`textos/animacao.ts`) e só um código curto vai para a linha. O erro técnico fica no log, sem uma palavra do texto da pessoa: só números e códigos.
 */
import { rename, rm } from "node:fs/promises";

import { and, eq, gte, or, sql } from "drizzle-orm";

import { animacaoLiberadaParaMarca } from "@/animacao/acesso";
import {
  caminhoDeSaidaDaAnimacao,
  caminhoDaAnimacaoNoVolume,
  apagarArquivoDaAnimacao,
  garantirSubpastaDaAnimacao,
  nomeRelativoDaAnimacao,
} from "@/animacao/arquivos";
import { ErroDaAnimacao, type EntradaDaAnimacao, type ResultadoDaAnimacao } from "@/animacao/tipos";
import { ESPERA_ENTRE_TENTATIVAS_S, GUARDA_DO_FINAL_MS, TENTATIVAS_DA_ANIMACAO } from "@/config/animacao-fila";
import { db } from "@/db";
import { animacoes, type Animacao } from "@/db/schema";
import { logger } from "@/lib/log";
import { enfileirarRenderDaAnimacao, type PerfilDaAnimacao } from "@/servicos/animacao-fila";
import { recusaPorDiscoCritico, type DepsDaRecusaPorDisco } from "@/servicos/disco";
import { fraseDaAnimacao } from "@/textos/animacao";

export type { PayloadRenderizarAnimacao } from "@/servicos/animacao-fila";

export type DepsDoRenderDaAnimacao = {
  agora?: () => Date;
  /** Quem enfileira (o padrão põe na fila `renderizar-animacao`); os testes trocam para não depender da fila. */
  enfileirar?: (animacaoId: number, perfil: PerfilDaAnimacao, emSegundos: number, tentativa: number | string) => Promise<void>;
  /** O motor de verdade (Chromium e ffmpeg); os testes trocam por uma função que erra ou que escreve um arquivo qualquer. */
  renderizar?: (entrada: EntradaDaAnimacao) => Promise<ResultadoDaAnimacao>;
  disco?: DepsDaRecusaPorDisco;
};

/** O estado em que a animação espera a vez de cada passo, e o em que ela está sendo montada. A prévia muda de estado ao ser pega; o final espera já no estado `fazendo_final` (`progresso` nulo). */
const ESTADOS = {
  previa: { espera: "pedida", montando: "fazendo_previa" },
  final: { espera: "fazendo_final", montando: "fazendo_final" },
} as const;

async function motorDeVerdade(entrada: EntradaDaAnimacao): Promise<ResultadoDaAnimacao> {
  // Importado na hora: o aplicativo e os testes que não montam vídeo nunca carregam o navegador.
  const { renderizarAnimacao } = await import("@/animacao/render");
  return renderizarAnimacao(entrada);
}

function condicaoDaReserva(animacaoId: number, perfil: PerfilDaAnimacao) {
  const base = and(eq(animacoes.id, animacaoId), eq(animacoes.estado, ESTADOS[perfil].espera));
  return perfil === "final" ? and(base, sql`${animacoes.progresso} is null`) : base;
}

export async function rodarRenderizarAnimacao(animacaoId: number, perfil: PerfilDaAnimacao, deps: DepsDoRenderDaAnimacao = {}): Promise<Record<string, unknown>> {
  if (!Number.isInteger(animacaoId) || animacaoId <= 0 || (perfil !== "previa" && perfil !== "final")) throw new Error("uso: npm run job -- renderizar-animacao <animacaoId> <previa|final>");
  const agora = deps.agora ? deps.agora() : new Date();
  const enfileirar = deps.enfileirar ?? ((id: number, p: PerfilDaAnimacao, s: number, t: number | string) => enfileirarRenderDaAnimacao(id, p, s, t));
  const { montando } = ESTADOS[perfil];

  // Função desligada (chave geral ou marca fora da lista): o job pula antes de reservar, de gastar tentativa ou de abrir o Chromium. O pedido fica onde está e a limpeza o retoma se a função voltar.
  const [dona] = await db().select({ clienteId: animacoes.clienteId }).from(animacoes).where(eq(animacoes.id, animacaoId));
  if (dona && !animacaoLiberadaParaMarca(dona.clienteId)) return { animacaoId, perfil, pulou: "desligada" };

  // Com o disco do servidor em nível crítico nada novo é escrito: a animação fica onde está, sem gastar tentativa, e o job volta daqui a 10 minutos.
  if (await recusaPorDiscoCritico(deps.disco)) {
    const [esperando] = await db().select({ id: animacoes.id }).from(animacoes).where(condicaoDaReserva(animacaoId, perfil));
    if (!esperando) return { animacaoId, perfil, pulou: "outro-estado" };
    try {
      await enfileirar(animacaoId, perfil, 600, `disco-${Math.floor(agora.getTime() / 600_000)}`);
    } catch (erro) {
      logger.warn({ err: erro, animacaoId }, "animacao: nao foi possivel enfileirar o render de novo com o disco cheio");
    }
    return { animacaoId, perfil, pulou: "disco-cheio" };
  }

  // Só passa quem consegue reservar: duas execuções nunca montam a mesma animação ao mesmo tempo.
  const [animacao] = await db()
    .update(animacoes)
    .set({ estado: montando, tentativas: sql`${animacoes.tentativas} + 1`, progresso: 0, atualizadaEm: agora })
    .where(condicaoDaReserva(animacaoId, perfil))
    .returning();
  if (!animacao) {
    const [atual] = await db().select({ estado: animacoes.estado }).from(animacoes).where(eq(animacoes.id, animacaoId));
    return { animacaoId, perfil, pulou: atual?.estado ?? "inexistente" };
  }

  await garantirSubpastaDaAnimacao();
  const parcial = caminhoDeSaidaDaAnimacao(animacaoId);
  const relativo = nomeRelativoDaAnimacao(animacaoId, perfil);
  const inicio = Date.now();
  const aoProgredir = (porcento: number) => {
    void db()
      .update(animacoes)
      .set({ progresso: porcento, atualizadaEm: new Date() })
      .where(and(eq(animacoes.id, animacaoId), eq(animacoes.estado, montando), sql`${animacoes.progresso} is not null`))
      .catch(() => undefined);
  };

  try {
    await (deps.renderizar ?? motorDeVerdade)({ cenas: animacao.cenas, molde: animacao.molde, qualidade: perfil, saida: parcial, aoProgredir });
    await rename(parcial, caminhoDaAnimacaoNoVolume(relativo));
  } catch (erro) {
    await rm(parcial, { force: true }).catch(() => undefined);
    const codigo = erro instanceof ErroDaAnimacao ? erro.codigo : "navegador";
    // Só números e códigos: a mensagem do motor nunca leva texto da pessoa, mas por garantia o log leva o nome do erro, não a mensagem.
    logger.warn({ animacaoId, perfil, tentativas: animacao.tentativas, codigo, erro: erro instanceof Error ? erro.name : "erro" }, "animacao: o render nao terminou");
    if (codigo === "entrada" || animacao.tentativas >= TENTATIVAS_DA_ANIMACAO) {
      await db()
        .update(animacoes)
        .set({ estado: "falhou", motivo: fraseDaAnimacao("nao-montou"), codigoDoErro: codigo, progresso: null, atualizadaEm: new Date() })
        .where(and(eq(animacoes.id, animacaoId), eq(animacoes.estado, montando)));
    } else {
      await db()
        .update(animacoes)
        .set({ estado: ESTADOS[perfil].espera, progresso: null, atualizadaEm: new Date() })
        .where(and(eq(animacoes.id, animacaoId), eq(animacoes.estado, montando)));
      try {
        await enfileirar(animacaoId, perfil, ESPERA_ENTRE_TENTATIVAS_S, animacao.tentativas);
      } catch (erroDaFila) {
        // A limpeza de hora em hora enfileira de novo o que ficou esperando sem ninguém pegar.
        logger.warn({ err: erroDaFila, animacaoId }, "animacao: nao foi possivel enfileirar o render de novo");
      }
    }
    throw erro;
  }

  const fim = new Date();
  if (perfil === "previa") {
    await db()
      .update(animacoes)
      .set({ estado: "previa_pronta", caminhoPrevia: relativo, progresso: null, tentativas: 0, atualizadaEm: fim })
      .where(and(eq(animacoes.id, animacaoId), eq(animacoes.estado, "fazendo_previa")));
  } else {
    // O vídeo final está pronto: a prévia já cumpriu o papel e sai na hora.
    const [pronta] = await db()
      .update(animacoes)
      .set({ estado: "final_pronta", caminhoFinal: relativo, caminhoPrevia: null, progresso: null, tentativas: 0, finalExpiraEm: new Date(fim.getTime() + GUARDA_DO_FINAL_MS), atualizadaEm: fim })
      .where(and(eq(animacoes.id, animacaoId), eq(animacoes.estado, "fazendo_final")))
      .returning({ id: animacoes.id });
    if (pronta) await apagarArquivoDaAnimacao(animacao.caminhoPrevia);
  }
  return { animacaoId, perfil, estado: perfil === "previa" ? "previa_pronta" : "final_pronta", segundosDeRender: Math.round((Date.now() - inicio) / 1000) };
}

/**
 * Na partida do contêiner de render: o que estava sendo montado quando o anterior parou volta para a vez e é enfileirado de novo. Só este contêiner monta vídeo, e ele acabou de subir: nenhuma
 * animação `fazendo_*` com `progresso` pode estar em andamento de verdade.
 */
export async function recolherAnimacoesOrfas(deps: Pick<DepsDoRenderDaAnimacao, "enfileirar"> = {}): Promise<number> {
  const enfileirar = deps.enfileirar ?? ((id: number, p: PerfilDaAnimacao, s: number, t: number | string) => enfileirarRenderDaAnimacao(id, p, s, t));
  const voltaram: { animacao: Pick<Animacao, "id" | "tentativas">; perfil: PerfilDaAnimacao }[] = [];
  // Quem já gastou todas as tentativas e estava no meio quando o processo morreu (memória, por exemplo) não volta para a fila: senão entraria em laço e pararia a edição, que divide este contêiner.
  const noMeio = or(eq(animacoes.estado, "fazendo_previa"), and(eq(animacoes.estado, "fazendo_final"), sql`${animacoes.progresso} is not null`));
  await db()
    .update(animacoes)
    .set({ estado: "falhou", motivo: fraseDaAnimacao("nao-montou"), codigoDoErro: "parou", progresso: null, atualizadaEm: new Date() })
    .where(and(noMeio, gte(animacoes.tentativas, TENTATIVAS_DA_ANIMACAO)));
  const previas = await db()
    .update(animacoes)
    .set({ estado: "pedida", progresso: null, atualizadaEm: new Date() })
    .where(eq(animacoes.estado, "fazendo_previa"))
    .returning({ id: animacoes.id, tentativas: animacoes.tentativas });
  for (const animacao of previas) voltaram.push({ animacao, perfil: "previa" });
  const finais = await db()
    .update(animacoes)
    .set({ progresso: null, atualizadaEm: new Date() })
    .where(and(eq(animacoes.estado, "fazendo_final"), sql`${animacoes.progresso} is not null`))
    .returning({ id: animacoes.id, tentativas: animacoes.tentativas });
  for (const animacao of finais) voltaram.push({ animacao, perfil: "final" });
  for (const { animacao, perfil } of voltaram) {
    try {
      await enfileirar(animacao.id, perfil, 0, `orfa-${animacao.tentativas}-${Date.now()}`);
    } catch (erro) {
      logger.warn({ err: erro, animacaoId: animacao.id }, "animacao: nao foi possivel enfileirar o render recolhido");
    }
  }
  return voltaram.length;
}
