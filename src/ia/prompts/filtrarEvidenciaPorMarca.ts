import { z } from "zod";

import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * H4, item 3 (achado do Gustavo em produção em 01/10/2026, o caso do roteiro 12: a referência
 * batia no múltiplo mas não tinha nada a ver com a marca, "o Bruno nunca faria um vídeo
 * desse"). Filtro barato, uma chamada por roteiro, depois que a evidência do roteiro já está
 * pronta (`combinarEvidencias`, `servicos/roteiro.ts`) e antes da geração forte: tira da
 * evidência o que fere uma proibição do briefing ou destoa do tom da pessoa, para o roteiro
 * (e a referência, item 1) nunca nascerem de um vídeo que a marca rejeitaria de cara. Vídeo
 * fora daqui ainda pode ter servido de sinal de que o assunto está em alta; só não entra como
 * modelo nem como citação deste roteiro.
 */
export const versao = "1.0.0";
export const nivel: NivelIA = "barato";
export const esforco: EsforcoIA | undefined = undefined;

export const schema = z.object({
  aprovados: z.array(z.number()),
});

export type SaidaFiltrarEvidenciaPorMarca = z.infer<typeof schema>;

export function montarSistemaEstavel(): string {
  return `Você recebe o perfil de um dono de pequeno negócio e uma lista numerada de vídeos que
poderiam virar evidência para o roteiro de hoje dele. Devolva só os ids dos vídeos que combinam
com essa marca: nenhuma proibição do perfil ferida, e o jeito do vídeo falar não destoa do tom
da pessoa (um vídeo de humor, deboche ou de um nicho totalmente diferente não serve de modelo
para quem tem um tom sério e técnico, mesmo que o assunto bata).

Na dúvida entre aprovar e reprovar, reprove: um vídeo a menos na evidência nunca é problema, uma
referência errada é. Sem nenhuma proibição ferida e sem nada que destoe do tom, aprove todos.
Devolva só o array de ids aprovados, nada além disso.`;
}

export function montarEntrada(dados: {
  perfilCompilado: string;
  evidencias: { id: number; assunto: string; gancho: string }[];
}): string {
  const listaEvidencias = dados.evidencias.map((v) => `id ${v.id}: ${v.assunto}\n  gancho: ${v.gancho}`).join("\n");

  return `Perfil do cliente:\n${dados.perfilCompilado}\n\nVídeos candidatos a evidência:\n${listaEvidencias}`;
}
