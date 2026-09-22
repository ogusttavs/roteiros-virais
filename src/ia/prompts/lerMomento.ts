import { z } from "zod";

import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * Separa os três campos do momento a partir do que a pessoa falou (transcrito
 * pela Groq) ou digitou na folha "Gravar agora" (V9a, item 3). Mesmo espírito
 * de `classificarAbertura.ts`: tarefa pequena e barata, sem verificador (a
 * saída é o que a própria pessoa disse, só reorganizada nos três campos; ela
 * vê e edita antes de confirmar em "Escrever o roteiro").
 */
export const versao = "1.0.0";
export const nivel: NivelIA = "barato";
export const esforco: EsforcoIA | undefined = undefined;

export const schema = z.object({
  onde: z.string(),
  oQueEstaAcontecendo: z.string(),
  oQueDaParaMostrar: z.string(),
});

export type SaidaLerMomento = z.infer<typeof schema>;

export function montarSistemaEstavel(): string {
  return `Você separa em três campos o que uma pessoa contou sobre o momento que está
vivendo agora, para gravar um vídeo curto no celular. Use as palavras dela, sem
reescrever nem melhorar o texto; só reorganize o que ela já disse.

- onde: o lugar onde ela está agora.
- oQueEstaAcontecendo: o que está acontecendo, a situação que ela está vivendo.
- oQueDaParaMostrar: o que a câmera pode mostrar dali, a cena.

Se ela não disse claramente uma das três partes, escreva uma frase curta a partir do
que ela disse, sem inventar nenhum fato novo. Português do Brasil, com acentuação
correta.`;
}

export function montarEntrada(dados: { texto: string }): string {
  return `O que a pessoa disse ou escreveu:\n${dados.texto}`;
}
