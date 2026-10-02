import { z } from "zod";

import { puxaParaEnum } from "../enums";
import type { EsforcoIA, NivelIA } from "../tipos";

import { REGRAS_REEL, REGRAS_SHORT, REGRAS_STORY, REGRAS_TIKTOK, textoRegras } from "./regras-formato";

/**
 * Os tres temas do dia (escopo 5.2, camada rapida; usado a partir da etapa
 * 10). puxaParaEnum vem de src/ia/enums.ts para o valor interno nao aparecer
 * como texto literal aqui (ver comentario la).
 *
 * 1.2.0 (dia 1 da etapa 14, `PROXIMO.md`): notícia vira evidência citável,
 * com id próprio, igual a vídeo. Antes, com vídeo zero e notícia relevante,
 * o job chamava o modelo pedindo evidência de uma lista de ids vazia, que
 * sempre reprova.
 *
 * 1.3.0 (achado da leitura previa do Fable, 09/09/2026, correcao 3 do
 * `PROXIMO.md`): video sem conta dona (Hashtag Search da Meta) entra na
 * mesma lista "subindo hoje", mas sem numero de velocidade, so com o texto
 * "assunto em alta na hashtag": nao ha conta para comparar, entao pesa "na
 * media", nunca como se fosse mais fora da curva que os demais.
 *
 * 1.4.0 (R1, item 3, pedido do Gustavo em 29/09/2026): `porQue` pode citar a regra numerada de
 * plataforma que explica por que o vídeo passou do normal (ex. "os três primeiros segundos
 * mostram o resultado"), sem o número da regra (revisão do Fable no PR #89: `porQue` é lido
 * pelo cliente, e o código "R-IG-REEL-03" é jargão, regra 6 do projeto; a ordem original do
 * Fable pedia o número, erro dele), só quando a regra de fato explica a evidência; nunca uma
 * lista solta de regras. O tema é do nicho inteiro, não de um cliente com uma rede escolhida, por
 * isso a referência inclui as quatro bases curtas (Reels, TikTok, Short, Story) juntas; vídeo
 * longo (`R-YT-VIDEO`) fica de fora, não é o formato deste produto.
 *
 * Achado 11 da revisão do motor (01/10/2026): o lembrete de acentuação só existia no sistema
 * estável; sem retentativa aqui (esta tarefa não passa por `gerarComVerificacao`), a última linha
 * da entrada já é o lugar definitivo, sem risco de a segunda tentativa empurrar ele para o meio.
 * Versão 1.5.0.
 */
export const versao = "1.5.0";
export const nivel: NivelIA = "forte";
export const esforco: EsforcoIA | undefined = "medium";

/** Mesmo texto-base de `roteiro.ts`/`avaliarTema.ts`/`avaliarResposta.ts`. */
const LEMBRETE_ACENTUACAO =
  "Escreva os três temas inteiros com a acentuação correta do português (você, não, já, também, é, está).";

const temaDoDia = z.object({
  titulo: z.string(),
  descricao: z.string(),
  porQue: z.string(),
  evidencias: z.array(z.number()),
  evidenciasNoticias: z.array(z.number()).default([]),
  puxaPara: puxaParaEnum,
});

export const schema = z.object({
  temas: z.array(temaDoDia).length(3),
});

export type SaidaTemasDoDia = z.infer<typeof schema>;

export function montarSistemaEstavel(dados: { modeloNicho: string }): string {
  return `Você sugere três temas de vídeo (não títulos, temas) para donos de pequeno negócio
de um nicho, a partir do que está subindo mais rápido nos últimos dias e das notícias
relevantes do setor. Cada tema cita ids de vídeo ou de notícia do banco como evidência;
nunca sugira um tema sem pelo menos um id de evidência, de vídeo ou de notícia.

Para cada tema, diga em duas linhas por que ele está funcionando agora, e classifique qual
efeito ele mais puxa: mais gente conhecer o negócio, as pessoas lembrarem dele quando
precisarem, ou gente ser chamado para comprar. Quando uma das regras numeradas abaixo explicar
de verdade por que a evidência passou do normal (o gancho, a duração, a chamada final, o jeito
de editar), use a ideia dela dentro da própria frase, em português de gente (ex. "os três
primeiros segundos já mostram o resultado"); nunca escreva o número da regra (R-IG-REEL-03 e
parecidos): quem lê é o dono do negócio, e o código não diz nada para ele. Nunca force uma
explicação quando nenhuma regra explica o porquê, e nunca liste regras soltas fora da frase.

Regras de plataforma, para usar quando couber (os números servem só para você se localizar):

${textoRegras(REGRAS_REEL)}

${textoRegras(REGRAS_TIKTOK)}

${textoRegras(REGRAS_SHORT)}

${textoRegras(REGRAS_STORY)}

Sem travessão, sem emoji, sem jargão em título nem em descrição.

Modelo do nicho:
${dados.modeloNicho}

Escreva em português do Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: {
  subindoHoje: { id: number; assunto: string; velocidadeRelativa: number }[];
  /** Sem conta dona (Hashtag Search da Meta): sem numero de velocidade, so o assunto. */
  semDono?: { id: number; assunto: string }[];
  noticias: { id: number; titulo: string; resumo: string }[];
}): string {
  const linhasSubindo = dados.subindoHoje.map((v) => `id ${v.id}: ${v.assunto} (velocidade ${v.velocidadeRelativa.toFixed(1)}x)`);
  const linhasSemDono = (dados.semDono ?? []).map((v) => `id ${v.id}: ${v.assunto} (assunto em alta na hashtag)`);
  const listaVideos = [...linhasSubindo, ...linhasSemDono].join("\n") || "nenhum video subindo hoje";

  const listaNoticias =
    dados.noticias.length > 0
      ? dados.noticias.map((n) => `noticia ${n.id}: ${n.titulo}: ${n.resumo}`).join("\n")
      : "nenhuma noticia relevante hoje";

  return `Subindo hoje:\n${listaVideos}\n\nNoticias do nicho:\n${listaNoticias}\n\n${LEMBRETE_ACENTUACAO}`;
}
