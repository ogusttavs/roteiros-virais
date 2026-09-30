import { z } from "zod";

import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * M2, item 2: o filtro de candidato do job `pesquisa-de-setor` exige que o PERFIL seja do setor,
 * não só que exista e poste vídeo curto brasileiro. Mesmo critério do `pertenceAoNicho` de
 * `extrairVideo.ts`, aplicado aos últimos títulos ou legendas da conta em vez de a um vídeo só:
 * modelo barato, em lote (uma chamada por candidato confirmado na API da rede).
 */
export const versao = "1.0.0";
export const nivel: NivelIA = "barato";
export const esforco: EsforcoIA | undefined = undefined;

export const schema = z.object({
  pertenceAoSetor: z.boolean(),
  motivo: z.string(),
});

export type SaidaClassificarContaDoSetor = z.infer<typeof schema>;

export function montarSistemaEstavel(): string {
  return `Você recebe o nome de um setor de pequeno negócio, os termos de busca dele, e os títulos
ou legendas dos últimos vídeos de um perfil candidato a virar conta semente desse setor.

Diga se o perfil é mesmo desse setor: a maioria dos vídeos recentes precisa falar do assunto do
setor, não só citar ele de vez em quando. Um perfil genérico de humor, de vlog sem tema fixo, ou
de outro assunto qualquer não é desse setor, mesmo que um vídeo isolado bata com o termo de busca.

Sem travessão, sem emoji, sem jargão.

Escreva em português do Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: { nomeSetor: string; termosSetor: string[]; titulos: string[] }): string {
  const lista =
    dados.titulos.length > 0
      ? dados.titulos.map((t, i) => `${i + 1}. ${t}`).join("\n")
      : "nenhum titulo ou legenda disponivel";

  return `Setor: ${dados.nomeSetor} (termos: ${dados.termosSetor.join(", ")})

Títulos/legendas recentes do perfil:
${lista}`;
}
