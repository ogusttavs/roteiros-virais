/**
 * Texto de tela de `/criar/versoes/[grupo]` (E26 4b, parte 2; `entrega/telas/Objetivo.dc.html`, estados `comparar`, `gerandoOutra` e `quatroVersoes`, e `Hoje.dc.html`, `versoesProntas`).
 *
 * As três notas se chamam pelo que a pessoa escolheu ("te chamarem para comprar"), não pelo nome interno do objetivo (mesmo cuidado de `src/textos/objetivo.ts`).
 */
import type { ChaveDaNota } from "@/servicos/versoes";

export const textosVersoes = {
  /** O alto da tela: o tema e o objetivo que a pessoa escolheu continuam à vista. */
  temaEscolhido: "Tema escolhido",
  titulo: "Escolha uma versão",
  /** O formato do vídeo sem fala, na linha do tema (Reels e Story usam o texto de `textosObjetivo`). */
  formatoSemFala: "Reels sem fala, só com cenas e texto na tela",
  /** O nome das três notas, completo (a que ordena a lista) e curto (as duas pequenas). */
  nota: {
    viralizar: "Chance de viralizar",
    chamarem: "Chance de te chamarem para comprar",
    lembrarem: "Chance de lembrarem de você",
  } satisfies Record<ChaveDaNota, string>,
  notaCurta: {
    viralizar: "Viralizar",
    chamarem: "Te chamarem",
    lembrarem: "Lembrarem de você",
  } satisfies Record<ChaveDaNota, string>,
  /** "Ordenadas pela chance de ..., que é o objetivo que você escolheu." */
  ordenadasPela: (nomeDaNota: string) => `Ordenadas pela ${nomeDaNota.charAt(0).toLowerCase()}${nomeDaNota.slice(1)}, que é o objetivo que você escolheu.`,
  /** A mesma frase, para o vídeo que não pergunta o objetivo (Story e sem fala): a ordem sai da nota que o tipo de vídeo pede. */
  ordenadasPelaPadrao: (nomeDaNota: string) => `Ordenadas pela ${nomeDaNota.charAt(0).toLowerCase()}${nomeDaNota.slice(1)}.`,
  trocarObjetivo: "Trocar o objetivo",
  /** O selo da lista, no alto e no cartão. */
  versaoDe: (posicao: number, total: number) => `Versão ${posicao} de ${total}`,
  versaoNumero: (numero: number) => `Versão ${numero}`,
  /** O nome do grupo de folhas para quem lê com leitor de tela. */
  versoes: (quantas: number) => (quantas === 1 ? "A versão" : `As ${quantas} versões`),
  notaMaisAlta: "Nota mais alta",
  nova: "Nova",
  escolhaDoObjetivo: "é o que você escolheu",
  semNota: "Não deu para dar a nota desta versão agora. O roteiro está inteiro abaixo.",
  /** A versão é de agora e o juiz ainda não respondeu: não é "não deu", é "ainda não". */
  notaEmAndamento: "A nota desta versão ainda está sendo calculada. O roteiro já está inteiro abaixo; volte a esta tela em instantes para ver a nota.",
  lerInteira: "Ler esta versão inteira",
  recolher: "Recolher",
  roteiroDaVersao: "O roteiro",
  /** O que o juiz diz do jeito da versão (ele vê uma versão de cada vez: o rótulo nunca promete uma comparação). */
  jeitoDaVersao: "O jeito desta versão:",
  ficarComEsta: "Ficar com esta",
  abrindo: "Abrindo o seu roteiro",
  escolhida: "Escolhida",
  abrirRoteiro: "Abrir o roteiro",
  /** O fim da lista. */
  nenhumaServe: "Nenhuma serve?",
  nenhumaServeTexto: "Gere outra, com outro ângulo, o mesmo tema e o mesmo objetivo. Leva cerca de 1 minuto, pode gerar quantas quiser, e estas continuam aqui.",
  gerarOutra: "Gerar outra",
  escrevendoAVersao: (numero: number) => `Escrevendo a versão ${numero}`,
  /** A folha da versão que está sendo escrita. */
  escrevendoTitulo: "Escrevendo outra versão",
  escrevendoTexto: (quantas: number) =>
    `Outro ângulo, o mesmo tema e o mesmo objetivo. Cerca de 1 minuto; ${quantas === 1 ? "a versão continua" : `as ${quantas} continuam`} aqui para você ler. Para ficar com uma, espere esta terminar.`,
  /** O que o leitor de tela ouve quando a versão nova chega. */
  novaPronta: (numero: number) => `A versão ${numero} ficou pronta e está no fim da lista.`,
  /** O erro de gerar outra, quando o serviço não deu uma frase própria. */
  erroGerarOutra: "Não deu para escrever outra versão agora. As que você tem continuam aqui; tente de novo.",
  erroGerarOutraRede: "A conexão caiu no meio. A versão pode ter ficado pronta: espere um minuto e veja se ela apareceu antes de pedir outra.",
  verSeFicouPronta: "Ver se ficou pronta",
  erroFicarComEsta: "Não deu para abrir este roteiro agora. Tente de novo.",
  /** Os pontos de baixo (tablet): "1 de 3". */
  pontos: (posicao: number, total: number) => `${posicao} de ${total}`,
  pontosEscrevendo: (numero: number) => `escrevendo a ${numero}`,
} as const;

/** O cartão "Três versões prontas" do Hoje (`versoesProntas`). */
export const textosVersoesNoHoje = {
  titulo: "Suas versões estão prontas",
  selo: (quantas: number) => (quantas === 1 ? "Uma versão pronta" : `${quantas === 3 ? "Três" : quantas} versões prontas`),
  texto: "Jeitos diferentes de gravar o mesmo tema, cada um com as três notas. Você escolhe um e o roteiro abre.",
  escolher: "Escolher uma",
  outroTema: "Escolher outro tema escreve outras versões, e estas ficam guardadas.",
} as const;
