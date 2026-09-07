import { z } from "zod";

import type { EsforcoIA, NivelIA } from "../tipos";

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
 */
export const versao = "1.3.0";
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
