/**
 * E52 (PR 2), a leitura dos vídeos longos: o que é puro e deve ser provado sem banco nem IA. (1) `transcricaoComTempos`: o texto entra no prompt com marcas de tempo APROXIMADAS,
 * porque a transcrição guardada é só o texto (a posição de cada palavra, na proporção da duração). (2) `conferirLeituraDoLongo`: o que o modelo devolve passa por aqui antes de
 * virar `videos.analise_longa`: tempos dentro do vídeo e crescendo, capítulos da descrição do dono por cima dos do modelo (o código manda, o modelo descreve), limites de tamanho.
 * A saída que não tem estrutura mínima (menos de três capítulos) é recusada, e o vídeo fica para a nova tentativa.
 */
import type { AnaliseVideoLonga } from "@/db/schema";
import type { SaidaExtrairVideoLongo } from "@/ia/prompts/extrairVideoLongo";
import { type CapituloDaDescricao, tempoDeCapitulo } from "@/lib/capitulos-da-descricao";

/** De quanto em quanto tempo uma marca entra no texto. Um minuto: o bastante para o modelo se situar, e pouco para não pesar a entrada. */
export const PASSO_DAS_MARCAS_S = 60;
/** O texto cortado: um longo de 40 minutos tem uns 40 mil caracteres; o que passa de 60 mil é repetição ou música com letra. */
export const MAX_CARACTERES_DO_TEXTO = 60_000;
/** Menos de três capítulos não é estrutura de vídeo longo. */
export const MINIMO_DE_CAPITULOS_DA_LEITURA = 3;
export const MAXIMO_DE_CAPITULOS_DA_LEITURA = 12;
const MAXIMO_DE_LACOS = 8;
const MAXIMO_DE_SAIDAS = 3;
/** A lista do dono não é cortada em doze (esse é o teto do que o modelo propõe): um vídeo de meia hora pode ter vinte capítulos de verdade. Quarenta é só um teto de segurança. */
const MAXIMO_DE_CAPITULOS_DA_DESCRICAO = 40;
/** Quanto antes do começo de um capítulo do dono um capítulo do modelo ainda conta como o mesmo (o modelo lê pela posição aproximada no texto). */
const TOLERANCIA_DO_PAR_S = 20;

/**
 * O texto com uma marca `[m:ss]` a cada `PASSO_DAS_MARCAS_S` segundos, pela posição da palavra no texto inteiro (a palavra `i` de `n` está em `i / n` da duração). O corte por
 * tamanho acontece DEPOIS de calcular os tempos, para o que sobra continuar com a posição certa. A primeira marca é sempre `[0:00]`.
 */
export function transcricaoComTempos(texto: string, duracaoS: number, passoS = PASSO_DAS_MARCAS_S, maximoDeCaracteres = MAX_CARACTERES_DO_TEXTO): string {
  const palavras = texto.split(/\s+/).filter((p) => p !== "");
  if (palavras.length === 0 || duracaoS <= 0) return palavras.join(" ");

  const partes: string[] = [];
  let proximaMarcaS = 0;
  let tamanho = 0;
  for (let i = 0; i < palavras.length; i += 1) {
    const segundo = (i / palavras.length) * duracaoS;
    let trecho = palavras[i];
    if (segundo >= proximaMarcaS) {
      trecho = `\n[${tempoDeCapitulo(segundo)}] ${trecho}`;
      // Salta as marcas que o texto não alcançou (um silêncio longo no meio, ou uma palavra só para vários minutos).
      proximaMarcaS = (Math.floor(segundo / passoS) + 1) * passoS;
    }
    if (tamanho + trecho.length + 1 > maximoDeCaracteres) {
      partes.push("\n[o texto continua além deste ponto]");
      break;
    }
    partes.push(trecho);
    tamanho += trecho.length + 1;
  }
  return partes.join(" ").replace(/ \n/g, "\n").trim();
}

function limitarSegundo(segundos: number, duracaoS: number): number {
  if (!Number.isFinite(segundos)) return 0;
  return Math.min(Math.max(0, Math.round(segundos)), Math.max(0, Math.round(duracaoS)));
}

/** Tira o caractere de controle (que o jsonb do Postgres recusa) e junta os espaços. */
function texto(valor: string): string {
  return valor.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
}

type ContextoDaLeitura = {
  duracaoS: number;
  /** Os capítulos que o dono escreveu na descrição (`lerCapitulosDaDescricao`); vazio quando não escreveu. */
  capitulosDaDescricao: CapituloDaDescricao[];
  versaoPrompt: string;
};

/**
 * O que o modelo devolveu, conferido por código. Devolve nulo quando não sobra estrutura de verdade (menos de três capítulos), e o job trata como falha da leitura.
 *
 * Os capítulos da descrição, quando existem, são os capítulos da leitura: o tempo e o nome são do dono, e do modelo só vêm o que cada capítulo faz e o gancho que segura até o
 * próximo (do capítulo que começa mais perto do mesmo segundo). Sem a lista do dono, valem os do modelo, com os tempos limitados à duração, em ordem, sem repetir o início, e o
 * primeiro em zero.
 */
export function conferirLeituraDoLongo(saida: SaidaExtrairVideoLongo, contexto: ContextoDaLeitura): AnaliseVideoLonga | null {
  const { duracaoS } = contexto;
  const doModelo = saida.capitulos
    // O que o modelo põe no fim do vídeo ou depois dele não é um capítulo (grampeado, viraria um de duração zero).
    .filter((c) => Number.isFinite(c.inicioS) && c.inicioS < duracaoS)
    .map((c) => ({ inicioS: limitarSegundo(c.inicioS, duracaoS), nome: texto(c.nome), oQueFaz: texto(c.oQueFaz), gancho: c.gancho === null ? null : texto(c.gancho) }))
    .sort((a, b) => a.inicioS - b.inicioS);

  let capitulos: AnaliseVideoLonga["capitulos"];
  let origemDosCapitulos: AnaliseVideoLonga["origemDosCapitulos"];
  if (contexto.capitulosDaDescricao.length >= MINIMO_DE_CAPITULOS_DA_LEITURA) {
    // A lista do dono vale para os tempos e os nomes, mas a leitura só existe se o modelo também achou estrutura: sem isso, a coluna ficaria gravada com todo capítulo vazio e o
    // vídeo nunca mais seria lido.
    if (doModelo.length < MINIMO_DE_CAPITULOS_DA_LEITURA) return null;
    origemDosCapitulos = "descricao";
    const doDono = contexto.capitulosDaDescricao.slice(0, MAXIMO_DE_CAPITULOS_DA_DESCRICAO);
    const usados = new Set<number>();
    capitulos = doDono.map((c, i) => {
      const fim = i + 1 < doDono.length ? doDono[i + 1].inicioS : duracaoS;
      // O capítulo do modelo que começa dentro do capítulo do dono (com uma folga para trás), um para um: o do dono que o modelo não cobriu fica sem "o que faz" em vez de
      // herdar o texto de um capítulo vizinho.
      const indice = doModelo.findIndex((m, idx) => !usados.has(idx) && m.inicioS >= c.inicioS - TOLERANCIA_DO_PAR_S && m.inicioS < fim);
      const par = indice >= 0 ? doModelo[indice] : null;
      if (indice >= 0) usados.add(indice);
      return { inicioS: limitarSegundo(c.inicioS, duracaoS), nome: texto(c.titulo), oQueFaz: par?.oQueFaz ?? "", gancho: par?.gancho ?? null };
    });
  } else {
    origemDosCapitulos = "leitura";
    const vistos = new Set<number>();
    capitulos = [];
    for (const c of doModelo) {
      if (c.nome === "" || vistos.has(c.inicioS)) continue;
      vistos.add(c.inicioS);
      capitulos.push(c);
      if (capitulos.length >= MAXIMO_DE_CAPITULOS_DA_LEITURA) break;
    }
    // O primeiro capítulo começa em zero (o vídeo começa em zero), qualquer que seja o segundo que o modelo escreveu.
    if (capitulos.length > 0) capitulos[0] = { ...capitulos[0], inicioS: 0 };
  }

  if (capitulos.length < MINIMO_DE_CAPITULOS_DA_LEITURA) return null;
  // O último não segura ninguém até o próximo: não há próximo.
  capitulos = capitulos.map((c, i) => (i === capitulos.length - 1 ? { ...c, gancho: null } : c));

  const lacos = saida.lacos
    .map((l) => {
      const abertoEmS = limitarSegundo(l.abertoEmS, duracaoS);
      const pago = l.pagoEmS === null ? null : limitarSegundo(l.pagoEmS, duracaoS);
      // Pagar antes de prometer não é laço pago: fica como "nunca pagou".
      return { abertoEmS, pagoEmS: pago !== null && pago >= abertoEmS ? pago : null, oQue: texto(l.oQue) };
    })
    .filter((l) => l.oQue !== "")
    .sort((a, b) => a.abertoEmS - b.abertoEmS)
    .slice(0, MAXIMO_DE_LACOS);

  const ondeSairia = saida.ondeSairia
    .map((s) => ({ segundo: limitarSegundo(s.segundo, duracaoS), porQue: texto(s.porQue) }))
    .filter((s) => s.porQue !== "")
    .sort((a, b) => a.segundo - b.segundo)
    .slice(0, MAXIMO_DE_SAIDAS);

  return {
    versaoPrompt: contexto.versaoPrompt,
    origemDosCapitulos,
    assunto: texto(saida.assunto),
    abertura: {
      promessa: texto(saida.abertura.promessa),
      entregaAteS: saida.abertura.entregaAteS === null ? null : limitarSegundo(saida.abertura.entregaAteS, duracaoS),
      tipo: saida.abertura.tipo,
    },
    capitulos,
    lacos,
    ondeSairia,
    fechamento: { oQueFaz: texto(saida.fechamento.oQueFaz), apontaParaProximoVideo: saida.fechamento.apontaParaProximoVideo },
    porQueFuncionou: texto(saida.porQueFuncionou),
  };
}
