import { z } from "zod";

import { FORMATOS_DO_VIDEO } from "@/config/formatos";
import { TIPOS_ABERTURA, TIPOS_CONTEUDO } from "@/db/schema";

import { corrigirTipoConteudoInvalido } from "../tipo-video-seguro";
import type { EsforcoIA, NivelIA } from "../tipos";

import { definicoesFormato } from "./definicoesFormato";
import { definicoesTipoAbertura } from "./definicoesTipoAbertura";

/**
 * Extracao em dois passos (escopo 5.9.4): transforma a transcricao de um
 * video coletado num JSON fixo. O modelo forte nunca le a transcricao
 * bruta, so este JSON. Modelo barato, em lote (etapa 8).
 *
 * `pertenceAoNicho`/`motivoNicho` (etapa 10, ajuste da revisao da etapa 9):
 * a vigilancia (etapa 7) escolhe conta, nao assunto, e tudo que a conta
 * posta entra na coleta; sem esse filtro, o que "esta subindo" podia citar
 * um anuncio de escova em ingles ou um video de carro so porque veio da
 * mesma conta vigiada. `montarEntrada` passa o nome e os termos do nicho
 * para o modelo decidir se o video de fato fala do assunto do nicho.
 *
 * Traducao (1.3.0, acabamento visual 2): a base tem conta de fora do
 * Brasil, e duas analises reais saem em ingles ou so com o gancho no
 * idioma original (achado do Gustavo no iPad, 06/09). `extrair-coleta.ts`
 * reprova com uma checagem barata de idioma (`src/lib/idioma.ts`) e refaz
 * uma vez com a instrucao de traducao reforcada.
 *
 * Idioma da fala (1.4.0, V2b item 3, escopo 5.11: o Brasil primeiro): a
 * extracao le a transcricao inteira, entao e a fonte mais confiavel do
 * idioma original do video (mais que o titulo/descricao, que
 * `detectarIdioma` usa na coleta, `src/config/idioma.ts`). O campo novo
 * sobrescreve `videos.idioma` por cima da deteccao por titulo em
 * `extrair-coleta.ts`. Portugues de Portugal ("pt-PT") conta como
 * internacional na proporcao 70/30 (decisao do Gustavo), por isso e um
 * valor a parte de "pt-BR", nunca "pt".
 *
 * Tipo de abertura (1.5.0, V4, roteiro sem vicio, escopo 5.12, item 5): o
 * gancho ja vinha sendo extraido literalmente; `tipoAbertura` classifica ele
 * num enum fechado (`db/schema.ts`, `TIPOS_ABERTURA`), para o roteiro poder
 * repetir o TIPO que funcionou sem repetir a FRASE. `extrair-coleta.ts`
 * sobrescreve `videos.tipoAbertura`, fora do jsonb `analise` (mesmo caminho
 * de `idioma`).
 *
 * Tipo de video (1.6.0, H4, achado do Gustavo em producao em 01/10, o
 * caso do roteiro 12: a referencia escolhida foi um meme repostado por um
 * canal pequeno de contabilidade, "a referencia e um meme e o Bruno nunca
 * faria um video desse"): `tipoConteudo` e `serveDeModelo` dizem se este
 * video pode virar modelo de estrutura de um roteiro (original) ou so sinal
 * de assunto (recorte, meme, noticia). `extrair-coleta.ts` e
 * `extracao-comum.ts` sobrescrevem `videos.tipoConteudo`/`serveDeModelo`,
 * fora do jsonb `analise` (mesmo caminho de `idioma` e `tipoAbertura`), para
 * `evidenciaParaRoteiro` (`servicos/pesquisa.ts`) filtrar por SQL.
 *
 * Achado 11 da revisão do motor (01/10/2026): lembrete de acentuação como última linha da
 * entrada, mesmo texto-base de `roteiro.ts`/`avaliarTema.ts`/`avaliarResposta.ts`; esta tarefa
 * roda em lote (sem `gerarComVerificacao`), então a retentativa própria (`retentarEmPortugues`,
 * `extracao-comum.ts`) já pede tradução explícita por conta própria, sem risco de empurrar isto
 * para o meio do texto. Versão 1.7.0.
 *
 * Achado 2 da revisão do motor, M5b item 2 (02/10/2026, conferência de produção: 2 de 92 saídas
 * do lote reprovaram o schema inteiro por um valor fora da lista em `formato` ou `tipoAbertura`):
 * os dois campos ganham `.catch("outro")`, sem mudar o texto do pedido (o modelo continua sendo
 * instruído a escolher um dos valores da lista; o `.catch` só evita perder a ficha inteira quando
 * ele erra). Versão 1.8.0.
 *
 * Legenda e conta (1.9.0, M5b, achado 7 da revisão do motor, 01/10/2026): a extração só via até
 * 90 caracteres de título (`videos.titulo`, derivado da primeira linha da legenda em TikTok e
 * Instagram, `servicos/normalizadores/titulo.ts`) e a transcrição, mas o prompt já pedia para
 * reconhecer "POV" e legenda de outra página sobreposta na tela, sinais que vivem no resto da
 * legenda, fora do título. `montarEntrada` passa a receber a legenda inteira do post
 * (`videos.descricao`, até 400 caracteres) e o @ da conta.
 *
 * Idioma e tipo de vídeo inválidos (1.10.0, E43 item 0, achado da prova com chave real do PR
 * #102): `idioma` fora da lista também reprovava a ficha inteira (`formato`/`tipoAbertura` já
 * tinham `.catch`, este ficou de fora); ganha `.catch("outro")`. `tipoConteudo` fora da lista
 * ganha o mesmo tratamento, mas acoplado a `serveDeModelo` (`corrigirTipoConteudoInvalido`,
 * `ia/tipo-video-seguro.ts`): vira "original" com `serveDeModelo` forçado para `false`, nunca
 * confiando no que o modelo escreveu para esse campo junto de uma classificação inventada.
 *
 * Formato do vídeo (1.11.0, E44 PR 1, `pesquisa/estudo-formatos.md`): `formatoCatalogo` classifica o vídeo numa lista fechada (as treze chaves do cliente mais
 * os valores que nunca servem de modelo, `config/formatos.ts`), gravado em `videos.formato_catalogo` por `extracao-comum.ts`. Valor fora da lista ou ausente vira nulo (a ficha
 * continua aprovada, como no M5b; "outro" fica só para quando o modelo o escolhe); o `formato` antigo de cinco valores e o `tipoConteudo` continuam até o PR 2.
 */
export const versao = "1.11.0";
export const nivel: NivelIA = "barato";
export const esforco: EsforcoIA | undefined = undefined;

/** Mesmo texto-base de `roteiro.ts`/`avaliarTema.ts`/`avaliarResposta.ts`. */
const LEMBRETE_ACENTUACAO =
  "Escreva a ficha inteira com a acentuação correta do português (você, não, já, também, é, está), mesmo que a transcrição original esteja em outro idioma ou sem acento.";

const schemaBruto = z.object({
  assunto: z.string(),
  gancho: z.string(),
  estrutura: z.string(),
  fechamento: z.string(),
  chamadaFinal: z.string(),
  // M5b, item 2 (achado da conferência de 02/10: 2 de 92 saídas do lote de extração reprovaram o
  // schema inteiro por um valor fora da lista nestes dois campos). `.catch("outro")` troca o valor
  // desconhecido por "outro" em vez de perder a ficha inteira do vídeo; os dois campos já têm
  // "outro" na própria lista.
  formato: z.enum(["fala_para_camera", "podcast", "caixinha", "esquete", "outro"]).catch("outro"),
  porQueFuncionou: z.string(),
  etiquetas: z.array(z.string()),
  pertenceAoNicho: z.boolean(),
  motivoNicho: z.string(),
  idioma: z.enum(["pt-BR", "pt-PT", "en", "es", "outro"]).catch("outro"),
  tipoAbertura: z.enum(TIPOS_ABERTURA).catch("outro"),
  tipoConteudo: z.enum(TIPOS_CONTEUDO),
  serveDeModelo: z.boolean(),
  // Valor fora da lista ou ausente vira NULO (a ficha continua aprovada): "outro" é um valor legítimo quando o modelo o escolhe, e gravá-lo no lugar de um erro tiraria o vídeo
  // da evidência de toda marca sem que nada o reclassificasse. Nulo passa pelo corte da H4 e a reclassificação o pega de volta.
  formatoCatalogo: z.enum(FORMATOS_DO_VIDEO).nullable().catch(null),
});

export const schema = z.preprocess(corrigirTipoConteudoInvalido, schemaBruto);

export type SaidaExtrairVideo = z.infer<typeof schema>;

export function montarSistemaEstavel(): string {
  return `Você lê a transcrição de um vídeo curto que ficou fora da curva numa conta vigiada de
um nicho de dono de pequeno negócio, e extrai uma ficha fixa. A transcrição pode estar em
outra língua; a ficha inteira, incluindo o gancho, sai sempre em português do Brasil. Nunca
copie nem deixe uma frase no idioma original, nem o gancho: traduza mantendo o sentido
literal e o tom.

- assunto: o tema do vídeo em poucas palavras.
- gancho: a frase ou cena dos primeiros segundos, o mais próxima possível do que apareceu.
- estrutura: como o vídeo se desenrola, em uma frase.
- fechamento: como o vídeo termina.
- chamadaFinal: o que o vídeo pede para quem assiste fazer no final, se pedir algo.
- formato: fala_para_camera, podcast, caixinha, esquete ou outro.
- porQueFuncionou: sua leitura de por que esse vídeo rendeu, em uma frase.
- etiquetas: de três a seis palavras-chave para achar este vídeo depois numa busca.
- pertenceAoNicho: a conta é vigiada por pertencer ao nicho, mas nem todo vídeo que ela posta
  fala do assunto do nicho (pode ser um anúncio de outro produto, humor sem relação, outro
  assunto qualquer). Diga true só quando o vídeo fala mesmo do assunto do nicho descrito
  abaixo; false quando não fala.
- motivoNicho: uma frase curta explicando a decisão de pertenceAoNicho.
- idioma: o idioma falado na transcrição original, antes de qualquer tradução sua: "pt-BR"
  (português do Brasil), "pt-PT" (português de Portugal ou de outro país lusófono), "en"
  (inglês), "es" (espanhol) ou "outro" (qualquer outro idioma). Julgue pelo sotaque, pelo
  vocabulário e pelas expressões da transcrição, nunca pelo que você escreveu na ficha, que
  sai sempre em português do Brasil.
- tipoAbertura: como os primeiros segundos do vídeo começam, um destes oito tipos:

${definicoesTipoAbertura()}

- tipoConteudo: o que este vídeo é, para quem decide se ele pode virar modelo de estrutura de
  um roteiro:
  - "original": quem aparece e fala é quem publicou o vídeo, falando com as próprias palavras.
  - "recorte": um trecho de outra pessoa, de um programa ou de um podcast, reproduzido por
    quem publicou (não é a própria fala original de quem publicou).
  - "meme": humor, dublagem, montagem ou um formato de "POV" (você na pele de alguém ou algo).
  - "noticia": um fato relatado, sem quem publicou aparecer defendendo um ponto de vista próprio.
  Sinais de "recorte" ou "meme": o título ou a legenda tem "POV", emoji de riso, uma legenda de
  outra página sobreposta na tela, ou quem fala se apresenta com um nome ou um papel que não
  combina com o que se espera do dono de um negócio pequeno falando da própria experiência.
- serveDeModelo: true só para "original" (a estrutura de como esse vídeo conta algo é um bom
  exemplo a seguir); false para "recorte", "meme" e "noticia" (o vídeo ainda pode mostrar o que
  está em alta no assunto, mas a forma como ele é contado não é um modelo de roteiro).

- formatoCatalogo: o formato do vídeo, UM destes valores exatos (escolha o que melhor descreve
  como o vídeo é feito, olhando o título, a legenda e a transcrição):

${definicoesFormato()}

  Na dúvida entre um formato e "outro", escolha o formato mais próximo; "outro" só quando nada
  descreve o vídeo. Um vídeo de outra pessoa reaproveitado é "recorte_de_outro", nunca um formato do cliente.

Quando a transcrição já estiver em português, copie o gancho literalmente, nunca parafraseie.
Quando estiver em outra língua, traduza o gancho o mais literalmente possível, sem
parafrasear nem resumir. Sem travessão, sem emoji.

Escreva em português do Brasil, com acentuação correta.`;
}

/** M5b, achado 7: até onde vai a legenda do post na entrada, cortada por code point (mesma técnica de `servicos/normalizadores/titulo.ts`, para nunca partir um emoji ao meio). */
const MAX_CARACTERES_LEGENDA = 400;

export function montarEntrada(dados: {
  titulo: string;
  /** M5b, achado 7: a legenda inteira do post (`videos.descricao`), cortada aqui para o tamanho da entrada; nula quando a plataforma não trouxe nenhuma. */
  descricao: string | null;
  /** M5b, achado 7: o @ da conta, sem o @ (`contas.handle`); nulo no vídeo sem dono (`videos.semDono`). */
  handle: string | null;
  transcricao: string;
  nomeNicho: string;
  termosNicho: string[];
}): string {
  const legenda = dados.descricao ? Array.from(dados.descricao).slice(0, MAX_CARACTERES_LEGENDA).join("") : null;
  const conta = dados.handle ? `@${dados.handle}` : "(sem conta)";
  return `Nicho: ${dados.nomeNicho} (termos: ${dados.termosNicho.join(", ")})\n\nConta: ${conta}\nTitulo: ${dados.titulo}\nLegenda do post: ${legenda ?? "(sem legenda)"}\n\nTranscricao:\n${dados.transcricao}\n\n${LEMBRETE_ACENTUACAO}`;
}
