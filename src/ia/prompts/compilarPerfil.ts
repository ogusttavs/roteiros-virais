import { z } from "zod";

import type { TipoMarca } from "@/db/schema";

import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * Perfil compilado do cliente (briefing-e-rubricas.md, secao 4; escopo
 * 5.9.1): fatos em JSON mais um resumo curto. E o perfil, e nao as
 * respostas cruas, que entra em todo prompt de tema e roteiro.
 *
 * 1.2.0 (P1, item 4, briefing-e-rubricas.md, secao 2b): marca do tipo pessoa
 * reusa os mesmos campos de `fatos` com outro significado (a tabela da
 * secao 2b), mais dois campos novos e opcionais, `historia` e
 * `posicionamentos`, para nenhum prompt de tema ou de roteiro quebrar por
 * causa de um campo ausente no negocio.
 */
export const versao = "1.2.0";
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
    /** So marca do tipo pessoa (secao 2b): o episodio da virada (P3), em ate 60 palavras. */
    historia: z.string().optional(),
    /** So marca do tipo pessoa (secao 2b): as opinioes de P6, uma frase cada, com o porque. */
    posicionamentos: z.array(z.string()).optional(),
  }),
  resumo: z.string(),
});

export type SaidaCompilarPerfil = z.infer<typeof schema>;

function montarInstrucaoFatosNegocio(): string {
  return `Fatos, cada um extraído literalmente do que o cliente escreveu, sem inventar nem
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
- historia e posicionamentos: deixe os dois de fora (campos só de marca pessoa).

resumo: até 300 palavras, direto, sem travessão, sem emoji, sem jargão, juntando os fatos
acima numa leitura corrida para quem vai escrever o roteiro.`;
}

function montarInstrucaoFatosPessoa(): string {
  return `Fatos, cada um extraído literalmente do que a pessoa escreveu, sem inventar nem
generalizar. Os nomes dos campos são os mesmos do briefing de negócio, com outro
significado:
- oQueVende: do que ela é e quer ser lembrada, os assuntos com que tem propriedade (P2), com
  a prova que ela deu.
- preco: o que ela oferece quando alguém procura, os negócios dela, um serviço, ou a própria
  influência (o tipo de marca que quer atrair e o que já fez com marcas, P7); nunca escreva
  "nada".
- clienteIdeal: quem ela quer que a siga, o tipo de pessoa (P4).
- medos: o que o público dela quer ver, aprender ou sentir, e o que pergunta ou comenta
  (P5), nas palavras dele.
- frasesDaFala: as frases dela mais o tom que ela descreveu (P9).
- proibicoes: o que ela nunca diria, faria ou mostraria, inclusive o que da vida dela fica
  fora da câmera (P10).
- cenasFilmaveis: a semana dela que dá para filmar (P11).
- concorrentes: os perfis parecidos que ela citou (P12); uma pessoa não tem concorrente, tem
  vizinho de assunto.
- perfisAdmirados: os perfis que ela admira, com o @ quando houver (P12).
- historia: o episódio da virada que ela contou (P3), em até 60 palavras.
- posicionamentos: as opiniões que geram conversa (P6), uma frase cada, com o porquê.

resumo: até 300 palavras, direto, sem travessão, sem emoji, sem jargão, começando por quem
ela é e do que quer ser lembrada, trazendo a virada e os posicionamentos, e terminando com
como os negócios ou as parcerias dela entram na vida dela.`;
}

export function montarSistemaEstavel(tipo: TipoMarca): string {
  const sobreQuem =
    tipo === "pessoa"
      ? "as doze respostas do briefing de uma pessoa que vai gravar vídeos com a própria cara"
      : "as doze respostas do briefing de um dono de pequeno negócio que vai gravar vídeos com a própria cara";
  const instrucaoFatos = tipo === "pessoa" ? montarInstrucaoFatosPessoa() : montarInstrucaoFatosNegocio();

  return `Você lê ${sobreQuem}, já aprovadas (nota geral 8 ou mais), e compila um perfil em
fatos mais um resumo.

${instrucaoFatos}

Recompilado a cada edição do briefing; sempre a versão mais recente das respostas.

Escreva em português do Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: { respostas: Record<string, string> }): string {
  const linhas = Object.entries(dados.respostas).map(
    ([pergunta, resposta]) => `${pergunta}: ${resposta}`,
  );
  return linhas.join("\n");
}
