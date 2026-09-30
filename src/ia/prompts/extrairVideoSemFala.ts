import { z } from "zod";

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
 */
export const versao = "1.0.0";
export const nivel: NivelIA = "forte";
export const esforco: EsforcoIA | undefined = "medium";

export const schema = z.object({
  assunto: z.string(),
  /** M3, item 2: sem fala, o gancho descreve o que aparece na tela, não o que é dito. */
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

Sem travessão, sem emoji. Escreva em português do Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: { titulo: string; legenda: string; duracaoS: number; nomeNicho: string; termosNicho: string[] }): string {
  return `Nicho: ${dados.nomeNicho} (termos: ${dados.termosNicho.join(", ")})\n\nTitulo: ${dados.titulo}\nDuracao: ${dados.duracaoS} segundos\nLegenda do post: ${dados.legenda || "(sem legenda)"}\n\nOs quadros do video estao anexados.`;
}
