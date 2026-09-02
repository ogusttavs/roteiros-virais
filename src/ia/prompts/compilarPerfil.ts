import { z } from "zod";

import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * Perfil compilado do cliente (briefing-e-rubricas.md, secao 4; escopo
 * 5.9.1): fatos em JSON mais um resumo curto. E o perfil, e nao as
 * respostas cruas, que entra em todo prompt de tema e roteiro.
 */
export const versao = "1.1.0";
export const nivel: NivelIA = "forte";
export const esforco: EsforcoIA | undefined = "medium";

export const schema = z.object({
  fatos: z.object({
    oQueVende: z.string(),
    preco: z.string(),
    clienteIdeal: z.string(),
    medos: z.array(z.string()),
    frasesDaFala: z.array(z.string()),
    proibicoes: z.array(z.string()),
    cenasFilmaveis: z.array(z.string()),
    concorrentes: z.array(z.string()),
    perfisAdmirados: z.array(z.string()),
  }),
  resumo: z.string(),
});

export type SaidaCompilarPerfil = z.infer<typeof schema>;

export function montarSistemaEstavel(): string {
  return `Você lê as doze respostas do briefing de um dono de pequeno negócio, já aprovadas
(nota geral 8 ou mais), e compila um perfil em fatos mais um resumo.

Fatos, cada um extraído literalmente do que o cliente escreveu, sem inventar nem
generalizar:
- oQueVende: o produto ou serviço que mais vende, com preço quando houver.
- preco: o valor ou faixa que o cliente informou.
- clienteIdeal: a pessoa que ele descreveu (idade, onde mora, o que faz, momento de vida).
- medos: as dúvidas, medos ou desculpas do cliente antes de fechar, nas palavras dele.
- frasesDaFala: frases literais que o cliente disse que fala de verdade, com a gíria e o
  ritmo dele.
- proibicoes: o que ele nunca diria ou faria num vídeo (promessa, palavra, tom, assunto,
  pessoa).
- cenasFilmaveis: o que a câmera pode mostrar no dia a dia dele (local, equipe, equipamento,
  produto em uso, antes e depois, bastidor).
- concorrentes: os concorrentes diretos que ele citou.
- perfisAdmirados: os perfis que ele admira, com o @ quando houver.

resumo: até 300 palavras, direto, sem travessão, sem emoji, sem jargão, juntando os fatos
acima numa leitura corrida para quem vai escrever o roteiro.

Recompilado a cada edição do briefing; sempre a versão mais recente das respostas.

Escreva em português do Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: { respostas: Record<string, string> }): string {
  const linhas = Object.entries(dados.respostas).map(
    ([pergunta, resposta]) => `${pergunta}: ${resposta}`,
  );
  return linhas.join("\n");
}
