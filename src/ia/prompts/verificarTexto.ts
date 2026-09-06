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
 */
export const versao = "1.3.0";
export const nivel: NivelIA = "barato";
export const esforco: EsforcoIA | undefined = undefined;

export type GeneroTexto = "padrao" | "analise" | "roteiro";

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
};

/** Só o genero "roteiro" precisa desta explicação extra; os outros não mudam de comportamento. */
const CONTEXTO_GENERO: Partial<Record<GeneroTexto, string>> = {
  roteiro:
    "\nO texto é um roteiro que o próprio dono do negócio vai gravar sozinho no celular: gancho, " +
    "corpo, fechamento e chamada final, mais um bloco de edição com instruções de tela e de " +
    "corte para ele seguir. Essas instruções de edição são parte do texto que ele lê e segue, " +
    "escritas para ele, não para um editor profissional; nunca reprove achando que não é o " +
    "texto que o cliente vê, isso não é um erro de gênero.\n",
};

export function montarSistemaEstavel(genero: GeneroTexto = "padrao"): string {
  return `Você confere um texto que vai para a tela de um dono de pequeno negócio. Aprove só
se:
- o tom é direto, calmo e de parceiro, sem exclamação e sem entusiasmo forçado;
- ${CRITERIO_TOM[genero]}
- nenhuma proibição que o cliente listou no briefing foi ferida.
${CONTEXTO_GENERO[genero] ?? ""}
Reprove e diga o motivo em uma frase, sem travessão, quando alguma dessas coisas falhar.
Não repita o texto inteiro na resposta, só o motivo.

Escreva em português do Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: { texto: string; proibicoes: string[] }): string {
  const listaProibicoes =
    dados.proibicoes.length > 0 ? dados.proibicoes.join("; ") : "nenhuma proibicao registrada";

  return `Texto a conferir:\n${dados.texto}\n\nProibicoes do cliente: ${listaProibicoes}`;
}
