/**
 * E47 PR 3: da decisão do modelo (índices de palavra) ao plano de edição (o `Edl` do motor e a legenda). Tudo puro: nenhuma rede, nenhum banco, nenhum arquivo.
 *
 * O modelo decide por NÚMERO de palavra, nunca por segundo. Aqui o número vira intervalo de tempo (do início da primeira palavra ao fim da última) e o motor de corte (`planejarCortes`)
 * faz o resto: acha o ponto de corte pelo áudio, encurta as pausas, abre a voz e fecha com respiro. `validarDecisao` é a primeira trava: uma decisão com índice que não existe, trechos
 * fora de ordem ou quase a fala inteira cortada volta ao modelo com o motivo em vez de virar vídeo.
 */
import { AJUSTES_DA_EDICAO } from "@/config/edicao";
import type { DecisaoDaEdicao } from "@/db/schema";
import { EMOJI, TRAVESSAO } from "@/lib/regras-de-texto";

import { planejarCortes } from "./cortes";
import { montarLegendas } from "./legendas";
import { ErroEdicao, type ConfigCorte, type Edl, type Energia, type IntervaloEditorial, type Legendas, type PalavraFalada } from "./tipos";
import { normalizar } from "./transcricao";

/** Quantas correções de legenda o modelo pode pedir de uma vez. */
export const MAXIMO_DE_CORRECOES = 12;

function ehIndice(valor: unknown, total: number): valor is number {
  return typeof valor === "number" && Number.isInteger(valor) && valor >= 0 && valor < total;
}

/**
 * Os problemas da decisão, em frases que o próprio modelo entende na segunda tentativa. Lista vazia é decisão utilizável. Não olha título nem correções (isso é da conferência em
 * `verificacao.ts`): só a parte que o motor precisa para trabalhar.
 */
export function validarDecisao(decisao: DecisaoDaEdicao, palavras: PalavraFalada[]): string[] {
  const problemas: string[] = [];
  const total = palavras.length;
  if (decisao.trechos.length === 0) return ["a decisão não tem nenhum trecho que fica"];

  let anterior = -1;
  let mantidas = 0;
  decisao.trechos.forEach((t, k) => {
    const nome = `trecho ${k + 1}`;
    if (!ehIndice(t.deIndice, total) || !ehIndice(t.ateIndice, total)) {
      problemas.push(`${nome}: usa um número de palavra que não existe (a lista vai de 0 a ${total - 1})`);
      return;
    }
    if (t.deIndice > t.ateIndice) {
      problemas.push(`${nome}: o começo (${t.deIndice}) vem depois do fim (${t.ateIndice})`);
      return;
    }
    if (t.deIndice <= anterior) {
      problemas.push(`${nome}: começa na palavra ${t.deIndice}, mas o trecho anterior já foi até a ${anterior}; os trechos têm de seguir a ordem da gravação, sem se sobrepor`);
    }
    anterior = Math.max(anterior, t.ateIndice);
    mantidas += t.ateIndice - t.deIndice + 1;
  });
  if (problemas.length > 0) return problemas;

  const g = decisao.gancho;
  if (!ehIndice(g.deIndice, total) || !ehIndice(g.ateIndice, total) || g.deIndice > g.ateIndice) {
    problemas.push("a abertura escolhida (gancho) usa números de palavra que não existem ou fora de ordem");
  } else {
    const primeiro = decisao.trechos[0];
    if (g.deIndice < primeiro.deIndice || g.ateIndice > primeiro.ateIndice) {
      problemas.push(`a abertura escolhida (palavras ${g.deIndice} a ${g.ateIndice}) tem de estar dentro do primeiro trecho (palavras ${primeiro.deIndice} a ${primeiro.ateIndice}), porque é ela que abre o vídeo`);
    }
  }

  if (total >= AJUSTES_DA_EDICAO.palavrasParaConferirOQueFica && mantidas / total < AJUSTES_DA_EDICAO.fracaoMinimaDaFala) {
    problemas.push(
      `a decisão deixa só ${mantidas} de ${total} palavras (${Math.round((mantidas / total) * 100)}%); tire só o que é repetição, erro ou enrolação, e mantenha o resto da fala`,
    );
  }
  return problemas;
}

/** Os trechos que ficam, em tempo do bruto, para o motor de corte. Trechos colados (sem palavra tirada no meio) e sem transição viram um só. */
export function intervalosDaDecisao(decisao: DecisaoDaEdicao, palavras: PalavraFalada[]): IntervaloEditorial[] {
  const unidos: DecisaoDaEdicao["trechos"] = [];
  for (const t of decisao.trechos) {
    const ultimo = unidos[unidos.length - 1];
    if (ultimo && t.deIndice === ultimo.ateIndice + 1 && t.transicao === "nenhuma") {
      unidos[unidos.length - 1] = { ...ultimo, ateIndice: t.ateIndice };
    } else {
      unidos.push(t);
    }
  }
  return unidos.map((t, k) => {
    const intervalo: IntervaloEditorial = { de: palavras[t.deIndice].inicio, ate: palavras[t.ateIndice].fim, motivo: t.motivo };
    if (k > 0 && t.transicao !== "nenhuma") intervalo.transicao = t.transicao;
    return intervalo;
  });
}

/** O trecho de palavras (índice inicial) onde a sequência `de` aparece na fala, ou -1. Compara sem acento, sem maiúscula e sem pontuação. */
function onde(palavras: PalavraFalada[], de: string): number {
  // Palavra por palavra, como a legenda faz (`aplicarCorrecoes`): "Dr.Uosh" é uma palavra só, e "Dr. Uosh" são duas.
  const alvo = de.split(/\s+/).filter(Boolean).map(normalizar);
  if (alvo.length === 0 || alvo.some((a) => a === "")) return -1;
  const todas = palavras.map((p) => normalizar(p.texto));
  for (let i = 0; i + alvo.length <= todas.length; i++) {
    if (alvo.every((w, k) => todas[i + k] === w)) return i;
  }
  return -1;
}

/**
 * Os pares [de, para] que valem: o `de` existe de verdade na fala (o modelo às vezes lembra a palavra errada) e o `para` é um texto limpo (sem travessão nem emoji, de 1 a 60 letras,
 * diferente do que já está). Quantos foram deixados de fora vai em `ignoradas`.
 */
export function correcoesAplicaveis(decisao: DecisaoDaEdicao, palavras: PalavraFalada[]): { pares: Array<[string, string]>; ignoradas: number } {
  const pares: Array<[string, string]> = [];
  let ignoradas = 0;
  for (const c of decisao.correcoesDaLegenda.slice(0, MAXIMO_DE_CORRECOES)) {
    const de = c.de.replace(/\s+/g, " ").trim();
    const para = c.para.replace(/\s+/g, " ").trim();
    const util = de !== "" && para !== "" && para.length <= 60 && de !== para && !TRAVESSAO.test(para) && !EMOJI.test(para) && onde(palavras, de) >= 0;
    if (util) pares.push([de, para]);
    else ignoradas += 1;
  }
  ignoradas += Math.max(0, decisao.correcoesDaLegenda.length - MAXIMO_DE_CORRECOES);
  return { pares, ignoradas };
}

export type PlanoDaEdicao =
  | { ok: true; edl: Edl; legenda: Legendas; correcoes: Array<[string, string]>; correcoesIgnoradas: number }
  | { ok: false; problemas: string[] };

/** A decisão, as palavras e a curva de energia viram o plano de corte e a legenda. Nunca lança: o que o motor recusa volta como problema. */
export function montarPlano(entrada: { palavras: PalavraFalada[]; energia: Energia; decisao: DecisaoDaEdicao }): PlanoDaEdicao {
  const { palavras, energia, decisao } = entrada;
  const problemas = validarDecisao(decisao, palavras);
  if (problemas.length > 0) return { ok: false, problemas };

  const config: ConfigCorte = {
    preset: AJUSTES_DA_EDICAO.preset,
    zoomEmCortes: AJUSTES_DA_EDICAO.zoomEmCortes,
    selecoes: intervalosDaDecisao(decisao, palavras),
  };
  let edl: Edl;
  try {
    edl = planejarCortes({ palavras, energia, config });
  } catch (erro) {
    if (erro instanceof ErroEdicao) return { ok: false, problemas: [`o motor de corte recusou a decisão: ${erro.message}`] };
    throw erro;
  }
  const { pares, ignoradas } = correcoesAplicaveis(decisao, palavras);
  const legenda = montarLegendas({ palavras, edl, correcoes: pares, opcoes: { estilo: AJUSTES_DA_EDICAO.estiloDaLegenda } });
  return { ok: true, edl, legenda, correcoes: pares, correcoesIgnoradas: ignoradas };
}
