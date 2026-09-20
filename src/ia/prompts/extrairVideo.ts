import { z } from "zod";

import { TIPOS_ABERTURA } from "@/db/schema";

import type { EsforcoIA, NivelIA } from "../tipos";

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
 */
export const versao = "1.5.0";
export const nivel: NivelIA = "barato";
export const esforco: EsforcoIA | undefined = undefined;

export const schema = z.object({
  assunto: z.string(),
  gancho: z.string(),
  estrutura: z.string(),
  fechamento: z.string(),
  chamadaFinal: z.string(),
  formato: z.enum(["fala_para_camera", "podcast", "caixinha", "esquete", "outro"]),
  porQueFuncionou: z.string(),
  etiquetas: z.array(z.string()),
  pertenceAoNicho: z.boolean(),
  motivoNicho: z.string(),
  idioma: z.enum(["pt-BR", "pt-PT", "en", "es", "outro"]),
  tipoAbertura: z.enum(TIPOS_ABERTURA),
});

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

Quando a transcrição já estiver em português, copie o gancho literalmente, nunca parafraseie.
Quando estiver em outra língua, traduza o gancho o mais literalmente possível, sem
parafrasear nem resumir. Sem travessão, sem emoji.

Escreva em português do Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: {
  titulo: string;
  transcricao: string;
  nomeNicho: string;
  termosNicho: string[];
}): string {
  return `Nicho: ${dados.nomeNicho} (termos: ${dados.termosNicho.join(", ")})\n\nTitulo: ${dados.titulo}\n\nTranscricao:\n${dados.transcricao}`;
}
