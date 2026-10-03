import { z } from "zod";

import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * E38, partes 2 e 3 ("o contexto da marca"): a leitura curta de um perfil citado pelo cliente
 * (concorrente ou perfil que admira) ou da própria marca, pelos últimos títulos/legendas que a
 * API de verdade devolveu (nunca por memória do modelo). Modelo barato, uma chamada por perfil.
 */
export const versao = "1.0.0";
export const nivel: NivelIA = "barato";
export const esforco: EsforcoIA | undefined = undefined;

export const schema = z.object({
  leitura: z.string(),
});

export type SaidaAnalisarPerfilCitado = z.infer<typeof schema>;

export type TipoLeituraPerfil = "concorrente" | "admira" | "propria_marca";

export function montarSistemaEstavel(): string {
  return `Você recebe o nome e o ramo de um pequeno negócio ou de uma pessoa que vive da própria
marca, e os títulos ou legendas dos últimos vídeos de um perfil nas redes sociais.

Escreva uma leitura curta (um parágrafo, três ou quatro frases) sobre o que esse perfil faz nos
vídeos: os assuntos que repete, o formato que usa, o que parece funcionar para ele. Fale com quem
é dono do negócio, direto, sem jargão de marketing.

Se o perfil é um concorrente citado pelo cliente, foque no que ele faz que provavelmente rende
(para o cliente se inspirar, nunca copiar). Se é um perfil que o cliente disse que admira, foque
no que desse jeito de gravar ou de falar o cliente provavelmente gosta. Se é o perfil da própria
marca do cliente, foque no que já rende para ele mesmo, pelos vídeos que já postou.

Sem travessão, sem emoji, sem jargão.

Escreva em português do Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: {
  tipo: TipoLeituraPerfil;
  nomeDoCliente: string;
  oQueVende: string;
  handle: string;
  titulos: string[];
}): string {
  const papel =
    dados.tipo === "concorrente"
      ? "um concorrente que o cliente citou"
      : dados.tipo === "admira"
        ? "um perfil que o cliente disse que admira"
        : "o perfil da própria marca do cliente";

  const lista =
    dados.titulos.length > 0
      ? dados.titulos.map((t, i) => `${i + 1}. ${t}`).join("\n")
      : "nenhum título ou legenda disponível";

  return `Cliente: ${dados.nomeDoCliente} (${dados.oQueVende})
Perfil: @${dados.handle}, ${papel}

Títulos/legendas recentes do perfil:
${lista}`;
}
