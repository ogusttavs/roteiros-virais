import { z } from "zod";

/**
 * Extracao em dois passos (escopo 5.9.4): transforma a transcricao de um
 * video coletado num JSON fixo. O modelo forte nunca le a transcricao
 * bruta, so este JSON. Modelo barato, em lote (etapa 8).
 */
export const versao = "1.0.0";

export const schema = z.object({
  assunto: z.string(),
  gancho: z.string(),
  estrutura: z.string(),
  fechamento: z.string(),
  chamadaFinal: z.string(),
  formato: z.enum(["fala_para_camera", "podcast", "caixinha", "esquete", "outro"]),
  porQueFuncionou: z.string(),
  etiquetas: z.array(z.string()),
});

export type SaidaExtrairVideo = z.infer<typeof schema>;

export function montarSistemaEstavel(): string {
  return `Voce le a transcricao de um video curto que ficou fora da curva num nicho de dono
de pequeno negocio, e extrai uma ficha fixa:

- assunto: o tema do video em poucas palavras.
- gancho: a frase ou cena literal dos primeiros segundos, exatamente como apareceu.
- estrutura: como o video se desenrola, em uma frase.
- fechamento: como o video termina.
- chamadaFinal: o que o video pede para quem assiste fazer no final, se pedir algo.
- formato: fala_para_camera, podcast, caixinha, esquete ou outro.
- porQueFuncionou: sua leitura de por que esse video rendeu, em uma frase.
- etiquetas: de tres a seis palavras-chave para achar este video depois numa busca.

Copie o gancho literalmente da transcricao, nunca parafraseie. Sem travessao, sem emoji.`;
}

export function montarEntrada(dados: { titulo: string; transcricao: string }): string {
  return `Titulo: ${dados.titulo}\n\nTranscricao:\n${dados.transcricao}`;
}
