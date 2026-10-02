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
import { config } from "@/lib/config";

export class ErroGroq extends Error {}

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

type SegmentoVerboseJson = { no_speech_prob: number };
/** O SDK da Groq só declara `{ text }` no tipo `Transcription`, mesmo para `verbose_json`; o resto vem a mais, sem tipo (confirmado rodando contra a API de verdade). */
type RespostaVerboseJson = { text: string; language?: string; segments?: SegmentoVerboseJson[] };

export type ResultadoTranscricaoGroq = {
  texto: string;
  /** Idioma que a Groq detectou nessa chamada, não o que já estava em `videos.idioma` antes. */
  idiomaDetectado: Idioma;
  /** true quando a média de `no_speech_prob` passou do limiar; `texto` já vem vazio nesse caso. */
  semFala: boolean;
};

export async function transcreverAudio(caminhoArquivo: string, idiomaConhecido?: "pt" | "en" | "es"): Promise<ResultadoTranscricaoGroq> {
  try {
    const resultado = (await groq().audio.transcriptions.create({
      model: config.transcricao.groqModel,
      file: createReadStream(caminhoArquivo),
      ...(idiomaConhecido ? { language: idiomaConhecido } : {}),
      response_format: "verbose_json",
    })) as unknown as RespostaVerboseJson;

    const segmentos = resultado.segments ?? [];
    const mediaSemFala = segmentos.length > 0 ? segmentos.reduce((soma, s) => soma + s.no_speech_prob, 0) / segmentos.length : 0;
    const semFala = mediaSemFala >= LIMIAR_SEM_FALA;

    return {
      texto: semFala ? "" : resultado.text.trim(),
      idiomaDetectado: idiomaDoRotuloGroq(resultado.language),
      semFala,
    };
  } catch (erro) {
    throw new ErroGroq(`transcricao da Groq falhou: ${String(erro)}`);
  }
}
