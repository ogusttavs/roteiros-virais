import { z } from "zod";

import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * Segunda camada do verificador (src/ia/verificador.ts): checagens locais
 * (regex) ja cobrem travessao, emoji e a lista fixa de jargao da secao 8 do
 * brief-frontend.md, entao esta tarefa nao precisa repetir essa lista. Ela
 * cobre o que regex nao pega: tom, naturalidade e as proibicoes do
 * proprio cliente (P10 do briefing), que sao dado por cliente, nunca uma
 * lista fixa.
 *
 * `genero` (rodada de acabamento de 06/09, item 1): o criterio "soa como
 * uma pessoa falando com outra pessoa" so serve pro texto que o cliente
 * grava (roteiro, tema), o genero "padrao" (default, comportamento de
 * antes). A analise de uma resposta do briefing (avaliarResposta) e
 * feedback, nao esse tipo de texto: o proprio prompt dela manda escrever
 * em tom de instrucao ("o que fazer", "o criterio que faltou"), e em
 * producao isso reprovava com "soar como consultoria" quando a resposta
 * do cliente era uma lista, porque o "como melhorar" nasce mais
 * imperativo. O genero "analise" troca esse criterio por um que aceita
 * instrucao clara sem confundir com propaganda de venda.
 *
 * `roteiro` (dia 1 da etapa 14, `PROXIMO.md`, item 5): no primeiro roteiro
 * real da Dr.Wash, a segunda tentativa reprovou dizendo que era um roteiro
 * técnico de produção, não a tela que o dono de negócio vai ver, por isso
 * não dava para avaliar o tom: o modelo barato não reconheceu o próprio
 * gênero, porque o texto inclui um bloco de instrução de edição (o que
 * aparece na tela, o ritmo de corte) que ele leu como roteiro de produção
 * para um editor, não como o texto que o cliente lê e segue sozinho. O
 * genero "roteiro" descreve isso com todas as letras, para nunca mais
 * reprovar por não reconhecer o gênero.
 *
 * `regra` (E27 parte 2, item 7, achado da medição de custo com chave real):
 * a saída de `aprenderCliente` é uma lista de regras curtas e diretas ("não
 * começar com pergunta: comece mostrando"), do mesmo jeito que uma regra de
 * negócio soa, nunca uma frase de conversa. Sem esse gênero, a tentativa com
 * chave real reprovou duas vezes seguidas dizendo que o texto "parece ser
 * instruções internas... não um texto para a tela do dono de negócio", a
 * mesma classe de erro que motivou o gênero "analise": o modelo barato
 * confunde instrução direta e correta com instrução interna. A regra
 * aparece no Briefing do próprio cliente (`AprendizadoCard.tsx`), então é
 * texto de tela sim, só que no formato de regra, não de conversa.
 *
 * `tema` (29/09/2026, achado do Gustavo em produção, na Dr.Wash): a
 * recomendação de `avaliarTema` diz como ajustar o tema antes de gravar (o
 * que mostrar, em que ordem, com que teste), e o modelo barato reprovou duas
 * vezes seguidas dizendo que era "um briefing de direção de gravação, não um
 * texto para o dono do negócio ler" e depois "instruções detalhadas que soam
 * como briefing interno". A mesma classe de erro dos gêneros "roteiro" e
 * "regra": instrução de gravação escrita para o próprio dono é o formato
 * certo desta recomendação, e o verificador precisa saber disso para não
 * transformar uma avaliação boa (nota 8,6) num erro na tela.
 */

/**
 * O roteiro não inventa fato (achado do Bruno e do Gustavo no teste de 04/10/2026: o roteiro do momento trouxe "o Uli está aqui do meu lado com a mochila", "uma mesa de hotel com café
 * já frio", coisas que ninguém contou). Com `fontes`, o verificador confere também que o texto não AFIRMA fato concreto (pessoa, lugar, objeto, número, data, acontecimento) fora delas; um
 * espaço marcado entre colchetes para a pessoa preencher não é fato. Sem `fontes`, nada muda. Versão 1.6.0.
 */
export const versao = "1.6.0";
export const nivel: NivelIA = "barato";
export const esforco: EsforcoIA | undefined = undefined;

export type GeneroTexto = "padrao" | "analise" | "roteiro" | "regra" | "tema";

export const schema = z.object({
  aprovado: z.boolean(),
  motivo: z.string().nullable(),
});

export type SaidaVerificarTexto = z.infer<typeof schema>;

const CRITERIO_TOM: Record<GeneroTexto, string> = {
  padrao: "o texto soa como uma pessoa falando com outra pessoa, não como propaganda;",
  analise:
    "o texto é uma análise de feedback sobre uma resposta do cliente: dar instrução clara de " +
    "como melhorar é esperado e correto, não reprove só por isso; reprove apenas se soar como " +
    "propaganda de venda ou usar uma palavra fora do lugar;",
  roteiro: "o texto soa como uma pessoa falando com outra pessoa, não como propaganda;",
  regra:
    "o texto é uma regra curta e direta sobre o que os próximos roteiros deste cliente devem " +
    "seguir ou evitar: frase imperativa, do tipo não fazer X e sim Y, é o formato esperado e " +
    "correto, não reprove só por isso; reprove apenas se soar como propaganda de venda ou usar " +
    "jargão de marketing ou de tecnologia;",
  tema:
    "o texto é a recomendação sobre um tema que o dono do negócio propôs: dizer como ajustar e " +
    "como gravar (o que mostrar, em que ordem, que teste fazer) é esperado e correto, não reprove " +
    "só por isso; reprove apenas se soar como propaganda de venda ou usar jargão de marketing " +
    "ou de tecnologia;",
};

/** Só os generos "roteiro", "regra" e "tema" precisam desta explicação extra; os outros não mudam de comportamento. */
const CONTEXTO_GENERO: Partial<Record<GeneroTexto, string>> = {
  roteiro:
    "\nO texto é um roteiro que o próprio dono do negócio vai gravar sozinho no celular: gancho, " +
    "corpo, fechamento e chamada final, mais um bloco de edição com instruções de tela e de " +
    "corte para ele seguir. Essas instruções de edição são parte do texto que ele lê e segue, " +
    "escritas para ele, não para um editor profissional; nunca reprove achando que não é o " +
    "texto que o cliente vê, isso não é um erro de gênero.\n",
  regra:
    "\nO texto é uma regra que resume o que o cliente já reprovou antes, para lembrar os próximos " +
    "roteiros dele do que evitar. Ela aparece numa lista curta na tela do próprio cliente, no " +
    "briefing, ao lado de outras regras assim. Frase curta e imperativa é o formato certo deste " +
    "gênero, não instrução interna de equipe; nunca reprove achando que parece um manual de " +
    "produção ou uma nota técnica, isso não é um erro de gênero.\n",
  tema:
    "\nO texto é a recomendação que o dono do negócio lê depois de propor um tema: ela diz se vale " +
    "gravar hoje e, quando pede ajuste, sugere o ângulo mais próximo do que já funcionou, com " +
    "instruções de gravação (o que mostrar primeiro, que teste fazer, onde parar) escritas para " +
    "ele seguir sozinho no celular. Instrução de gravação é o formato certo deste gênero, não um " +
    "briefing interno nem direção para uma equipe; nunca reprove achando que não é o texto que o " +
    "cliente vê, isso não é um erro de gênero.\n",
};

const CRITERIO_FATOS =
  "\n- o texto não afirma nenhum fato concreto (uma pessoa, um lugar, um objeto, um número, uma data, uma cena, uma coisa que aconteceu) que não esteja nas FONTES que vêm depois do texto. " +
  "Só o que o texto AFIRMA como real conta: o jeito de falar, a estrutura e as instruções de gravação não precisam estar nas fontes. Um espaço marcado entre colchetes para a pessoa " +
  'preencher (por exemplo "[diga aqui onde você está]") não é fato, é o certo quando a fonte não traz a informação. Se houver um fato fora das fontes, reprove e diga qual é, em uma frase;';

export function montarSistemaEstavel(genero: GeneroTexto = "padrao", comFontes = false): string {
  return `Você confere um texto que vai para a tela de um dono de pequeno negócio. Aprove só
se:
- o tom é direto, calmo e de parceiro, sem exclamação e sem entusiasmo forçado;
- ${CRITERIO_TOM[genero]}${comFontes ? CRITERIO_FATOS : ""}
- nenhuma proibição que o cliente listou no briefing foi ferida.
${CONTEXTO_GENERO[genero] ?? ""}
Reprove e diga o motivo em uma frase, sem travessão, quando alguma dessas coisas falhar.
Não repita o texto inteiro na resposta, só o motivo.

Escreva em português do Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: { texto: string; proibicoes: string[]; fontes?: string }): string {
  const listaProibicoes =
    dados.proibicoes.length > 0 ? dados.proibicoes.join("; ") : "nenhuma proibicao registrada";
  const blocoFontes = dados.fontes ? `\n\nFONTES (tudo o que foi dito ou escrito para este texto; só isto vale como fato):\n${dados.fontes}` : "";

  return `Texto a conferir:\n${dados.texto}\n\nProibicoes do cliente: ${listaProibicoes}${blocoFontes}`;
}
