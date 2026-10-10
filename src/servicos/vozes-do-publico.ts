/**
 * E28, as vozes do público de um setor, do lado de quem LÊ (o job que as escreve é `jobs/comentarios-semana.ts`): o que está em
 * `nichos.vozes`, enquanto vale, em três formas. (1) As perguntas e reclamações para a tela (`perguntasDoPublico`: só o que passou
 * do piso de comentários iguais, no máximo três). (2) O bloco numerado que entra nos prompts do tema do dia e do roteiro
 * (`vozesParaOPrompt`). (3) A chave de cada voz (`chaveDaVoz`), para uma tela mandar "responder esta" sem o servidor confiar no texto
 * que veio do navegador: a voz é achada de novo pelas vozes do setor (`vozPelaChave`).
 *
 * Regra de todas as formas: a plataforma de origem vai junto de cada achado, e quem escreve o texto nunca diz "o público comenta X"
 * sem dizer onde (o público de um vídeo do YouTube não é o do Reels).
 */
import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { nichos, type PerguntaDeOrigemGuardada, type Plataforma, type VozDoPublico, type VozesDoSetor } from "@/db/schema";
import { formaDeComparar } from "@/lib/comentarios";
import { config } from "@/lib/config";
import { logger } from "@/lib/log";

import { limparParaPrompt } from "./noticias-assuntos";

const DIA_MS = 24 * 60 * 60 * 1000;

export type TipoDaVoz = "duvida" | "objecao" | "pedido";

/** Uma voz como a tela e os prompts a usam: com a chave estável, o tipo e as plataformas de onde veio. */
export type VozComChave = { chave: string; tipo: TipoDaVoz; texto: string; vezes: number; plataformas: Plataforma[] };

/** O nome da plataforma como a pessoa lê. */
export function nomeDaPlataforma(plataforma: Plataforma): string {
  if (plataforma === "youtube") return "YouTube";
  if (plataforma === "instagram") return "Instagram";
  return "TikTok";
}

/** "YouTube", "YouTube e Instagram", "YouTube, Instagram e TikTok". */
export function listaDePlataformas(plataformas: Plataforma[]): string {
  const nomes = [...new Set(plataformas)].map(nomeDaPlataforma);
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** A chave de uma voz: o tipo e a frase, sem acento, maiúscula nem pontuação. Estável de uma rodada para a outra enquanto a frase for a mesma. */
export function chaveDaVoz(tipo: TipoDaVoz, texto: string): string {
  return createHash("sha1").update(`${tipo}|${formaDeComparar(texto)}`).digest("hex").slice(0, 12);
}

/** As vozes só valem por `vozesValidasPorDias` dias: depois disso a rotina semanal não rodou, e "esta semana" seria mentira. */
export function vozesValidas(vozes: VozesDoSetor | null, vozesEm: Date | null, agora: Date = new Date()): VozesDoSetor | null {
  if (!vozes || !vozesEm) return null;
  if (agora.getTime() - vozesEm.getTime() > config.regras.vozesValidasPorDias * DIA_MS) return null;
  return vozes;
}

/** Devolve só o que tem a forma esperada: lista que falta vira vazia, e a voz sem frase ou sem número sai (o que está no banco pode vir de uma leitura velha ou malformada). */
function inteiras(lista: VozDoPublico[] | undefined): VozDoPublico[] {
  return Array.isArray(lista) ? lista.filter((v) => typeof v?.texto === "string" && Number.isFinite(v?.vezes)) : [];
}

/** As vozes de um setor e de quando foram lidas. */
export type VozesLidas = { vozes: VozesDoSetor; em: Date };

/**
 * As vozes do setor, enquanto valem, com a data da leitura (os prompts dizem "lidos em 11 de outubro": a voz é um retrato daquela semana, nunca um fato do setor). Nulo sem leitura
 * ainda, com a leitura velha, e se a leitura vier malformada: um setor sem vozes (a Overtake, com poucos vídeos do YouTube acima do piso, pode fechar a semana sem nenhuma) segue
 * como antes, e nunca é isto que impede um roteiro.
 */
export async function vozesDoSetor(nichoId: number, agora: Date = new Date()): Promise<VozesLidas | null> {
  try {
    const [linha] = await db().select({ vozes: nichos.vozes, vozesEm: nichos.vozesEm }).from(nichos).where(eq(nichos.id, nichoId));
    const vozes = vozesValidas(linha?.vozes ?? null, linha?.vozesEm ?? null, agora);
    if (!vozes || !linha?.vozesEm) return null;
    return { vozes: { ...vozes, duvidas: inteiras(vozes.duvidas), objecoes: inteiras(vozes.objecoes), pedidos: inteiras(vozes.pedidos) }, em: linha.vozesEm };
  } catch (erro) {
    logger.warn({ err: erro, nichoId }, "nao foi possivel ler as vozes do publico do setor; segue sem elas");
    return null;
  }
}

const PLATAFORMAS_VALIDAS: Plataforma[] = ["youtube", "instagram", "tiktok"];

/** As plataformas de uma voz como estão no banco: só as três que existem, sem repetir; o que não é lista vira vazio (uma leitura antiga ou malformada não derruba a tela). */
function plataformasDaVoz(valor: unknown): Plataforma[] {
  return Array.isArray(valor) ? [...new Set(valor.filter((p): p is Plataforma => PLATAFORMAS_VALIDAS.includes(p as Plataforma)))] : [];
}

/** Os ids de vídeo de uma voz como estão no banco: só números inteiros, sem repetir, do menor para o maior. */
function videosDaVoz(valor: unknown): number[] {
  return Array.isArray(valor) ? [...new Set(valor.filter((id): id is number => Number.isInteger(id)))].sort((a, b) => a - b) : [];
}

function comChave(tipo: TipoDaVoz, v: VozDoPublico): VozComChave {
  return { chave: chaveDaVoz(tipo, v.texto), tipo, texto: v.texto, vezes: v.vezes, plataformas: plataformasDaVoz(v.plataformas) };
}

/**
 * Das listas pedidas, as vozes agrupadas por chave, do mais repetido para o menos. Duas vozes de mesma chave (a mesma frase, que o modelo deixou em grupos separados) somam antes de
 * olhar o piso: a soma dividida não pode derrubar uma pergunta que passaria.
 */
function agruparVozes(vozes: VozesDoSetor, tipos: TipoDaVoz[]): (VozComChave & { videos: number[] })[] {
  const lista: (VozComChave & { videos: number[] })[] = [];
  const entra = (tipo: TipoDaVoz, origem: VozDoPublico[] | undefined) => {
    if (tipos.includes(tipo)) lista.push(...inteiras(origem).map((v) => ({ ...comChave(tipo, v), videos: videosDaVoz(v.videos) })));
  };
  entra("duvida", vozes.duvidas);
  entra("objecao", vozes.objecoes);
  entra("pedido", vozes.pedidos);
  const porChave = new Map<string, VozComChave & { videos: number[] }>();
  for (const v of lista) {
    const atual = porChave.get(v.chave);
    if (atual) {
      atual.vezes += v.vezes;
      atual.plataformas = [...new Set([...atual.plataformas, ...v.plataformas])].sort();
      atual.videos = [...new Set([...atual.videos, ...v.videos])].sort((x, y) => x - y);
    } else {
      porChave.set(v.chave, { ...v, plataformas: [...v.plataformas] });
    }
  }
  return [...porChave.values()].sort((a, b) => b.vezes - a.vezes || a.texto.localeCompare(b.texto));
}

/** Das listas pedidas, só o que passou do piso de comentários iguais (a pergunta de um comentário só nunca aparece). */
function passaramDoPiso(vozes: VozesDoSetor, tipos: TipoDaVoz[]): VozComChave[] {
  return agruparVozes(vozes, tipos)
    .filter((v) => v.vezes >= config.regras.vozesMinimoDeComentarios)
    .map((v) => ({ chave: v.chave, tipo: v.tipo, texto: v.texto, vezes: v.vezes, plataformas: v.plataformas }));
}

/** Uma voz como o admin a mostra: tudo o que foi lido, com os vídeos de onde veio e se passou do piso (a tela e os prompts só usam o que passou, e dentro do que passou, as mais repetidas). */
export type VozDoAdmin = VozComChave & { videos: number[]; passouDoPiso: boolean };

/**
 * Para a seção "Vozes do público" do admin do setor: as três listas como a tela as agrupa (a mesma frase em dois grupos soma), do mais repetido para o menos, SEM cortar abaixo do piso, para
 * quem ajusta o piso ver o que ficou de fora. Lê o que está no banco como está, sem a validade de 14 dias: a seção diz de quando é a leitura e se ela ainda vale.
 */
export function vozesParaOAdmin(vozes: VozesDoSetor | null): { duvidas: VozDoAdmin[]; objecoes: VozDoAdmin[]; pedidos: VozDoAdmin[] } {
  const lista = (tipo: TipoDaVoz): VozDoAdmin[] =>
    vozes ? agruparVozes(vozes, [tipo]).map((v) => ({ ...v, passouDoPiso: v.vezes >= config.regras.vozesMinimoDeComentarios })) : [];
  return { duvidas: lista("duvida"), objecoes: lista("objecao"), pedidos: lista("pedido") };
}

/**
 * "O que o público pergunta", para a tela: perguntas e reclamações (o pedido do tipo "faz um sobre" não tem lugar no desenho do passo
 * 25) que passaram do piso, até `maximo`. Com menos de três mostra as que houver; sem nenhuma, a lista vem vazia e o bloco some.
 */
export function perguntasDoPublico(vozes: VozesDoSetor | null, maximo = 3): VozComChave[] {
  if (!vozes) return [];
  return passaramDoPiso(vozes, ["duvida", "objecao"]).slice(0, maximo);
}

/**
 * A pergunta que a pessoa prendeu ao Tema livre, achada de novo nas vozes DO SETOR (`nichoId` é o da marca, nunca o que veio do navegador), passando do piso e ainda dentro da validade:
 * a cópia que o roteiro guarda (`PerguntaDeOrigemGuardada`) ou nulo. Sem chave, sem setor ou sem voz, nulo: o tema segue como um tema livre comum.
 */
export async function perguntaDoPublicoPelaChave(nichoId: number | null, chave: string | undefined, agora: Date = new Date()): Promise<PerguntaDeOrigemGuardada | null> {
  if (!nichoId || !chave) return null;
  const lidas = await vozesDoSetor(nichoId, agora);
  const voz = vozPelaChave(lidas?.vozes ?? null, chave);
  if (!lidas || !voz) return null;
  // A voz sem plataforma gravada (uma leitura antiga) herda a do setor; nunca fica sem dizer de onde vem.
  const plataformas = voz.plataformas.length > 0 ? voz.plataformas : (lidas.vozes.plataformas ?? []);
  return { chave: voz.chave, tipo: voz.tipo, texto: voz.texto, vezes: voz.vezes, plataformas, lidaEm: lidas.em.toISOString() };
}

/**
 * A voz de uma chave que a pessoa pode prender a um vídeo, passando do piso (a chave que veio de um navegador não vale sozinha). Só pergunta e reclamação: são as duas que a tela oferece
 * ("Responder em vídeo"); um pedido ("faz um sobre X") serve ao prompt geral, mas uma chave dele forjada não prende nada.
 */
export function vozPelaChave(vozes: VozesDoSetor | null, chave: string): VozComChave | null {
  if (!vozes) return null;
  return passaramDoPiso(vozes, ["duvida", "objecao"]).find((v) => v.chave === chave) ?? null;
}

/** Uma voz numerada para o prompt: o número é o que o modelo devolve, e o código o traduz de volta. */
export type VozNumerada = VozComChave & { numero: number };

const NOME_DO_TIPO: Record<TipoDaVoz, string> = { duvida: "pergunta", objecao: "reclamação", pedido: "pedido" };

/**
 * As vozes como linhas de DADO para um prompt, uma por linha: "pergunta 1 | 14 comentários | YouTube | Serve em tecido de
 * camurça?". O texto já é a nossa frase (conferida em `conferirLeitura`), e passa de novo pela limpeza de prompt (sem `<` nem `>`).
 */
export function linhasDasVozes(vozes: VozNumerada[]): string {
  return vozes
    .map((v) => `${NOME_DO_TIPO[v.tipo]} ${v.numero} | ${v.vezes} comentários | ${listaDePlataformas(v.plataformas) || "plataforma não informada"} | ${limparParaPrompt(v.texto, 160)}`)
    .join("\n");
}

/**
 * As vozes que entram nos prompts: até 3 dúvidas, 2 reclamações e 2 pedidos, numeradas de 1, as mais repetidas primeiro. O tema do dia pede `pedidos: false`: ele responde a uma
 * pergunta ou a uma reclamação, e "faz um sobre X" não é pergunta que um tema responda.
 */
export function vozesParaOPrompt(vozes: VozesDoSetor | null, opcoes: { pedidos?: boolean } = {}): VozNumerada[] {
  if (!vozes) return [];
  const duvidas = passaramDoPiso(vozes, ["duvida"]).slice(0, 3);
  const objecoes = passaramDoPiso(vozes, ["objecao"]).slice(0, 2);
  const pedidos = opcoes.pedidos === false ? [] : passaramDoPiso(vozes, ["pedido"]).slice(0, 2);
  return [...duvidas, ...objecoes, ...pedidos].map((v, i) => ({ ...v, numero: i + 1 }));
}

/** De que plataformas vieram as vozes de um bloco de prompt, sem repetir ("YouTube" ou "YouTube e Instagram"). */
export function plataformasDasVozes(vozes: VozNumerada[]): string {
  return listaDePlataformas(vozes.flatMap((v) => v.plataformas));
}

/**
 * O que as telas (Hoje, Referências e Criar) recebem de "O que o público pergunta": as perguntas e reclamações que passaram do piso (no máximo três), e o que a frase do pé precisa para contar a
 * verdade (quantos vídeos entraram, de que plataformas, e o dia da leitura por extenso). Dados simples, para atravessar de Server Component para Client Component.
 */
export type PerguntasDaTela = {
  perguntas: { chave: string; texto: string; tipo: "duvida" | "objecao"; vezes: number }[];
  videos: number;
  plataformas: Plataforma[];
  lidasEm: string;
};

/**
 * As perguntas da semana para uma tela. Nunca lança: sem setor, sem leitura, com a leitura velha, sem nenhuma que passou do piso, ou com qualquer falha, devolve nulo e a tela segue sem o
 * bloco (o setor pequeno que fechou a semana sem voz não vê erro, vê a tela de sempre).
 */
export async function perguntasDaTelaSemFalha(nichoId: number | null, agora: Date = new Date()): Promise<PerguntasDaTela | null> {
  if (!nichoId) return null;
  try {
    const lidas = await vozesDoSetor(nichoId, agora);
    const perguntas = perguntasDoPublico(lidas?.vozes ?? null);
    if (!lidas || perguntas.length === 0) return null;
    const plataformas = lidas.vozes.plataformas?.length ? lidas.vozes.plataformas : [...new Set(perguntas.flatMap((p) => p.plataformas))];
    return {
      perguntas: perguntas.map((p) => ({ chave: p.chave, texto: p.texto, tipo: p.tipo === "objecao" ? "objecao" : "duvida", vezes: p.vezes })),
      videos: lidas.vozes.videos,
      plataformas,
      lidasEm: new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(lidas.em),
    };
  } catch (erro) {
    logger.warn({ err: erro, nichoId }, "nao foi possivel montar as perguntas do publico para a tela; a tela segue sem elas");
    return null;
  }
}
