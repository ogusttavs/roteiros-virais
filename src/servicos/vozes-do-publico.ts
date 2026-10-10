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
import { nichos, type Plataforma, type VozDoPublico, type VozesDoSetor } from "@/db/schema";
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
    // Devolve só o que tem a forma esperada: listas que faltam viram vazias, e a voz sem frase ou sem número sai.
    const inteiras = (lista: VozDoPublico[] | undefined) => (Array.isArray(lista) ? lista.filter((v) => typeof v?.texto === "string" && Number.isFinite(v?.vezes)) : []);
    return { vozes: { ...vozes, duvidas: inteiras(vozes.duvidas), objecoes: inteiras(vozes.objecoes), pedidos: inteiras(vozes.pedidos) }, em: linha.vozesEm };
  } catch (erro) {
    logger.warn({ err: erro, nichoId }, "nao foi possivel ler as vozes do publico do setor; segue sem elas");
    return null;
  }
}

function comChave(tipo: TipoDaVoz, v: VozDoPublico): VozComChave {
  return { chave: chaveDaVoz(tipo, v.texto), tipo, texto: v.texto, vezes: v.vezes, plataformas: v.plataformas ?? [] };
}

/**
 * Das três listas, só o que passou do piso de comentários iguais (a pergunta de um comentário só nunca aparece), do mais repetido para o menos. Duas vozes de mesma chave (a mesma
 * frase, que o modelo deixou em grupos separados) somam antes de olhar o piso: a soma dividida não pode derrubar uma pergunta que passaria.
 */
function passaramDoPiso(vozes: VozesDoSetor, tipos: TipoDaVoz[]): VozComChave[] {
  const lista: VozComChave[] = [];
  if (tipos.includes("duvida")) lista.push(...(vozes.duvidas ?? []).map((v) => comChave("duvida", v)));
  if (tipos.includes("objecao")) lista.push(...(vozes.objecoes ?? []).map((v) => comChave("objecao", v)));
  if (tipos.includes("pedido")) lista.push(...(vozes.pedidos ?? []).map((v) => comChave("pedido", v)));
  const porChave = new Map<string, VozComChave>();
  for (const v of lista) {
    const atual = porChave.get(v.chave);
    if (atual) {
      atual.vezes += v.vezes;
      atual.plataformas = [...new Set([...atual.plataformas, ...v.plataformas])].sort();
    } else {
      porChave.set(v.chave, { ...v, plataformas: [...v.plataformas] });
    }
  }
  return [...porChave.values()].filter((v) => v.vezes >= config.regras.vozesMinimoDeComentarios).sort((a, b) => b.vezes - a.vezes || a.texto.localeCompare(b.texto));
}

/**
 * "O que o público pergunta", para a tela: perguntas e reclamações (o pedido do tipo "faz um sobre" não tem lugar no desenho do passo
 * 25) que passaram do piso, até `maximo`. Com menos de três mostra as que houver; sem nenhuma, a lista vem vazia e o bloco some.
 */
export function perguntasDoPublico(vozes: VozesDoSetor | null, maximo = 3): VozComChave[] {
  if (!vozes) return [];
  return passaramDoPiso(vozes, ["duvida", "objecao"]).slice(0, maximo);
}

/** A voz de uma chave, nas três listas, passando do piso (a chave que veio de um navegador não vale sozinha). */
export function vozPelaChave(vozes: VozesDoSetor | null, chave: string): VozComChave | null {
  if (!vozes) return null;
  return passaramDoPiso(vozes, ["duvida", "objecao", "pedido"]).find((v) => v.chave === chave) ?? null;
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
