/**
 * Cliente fino da Groq (etapa 8): so transcricao. Achado 3 da revisao do motor (01/10/2026):
 * antes, todo video era transcrito com `language: "pt"` fixo (Groq nao traduz como o YouTube,
 * mas forcar o idioma errado piora a transcricao e engana a extracao, que lia o resultado ruim e
 * concluia "pt-BR" para um video em outro idioma). Agora so `idiomaConhecido` quando quem chamou
 * ja confia nele (vindo de `videos.idioma`, nunca um chute); sem ele, a Groq detecta sozinha.
 * `response_format: "verbose_json"` (em vez de "json") devolve o idioma detectado e, por trecho,
 * `no_speech_prob`; confirmado rodando contra a API de verdade em 02/10/2026 (dois clipes de 3s,
 * tom puro e silencio, US$ 0,0001 no total): `language` vem por extenso em ingles ("English"),
 * nunca um codigo ISO.
 */
import { createReadStream } from "node:fs";

import Groq from "groq-sdk";

import { type Idioma } from "@/config/idioma";
import type { PalavraFalada } from "@/edicao/tipos";
import { config } from "@/lib/config";
import { custoDaTranscricaoGroqUsd, registrarCustoExterno } from "@/servicos/custos-externos";

export class ErroGroq extends Error {}

/** A transcrição passou do tempo limite (M5c): conta como falha do vídeo, com nova tentativa em alguns dias, e o job segue. */
export class ErroGroqTempoLimite extends ErroGroq {}

let cliente: Groq | null = null;

function groq(): Groq {
  if (!cliente) cliente = new Groq({ apiKey: config.transcricao.groqKey });
  return cliente;
}

/**
 * `language` do verbose_json vem por extenso ("English", "Portuguese", "Spanish"), nunca um
 * codigo ISO (confirmado rodando contra a API de verdade); aceita tambem um eventual codigo de
 * duas letras, caso a Groq mude o formato. Qualquer outro idioma detectado vira "outro"; sem
 * `language` nenhum, null (nao chuta).
 */
function idiomaDoRotuloGroq(rotulo: string | undefined): Idioma {
  if (!rotulo) return null;
  const chave = rotulo.trim().toLowerCase();
  if (chave === "pt" || chave === "portuguese") return "pt";
  if (chave === "en" || chave === "english") return "en";
  if (chave === "es" || chave === "spanish") return "es";
  return "outro";
}

/**
 * Media de `no_speech_prob` entre os trechos: alta significa que o audio nao tinha fala de
 * verdade (so musica, silencio ou ruido), mesmo que o texto devolvido pareca letra de musica
 * transcrita como se fosse fala. Acima disso a transcricao sai vazia por codigo, o que já basta
 * para o video cair na fila do caminho sem fala (`transcricao` com menos de
 * `TAMANHO_MINIMO_TRANSCRICAO`, `extracao-comum.ts`). Limiar não calibrado com dados reais ainda
 * (a revisão do motor já registrou que não deu para verificar só lendo o código); ajustar depois
 * de medir contra vídeo real com música.
 */
const LIMIAR_SEM_FALA = 0.6;

type SegmentoVerboseJson = { no_speech_prob: number; start?: number; end?: number };
type PalavraVerboseJson = { word: string; start: number; end: number };
/** O SDK da Groq só declara `{ text }` no tipo `Transcription`, mesmo para `verbose_json`; o resto vem a mais, sem tipo (confirmado rodando contra a API de verdade). */
type RespostaVerboseJson = { text: string; language?: string; duration?: number; segments?: SegmentoVerboseJson[]; words?: PalavraVerboseJson[] };

/** O que muda de uma chamada para outra: o idioma, o "prompt" de nomes (a Groq usa para acertar a grafia) e se quer o tempo de cada palavra (E47 PR 2). */
type OpcoesDaChamada = { idiomaConhecido?: "pt" | "en" | "es"; prompt?: string; palavras?: boolean; detalheDoCusto?: Record<string, unknown> };

export type ResultadoTranscricaoGroq = {
  texto: string;
  /** Idioma que a Groq detectou nessa chamada, não o que já estava em `videos.idioma` antes. */
  idiomaDetectado: Idioma;
  /** true quando a média de `no_speech_prob` passou do limiar; `texto` já vem vazio nesse caso. */
  semFala: boolean;
};

/**
 * `limiteMs`: o prazo da chamada INTEIRA, com as tentativas que o SDK faz sozinho (429, 5xx). Sem isto, um upload pendurado segurava
 * o `transcrever` até o prazo de 4 horas da fila (M5c). O prazo vale de duas formas: o `AbortSignal` que o SDK respeita, e uma
 * corrida contra o próprio sinal, porque o SDK dorme o `retry-after` de um 429 sem olhar o sinal (só confere o aborto depois de
 * acordar) e um 429 com `retry-after` de minutos seguraria o job por esse tempo (achado da revisão independente do M5c, reproduzido
 * contra um servidor falso: limite de 1,5 s, espera de 12 s). A chamada que perde a corrida acorda depois, vê o sinal abortado e
 * morre sozinha, sem nova tentativa; as tentativas curtas do SDK (um 429 de poucos segundos) continuam valendo. Só o teste passa o limite.
 */
export async function transcreverAudio(
  caminhoArquivo: string,
  idiomaConhecido?: "pt" | "en" | "es",
  limiteMs: number = config.transcricao.groqLimiteS * 1000,
): Promise<ResultadoTranscricaoGroq> {
  const { resultado, semFala } = await chamarGroq(caminhoArquivo, { idiomaConhecido }, limiteMs);
  return {
    texto: semFala ? "" : resultado.text.trim(),
    idiomaDetectado: idiomaDoRotuloGroq(resultado.language),
    semFala,
  };
}

async function chamarGroq(
  caminhoArquivo: string,
  opcoes: OpcoesDaChamada,
  limiteMs: number,
): Promise<{ resultado: RespostaVerboseJson; semFala: boolean; duracaoS: number; custoUsd: number }> {
  const { idiomaConhecido } = opcoes;
  const sinal = AbortSignal.timeout(limiteMs);
  let aoAbortar: (() => void) | undefined;
  const corte = new Promise<never>((_resolver, rejeitar) => {
    aoAbortar = () => rejeitar(sinal.reason);
    if (sinal.aborted) aoAbortar();
    else sinal.addEventListener("abort", aoAbortar, { once: true });
  });
  // Com um limite que já nasce vencido, o corte rejeita antes de a corrida existir: sem dono, seria uma rejeição não tratada.
  corte.catch(() => undefined);
  try {
    const chamada = groq().audio.transcriptions.create(
      {
        model: config.transcricao.groqModel,
        file: createReadStream(caminhoArquivo),
        ...(idiomaConhecido ? { language: idiomaConhecido } : {}),
        ...(opcoes.prompt ? { prompt: opcoes.prompt } : {}),
        ...(opcoes.palavras ? { timestamp_granularities: ["word", "segment"] as ("word" | "segment")[] } : {}),
        response_format: "verbose_json",
      },
      { signal: sinal, timeout: limiteMs },
    );
    // Se o corte ganhar, a chamada ainda pode rejeitar depois (ao acordar do retry-after): sem isto seria uma rejeição sem dono.
    chamada.catch(() => undefined);
    const resultado = (await Promise.race([chamada, corte])) as unknown as RespostaVerboseJson;

    const segmentos = resultado.segments ?? [];
    // O custo da transcrição (custo que falta no admin): por segundo de áudio, que a Groq devolve em `duration`; sem ele, o fim do último trecho. Registrar nunca derruba a transcrição.
    const duracaoS = typeof resultado.duration === "number" ? resultado.duration : Math.max(0, ...segmentos.map((s) => s.end ?? 0));
    const custoUsd = custoDaTranscricaoGroqUsd(duracaoS);
    await registrarCustoExterno({
      fonte: "groq",
      custoUsd,
      unidades: duracaoS / 60,
      unidade: "minutos",
      origemDoCusto: "estimado",
      detalhe: { modelo: config.transcricao.groqModel, segundos: Math.round(duracaoS), ...(opcoes.detalheDoCusto ?? {}) },
    });
    const mediaSemFala = segmentos.length > 0 ? segmentos.reduce((soma, s) => soma + s.no_speech_prob, 0) / segmentos.length : 0;
    const semFala = mediaSemFala >= LIMIAR_SEM_FALA;

    return { resultado, semFala, duracaoS, custoUsd };
  } catch (erro) {
    // O limite estourou: o nosso sinal abortou (a corrida ou o SDK), ou o SDK deu o seu próprio "timeout" (`APIConnectionTimeoutError`).
    // Olha o nome da CLASSE, não `.name`: o SDK não define `.name` nas suas classes (sempre "Error"), e nada aqui pode depender de
    // importar a classe do SDK. Os dois são o mesmo caso.
    const nomeDaClasse = typeof erro === "object" && erro !== null ? (erro as { constructor?: { name?: string } }).constructor?.name : undefined;
    if (sinal.aborted || nomeDaClasse === "APIConnectionTimeoutError") {
      throw new ErroGroqTempoLimite(`transcricao da Groq passou de ${Math.round(limiteMs / 1000)} s (tempo limite)`);
    }
    throw new ErroGroq(`transcricao da Groq falhou: ${String(erro)}`);
  } finally {
    if (aoAbortar) sinal.removeEventListener("abort", aoAbortar);
  }
}

// ---------------------------------------------------------------------------
// E47 PR 2: a fala com o tempo de cada palavra
// ---------------------------------------------------------------------------

export type ResultadoComPalavras = {
  palavras: PalavraFalada[];
  idiomaDetectado: Idioma;
  /** Em segundos de áudio, como a Groq mediu. */
  duracaoS: number;
  /** O custo estimado em dólar desta chamada (já registrado em `custos_externos`). */
  custoUsd: number;
  semFala: boolean;
};

/**
 * As palavras da Groq viram `PalavraFalada`: sem as vazias, com o texto aparado e `abreTrecho` na primeira palavra de cada trecho (o segmento da Groq), que o motor de legenda usa
 * para a maiúscula. Pura, para testar sem rede.
 */
export function palavrasDaResposta(palavras: PalavraVerboseJson[] | undefined, segmentos: SegmentoVerboseJson[] | undefined): PalavraFalada[] {
  const lista: PalavraFalada[] = [];
  for (const p of palavras ?? []) {
    const texto = typeof p.word === "string" ? p.word.trim() : "";
    if (!texto || !Number.isFinite(p.start) || !Number.isFinite(p.end)) continue;
    lista.push({ texto, inicio: p.start, fim: Math.max(p.end, p.start) });
  }
  const abertura = new Set<number>();
  for (const seg of segmentos ?? []) {
    if (typeof seg.start !== "number") continue;
    const i = lista.findIndex((p) => p.inicio >= (seg.start as number) - 0.05);
    if (i >= 0) abertura.add(i);
  }
  if (lista.length > 0) abertura.add(0);
  for (const i of abertura) lista[i].abreTrecho = true;
  return lista;
}

/**
 * Transcreve com o tempo de cada palavra (`timestamp_granularities: word`, que a Groq só devolve em `verbose_json`) e um "prompt" de nomes (marca, produtos, cidade) para a grafia certa.
 * O prazo, o corte e o registro do custo são os mesmos de `transcreverAudio`.
 */
export async function transcreverComPalavras(
  caminhoArquivo: string,
  opcoes: { idiomaConhecido?: "pt" | "en" | "es"; prompt?: string; detalheDoCusto?: Record<string, unknown> } = {},
  limiteMs: number = config.transcricao.groqLimiteS * 1000,
): Promise<ResultadoComPalavras> {
  const { resultado, semFala, duracaoS, custoUsd } = await chamarGroq(caminhoArquivo, { ...opcoes, palavras: true }, limiteMs);
  return {
    palavras: semFala ? [] : palavrasDaResposta(resultado.words, resultado.segments),
    idiomaDetectado: idiomaDoRotuloGroq(resultado.language),
    duracaoS,
    custoUsd,
    semFala,
  };
}
