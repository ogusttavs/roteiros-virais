import { z } from "zod";

import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * E39b, item (a), "ainda vale?" (`estrategia/plano-de-execucao.md`, E39): o roteiro foi escrito
 * com alguns dias de antecedência para ser gravado hoje; esta tarefa confere se algo mais forte
 * subiu no setor desde então. Barato, uma chamada por toque em "Conferir" (nunca automática,
 * `conferirAindaVale`, `servicos/roteiro.ts`, guarda o resultado para não repetir a cada abertura
 * da tela).
 */
export const versao = "1.0.0";
export const nivel: NivelIA = "barato";
export const esforco: EsforcoIA | undefined = undefined;

export const schema = z.object({
  valeAinda: z.boolean(),
  /** O id do candidato mais forte, só quando `valeAinda` é falso; nulo quando nada bate o roteiro. */
  videoId: z.number().nullable(),
  motivo: z.string(),
});

export type SaidaAindaValeRoteiro = z.infer<typeof schema>;

export function montarSistemaEstavel(): string {
  return `Você decide se um roteiro de vídeo, já escrito há alguns dias para ser gravado hoje,
continua valendo a pena, ou se algo mais forte subiu no setor desde então e merece um roteiro
novo no lugar. Receba o tema do roteiro já escrito e uma lista numerada do que está subindo hoje
no mesmo setor, com a velocidade de cada vídeo (quantas vezes acima do normal da própria conta).

Só recomende trocar quando um candidato for claramente mais forte, um assunto diferente do tema
atual, não uma variação pequena do mesmo assunto. Na dúvida, mantenha o que já foi escrito: trocar
sem necessidade custa o trabalho já feito e a pessoa prefere gravar logo. Nunca invente um id que
não esteja na lista recebida.

Sem nada mais forte, devolva valeAinda=true, videoId=null, e um motivo curto dizendo que nada
mudou. Com algo mais forte, devolva valeAinda=false, o id desse vídeo em videoId, e o motivo (por
que ele é mais forte que o tema atual, numa frase, sem jargão).`;
}

export function montarEntrada(dados: {
  tema: string;
  diasAtras: number;
  candidatos: { id: number; assunto: string; velocidadeRelativa: number }[];
}): string {
  const lista =
    dados.candidatos.length > 0
      ? dados.candidatos
          .map((c) => `id ${c.id}: ${c.assunto} (${c.velocidadeRelativa.toFixed(1)}x a velocidade normal da conta)`)
          .join("\n")
      : "nada registrado hoje.";

  return `O roteiro foi escrito há ${dados.diasAtras} dia(s), sobre: "${dados.tema}".\n\nO que está subindo hoje no setor:\n${lista}`;
}
