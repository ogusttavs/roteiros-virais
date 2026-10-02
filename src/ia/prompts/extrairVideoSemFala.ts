import { z } from "zod";

import { TIPOS_CONTEUDO } from "@/db/schema";

import { corrigirTipoConteudoInvalido } from "../tipo-video-seguro";
import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * M3, item 2: a ficha fixa de um vídeo (mesmo papel de `extrairVideo`), para o setor que aceita
 * "vídeo sem fala vale" (`nichos.video_sem_fala_vale`, `reguaDoSetor`). Sem transcrição (é
 * exatamente por isso que o vídeo caiu aqui: `TAMANHO_MINIMO_TRANSCRICAO` não bateu), a análise
 * sai dos quadros extraídos e da legenda do post. Modelo forte, com imagens, mesmo padrão de
 * `analisarVisual`.
 *
 * Não inclui `idioma` nem `tipoAbertura` (ao contrário de `extrairVideo`): sem fala não há
 * idioma falado para julgar (o vídeo mantém o idioma já detectado na coleta por título e
 * descrição, `detectarIdioma`), e o tipo de abertura fica de fora nesta primeira rodada por
 * falta de sinal confiável só com a legenda e os quadros; `videos.tipoAbertura` continua nulo
 * para estes vídeos, como já é para todo vídeo extraído antes daquela coluna existir.
 *
 * Tipo de vídeo (1.1.0, achado 5 da revisão do motor, 01/10/2026): sem isto, repost e meme sem
 * fala entravam como evidência e referência igual a um vídeo original, porque
 * `videos.serveDeModelo` ficava nulo (conta como "pode usar") para todo vídeo deste caminho.
 * Mesmos campos e mesmo critério de `extrairVideo.ts`, já nos quadros e na legenda, sem chamada
 * nova: o modelo já olha a tela inteira para montar o resto da ficha.
 *
 * Achado 11 da revisão do motor (01/10/2026): lembrete de acentuação como última linha da
 * entrada; esta tarefa não tem retentativa nenhuma hoje, então a posição já nasce definitiva.
 * Versão 1.2.0.
 *
 * M5b, item 2 (02/10/2026): `formato` ganha `.catch("outro")`, mesmo conserto e mesmo motivo de
 * `extrairVideo.ts` (um valor fora da lista não pode reprovar a ficha inteira). Versão 1.3.0.
 *
 * Tipo de vídeo inválido (1.4.0, E43 item 0, achado da prova com chave real do PR #102, mesmo
 * conserto de `extrairVideo.ts`): `tipoConteudo` fora da lista vira "original" com `serveDeModelo`
 * forçado para `false` (`corrigirTipoConteudoInvalido`, `ia/tipo-video-seguro.ts`), em vez de
 * reprovar a ficha inteira ou confiar num `serveDeModelo` que o modelo escreveu junto de uma
 * classificação inventada.
 */
export const versao = "1.4.0";
export const nivel: NivelIA = "forte";
export const esforco: EsforcoIA | undefined = "medium";

/** Mesmo texto-base de `roteiro.ts`/`avaliarTema.ts`/`avaliarResposta.ts`. */
const LEMBRETE_ACENTUACAO =
  "Escreva a ficha inteira com a acentuação correta do português (você, não, já, também, é, está), mesmo que o título ou a legenda do post estejam sem acento.";

const schemaBruto = z.object({
  assunto: z.string(),
  /** M3, item 2: sem fala, o gancho descreve o que aparece na tela, não o que é dito. */
  gancho: z.string(),
  estrutura: z.string(),
  fechamento: z.string(),
  chamadaFinal: z.string(),
  // M5b, item 2: mesmo achado de `extrairVideo.ts`, mesmo conserto (valor fora da lista vira
  // "outro" em vez de perder a ficha inteira).
  formato: z.enum(["fala_para_camera", "podcast", "caixinha", "esquete", "outro"]).catch("outro"),
  porQueFuncionou: z.string(),
  etiquetas: z.array(z.string()),
  pertenceAoNicho: z.boolean(),
  motivoNicho: z.string(),
  tipoConteudo: z.enum(TIPOS_CONTEUDO),
  serveDeModelo: z.boolean(),
});

export const schema = z.preprocess(corrigirTipoConteudoInvalido, schemaBruto);

export type SaidaExtrairVideoSemFala = z.infer<typeof schema>;

export function montarSistemaEstavel(): string {
  return `Você olha os quadros extraídos de um vídeo curto sem fala (ou com fala baixa demais para
transcrever) que ficou fora da curva numa conta vigiada de um nicho de dono de pequeno negócio,
mais a legenda que a pessoa escreveu no post, e extrai uma ficha fixa:

- assunto: o tema do vídeo em poucas palavras.
- gancho: o que aparece na tela nos primeiros segundos, o mais próximo possível do que se vê
  (nunca o que é dito: este vídeo não tem fala para descrever).
- estrutura: como o vídeo se desenrola, em uma frase.
- fechamento: como o vídeo termina.
- chamadaFinal: o que o vídeo pede para quem assiste fazer no final, se pedir algo (pela legenda
  ou por um texto que aparece na tela).
- formato: fala_para_camera, podcast, caixinha, esquete ou outro.
- porQueFuncionou: sua leitura de por que esse vídeo rendeu, em uma frase.
- etiquetas: de três a seis palavras-chave para achar este vídeo depois numa busca.
- pertenceAoNicho: a conta é vigiada por pertencer ao nicho, mas nem todo vídeo que ela posta
  fala do assunto do nicho (pode ser um anúncio de outro produto, humor sem relação, outro
  assunto qualquer). Diga true só quando o vídeo fala mesmo do assunto do nicho descrito abaixo;
  false quando não fala.
- motivoNicho: uma frase curta explicando a decisão de pertenceAoNicho.
- tipoConteudo: o que este vídeo é, para quem decide se ele pode virar modelo de estrutura de
  um roteiro:
  - "original": quem aparece é quem publicou o vídeo, mostrando o próprio trabalho ou produto.
  - "recorte": um trecho de outra pessoa, de um programa ou de um podcast, reproduzido por
    quem publicou (não é a própria cena de quem publicou).
  - "meme": humor, dublagem, montagem ou um formato de "POV" (você na pele de alguém ou algo).
  - "noticia": um fato mostrado, sem quem publicou aparecer defendendo um ponto de vista próprio.
  Sinais de "recorte" ou "meme": o título ou a legenda tem "POV", emoji de riso, uma legenda de
  outra página sobreposta na tela, ou os quadros mostram uma tela de outro vídeo sendo reproduzida
  (duplo enquadramento, marca d'água de outra conta).
- serveDeModelo: true só para "original" (a estrutura de como esse vídeo mostra algo é um bom
  exemplo a seguir); false para "recorte", "meme" e "noticia" (o vídeo ainda pode mostrar o que
  está em alta no assunto, mas a forma como ele é mostrado não é um modelo de roteiro).

Sem travessão, sem emoji. Escreva em português do Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: { titulo: string; legenda: string; duracaoS: number; nomeNicho: string; termosNicho: string[] }): string {
  return `Nicho: ${dados.nomeNicho} (termos: ${dados.termosNicho.join(", ")})\n\nTitulo: ${dados.titulo}\nDuracao: ${dados.duracaoS} segundos\nLegenda do post: ${dados.legenda || "(sem legenda)"}\n\nOs quadros do video estao anexados.\n\n${LEMBRETE_ACENTUACAO}`;
}
