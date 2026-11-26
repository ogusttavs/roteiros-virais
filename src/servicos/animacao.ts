/**
 * E68 A2: o vídeo de animação de texto (o plano B do dia em que a pessoa não consegue gravar), do lado do aplicativo: pedir, ver o estado, aprovar a prévia, dispensar, tentar de novo e achar o
 * arquivo para tocar ou baixar. O render em si é do contêiner de render (`render-animacao.ts`).
 *
 * Regras: toda leitura e escrita filtra pela marca da sessão (`clienteId`); marca fora de `ANIMACAO_CONTAS` (ou com `ANIMACAO_ATIVA` desligada) recebe "não achou" em tudo, como se a função não
 * existisse; uma animação em andamento por marca (o índice único parcial da tabela, e a conferência aqui para dar a frase certa); as cenas saem do texto do roteiro que já passou pelo
 * verificador, sem IA nova (custo zero). O "ver como" do admin só lê (as ações e os arquivos recusam antes de chegar aqui).
 */
import { and, desc, eq, inArray, ne } from "drizzle-orm";

import { animacaoLiberadaParaMarca } from "@/animacao/acesso";
import { apagarArquivoDaAnimacao } from "@/animacao/arquivos";
import { montarCenasDosParagrafos } from "@/animacao/cenas";
import { MOLDE_PADRAO } from "@/animacao/moldes";
import { montarLinhaDoTempo } from "@/animacao/montador";
import { temColchete, trechosEntreColchetes } from "@/carrossel/colchetes";
import { ESTADOS_EM_ANDAMENTO, tempoEsperadoDaPreviaS, tempoEsperadoDoFinalS, type EstadoDaAnimacao } from "@/config/animacao-fila";
import { db } from "@/db";
import { animacoes, type Animacao } from "@/db/schema";
import { logger } from "@/lib/log";
import { enfileirarRenderDaAnimacao } from "@/servicos/animacao-fila";
import { blocosParaLeitura, roteiroPorId, type RoteiroLinha } from "@/servicos/roteiro";
import { fraseDaAnimacao, tempoPorExtenso, type CodigoDaAnimacao } from "@/textos/animacao";

export type RecusaDaAnimacao = { ok: false; codigo: CodigoDaAnimacao; frase: string; status: 404 | 409 | 500 };
export type ResultadoDaAnimacao<T> = ({ ok: true } & T) | RecusaDaAnimacao;

function recusa(codigo: CodigoDaAnimacao, status: RecusaDaAnimacao["status"]): RecusaDaAnimacao {
  return { ok: false, codigo, frase: fraseDaAnimacao(codigo), status };
}

/** O que a tela recebe de uma animação. Tudo serializável; nada de caminho de arquivo nem erro técnico. */
export type VistaDaAnimacao = {
  id: number;
  estado: EstadoDaAnimacao;
  /** 0 a 100 enquanto o vídeo é montado; `null` esperando a vez ou fora de uma montagem. */
  progresso: number | null;
  /** A frase de falha (só em `falhou`). */
  motivo: string | null;
  /** O que a tela diz que leva, já por extenso ("uns 40 segundos"). */
  tempoDaPrevia: string;
  tempoDoFinal: string;
  /** As frases do roteiro que não couberam no vídeo e ficaram de fora (vazio quando coube tudo). A tela da prévia lista antes de a pessoa aprovar. */
  foraDoVideo: string[];
  /** Quando o vídeo final sai do ar (só em `final_pronta`). */
  finalExpiraEm: string | null;
};

export type VisaoDaAnimacao = {
  /** No "ver como" a tela só lê: nada de pedir, aprovar nem baixar. */
  verComo: boolean;
  animacao: VistaDaAnimacao | null;
  /** Quantos espaços para completar (trechos entre colchetes) o texto do roteiro ainda tem: com algum, o pedido não sai até a pessoa completar. */
  colchetes: number;
  /** A marca já tem outra animação em andamento (de outro roteiro): o botão não pede outra. */
  outraEmAndamento: boolean;
};

export function vistaDaAnimacao(a: Pick<Animacao, "id" | "estado" | "progresso" | "motivo" | "duracaoS" | "finalExpiraEm" | "foraDoVideo">): VistaDaAnimacao {
  const duracao = Number(a.duracaoS);
  return {
    id: a.id,
    estado: a.estado,
    progresso: a.progresso,
    motivo: a.estado === "falhou" ? a.motivo : null,
    tempoDaPrevia: tempoPorExtenso(tempoEsperadoDaPreviaS(duracao)),
    tempoDoFinal: tempoPorExtenso(tempoEsperadoDoFinalS(duracao)),
    foraDoVideo: a.foraDoVideo ?? [],
    finalExpiraEm: a.estado === "final_pronta" && a.finalExpiraEm ? a.finalExpiraEm.toISOString() : null,
  };
}

/** Os parágrafos do roteiro na ordem de leitura (gancho, corpo, fechamento, chamada), para virar cenas. Roteiro sem fala não tem texto (só cartões de imagem): lista vazia. */
function paragrafosDoRoteiro(roteiro: Pick<RoteiroLinha, "conteudo" | "estilo" | "formato">): string[] {
  return blocosParaLeitura(roteiro).flatMap((b) => b.paragrafos);
}

/** O roteiro serve para virar vídeo em animação? Só o vídeo curto e com texto. */
function motivoDeNaoServir(roteiro: Pick<RoteiroLinha, "conteudo" | "estilo" | "formato" | "duracaoDoVideo">): CodigoDaAnimacao | null {
  if (roteiro.duracaoDoVideo === "longo") return "longo";
  return paragrafosDoRoteiro(roteiro).length === 0 ? "sem-texto" : null;
}

/**
 * O que a tela do roteiro mostra, ou `null` quando o chamado não aparece: marca fora da lista, vídeo longo, roteiro sem texto. Uma falha de leitura é de quem chama (a página tira a função da tela).
 */
export async function visaoDaAnimacao(entrada: { clienteId: number; roteiro: Pick<RoteiroLinha, "id" | "conteudo" | "estilo" | "formato" | "duracaoDoVideo">; verComo: boolean }): Promise<VisaoDaAnimacao | null> {
  const { clienteId, roteiro, verComo } = entrada;
  if (!animacaoLiberadaParaMarca(clienteId)) return null;
  if (motivoDeNaoServir(roteiro)) return null;
  const [ultima] = await db()
    .select()
    .from(animacoes)
    .where(and(eq(animacoes.clienteId, clienteId), eq(animacoes.roteiroId, roteiro.id)))
    .orderBy(desc(animacoes.id))
    .limit(1);
  const [outra] = await db()
    .select({ id: animacoes.id })
    .from(animacoes)
    .where(and(eq(animacoes.clienteId, clienteId), ne(animacoes.roteiroId, roteiro.id), inArray(animacoes.estado, [...ESTADOS_EM_ANDAMENTO])))
    .limit(1);
  return { verComo, animacao: ultima ? vistaDaAnimacao(ultima) : null, colchetes: trechosEntreColchetes(paragrafosDoRoteiro(roteiro).join("\n")).length, outraEmAndamento: Boolean(outra) };
}

/** A vista de uma animação da marca (a consulta de andamento da tela), ou `null` se a marca não pode usar, ou a animação não existe ou é de outra marca. */
export async function animacaoDaMarca(clienteId: number, animacaoId: number): Promise<VistaDaAnimacao | null> {
  if (!animacaoLiberadaParaMarca(clienteId)) return null;
  const [linha] = await db()
    .select()
    .from(animacoes)
    .where(and(eq(animacoes.id, animacaoId), eq(animacoes.clienteId, clienteId)));
  return linha ? vistaDaAnimacao(linha) : null;
}

function ehViolacaoDeUnicidade(erro: unknown): boolean {
  const e = erro as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

async function apagarAnimacao(a: Pick<Animacao, "id" | "clienteId" | "caminhoPrevia" | "caminhoFinal">): Promise<void> {
  await db()
    .delete(animacoes)
    .where(and(eq(animacoes.id, a.id), eq(animacoes.clienteId, a.clienteId)));
  await apagarArquivoDaAnimacao(a.caminhoPrevia);
  await apagarArquivoDaAnimacao(a.caminhoFinal);
}

async function enfileirarSemTravar(animacaoId: number, perfil: "previa" | "final"): Promise<void> {
  try {
    await enfileirarRenderDaAnimacao(animacaoId, perfil, 0);
  } catch (erro) {
    // A limpeza de hora em hora enfileira de novo o que ficou esperando sem ninguém pegar.
    logger.warn({ err: erro, animacaoId, perfil }, "animacao: nao foi possivel enfileirar o render");
  }
}

/** "Fazer em animação": cria o pedido a partir do texto do roteiro e põe a prévia na fila. */
export async function pedirAnimacao(entrada: { clienteId: number; usuarioId: string; roteiroId: number }): Promise<ResultadoDaAnimacao<{ animacao: VistaDaAnimacao }>> {
  const { clienteId, usuarioId, roteiroId } = entrada;
  if (!animacaoLiberadaParaMarca(clienteId)) return recusa("nao-achou", 404);
  const roteiro = await roteiroPorId(roteiroId, clienteId);
  if (!roteiro) return recusa("nao-achou", 404);
  const naoServe = motivoDeNaoServir(roteiro);
  if (naoServe) return recusa(naoServe, 409);
  const paragrafos = paragrafosDoRoteiro(roteiro);
  // O vídeo mostra só o que está escrito: espaço para completar com colchete nunca vai para a tela.
  if (paragrafos.some(temColchete)) return recusa("colchete", 409);
  const { cenas, deFora } = montarCenasDosParagrafos(paragrafos);
  let duracaoS: number;
  try {
    duracaoS = montarLinhaDoTempo(cenas).duracaoS;
  } catch {
    return recusa("sem-texto", 409);
  }

  const [emAndamento] = await db()
    .select({ id: animacoes.id })
    .from(animacoes)
    .where(and(eq(animacoes.clienteId, clienteId), inArray(animacoes.estado, [...ESTADOS_EM_ANDAMENTO])))
    .limit(1);
  if (emAndamento) return recusa("em-andamento", 409);

  // Um vídeo pronto (ou que falhou) deste mesmo roteiro cede lugar ao novo: a marca fica com um por roteiro.
  const antigas = await db()
    .select()
    .from(animacoes)
    .where(and(eq(animacoes.clienteId, clienteId), eq(animacoes.roteiroId, roteiroId)));
  for (const antiga of antigas) await apagarAnimacao(antiga);

  let criada: Animacao;
  try {
    [criada] = await db()
      .insert(animacoes)
      .values({ clienteId, roteiroId, estado: "pedida", molde: MOLDE_PADRAO, cenas, foraDoVideo: deFora, duracaoS: duracaoS.toFixed(3), criadaPor: usuarioId })
      .returning();
  } catch (erro) {
    if (ehViolacaoDeUnicidade(erro)) return recusa("em-andamento", 409);
    logger.error({ err: erro, clienteId, roteiroId }, "animacao: o pedido nao foi gravado");
    return recusa("nao-comecou", 500);
  }
  await enfileirarSemTravar(criada.id, "previa");
  return { ok: true, animacao: vistaDaAnimacao(criada) };
}

/** "Aprovar e fazer o final": só de uma prévia pronta da marca. A troca é um UPDATE condicional, então dois toques seguidos enfileiram uma vez só. */
export async function aprovarAnimacao(clienteId: number, animacaoId: number): Promise<ResultadoDaAnimacao<{ animacao: VistaDaAnimacao }>> {
  if (!animacaoLiberadaParaMarca(clienteId)) return recusa("nao-achou", 404);
  const [linha] = await db()
    .update(animacoes)
    .set({ estado: "fazendo_final", progresso: null, tentativas: 0, atualizadaEm: new Date() })
    .where(and(eq(animacoes.id, animacaoId), eq(animacoes.clienteId, clienteId), eq(animacoes.estado, "previa_pronta")))
    .returning();
  if (!linha) {
    const [atual] = await db()
      .select({ id: animacoes.id })
      .from(animacoes)
      .where(and(eq(animacoes.id, animacaoId), eq(animacoes.clienteId, clienteId)));
    return atual ? recusa("nao-e-a-hora", 409) : recusa("nao-achou", 404);
  }
  await enfileirarSemTravar(linha.id, "final");
  return { ok: true, animacao: vistaDaAnimacao(linha) };
}

/** "Agora não" (na prévia) e o descarte de um vídeo que falhou: a animação e os arquivos saem. Nunca no meio de uma montagem. */
export async function dispensarAnimacao(clienteId: number, animacaoId: number): Promise<ResultadoDaAnimacao<object>> {
  if (!animacaoLiberadaParaMarca(clienteId)) return recusa("nao-achou", 404);
  const [linha] = await db()
    .select()
    .from(animacoes)
    .where(and(eq(animacoes.id, animacaoId), eq(animacoes.clienteId, clienteId)));
  if (!linha) return recusa("nao-achou", 404);
  if (linha.estado !== "previa_pronta" && linha.estado !== "falhou") return recusa("nao-e-a-hora", 409);
  await apagarAnimacao(linha);
  return { ok: true };
}

/** "Tentar de novo": de um vídeo que falhou. Se a prévia já tinha sido aprovada (a falha foi no final), volta direto ao final; senão, recomeça pela prévia. */
export async function tentarAnimacaoDeNovo(clienteId: number, animacaoId: number): Promise<ResultadoDaAnimacao<{ animacao: VistaDaAnimacao }>> {
  if (!animacaoLiberadaParaMarca(clienteId)) return recusa("nao-achou", 404);
  const [antes] = await db()
    .select()
    .from(animacoes)
    .where(and(eq(animacoes.id, animacaoId), eq(animacoes.clienteId, clienteId)));
  if (!antes) return recusa("nao-achou", 404);
  if (antes.estado !== "falhou") return recusa("nao-e-a-hora", 409);
  const perfil = antes.caminhoPrevia ? "final" : "previa";
  let linha: Animacao | undefined;
  try {
    [linha] = await db()
      .update(animacoes)
      .set({ estado: perfil === "final" ? "fazendo_final" : "pedida", progresso: null, tentativas: 0, motivo: null, codigoDoErro: null, atualizadaEm: new Date() })
      .where(and(eq(animacoes.id, animacaoId), eq(animacoes.clienteId, clienteId), eq(animacoes.estado, "falhou")))
      .returning();
  } catch (erro) {
    if (ehViolacaoDeUnicidade(erro)) return recusa("em-andamento", 409);
    throw erro;
  }
  if (!linha) return recusa("nao-e-a-hora", 409);
  await enfileirarSemTravar(linha.id, perfil);
  return { ok: true, animacao: vistaDaAnimacao(linha) };
}

/**
 * O arquivo que a pessoa pode tocar ou baixar: a prévia enquanto ela existe (pronta, ou o final sendo feito) e o final pronto. `null` para marca fora da lista, animação de outra marca ou arquivo que
 * ainda não existe.
 */
export async function arquivoDaAnimacaoParaVer(clienteId: number, animacaoId: number, tipo: "previa" | "final"): Promise<{ relativo: string } | null> {
  if (!animacaoLiberadaParaMarca(clienteId)) return null;
  const [linha] = await db()
    .select()
    .from(animacoes)
    .where(and(eq(animacoes.id, animacaoId), eq(animacoes.clienteId, clienteId)));
  if (!linha) return null;
  const relativo = tipo === "previa" ? (linha.estado === "previa_pronta" || linha.estado === "fazendo_final" ? linha.caminhoPrevia : null) : linha.estado === "final_pronta" ? linha.caminhoFinal : null;
  return relativo ? { relativo } : null;
}
