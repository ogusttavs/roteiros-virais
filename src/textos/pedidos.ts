/**
 * E74 PR 2a: os textos do pedido que está sendo escrito (a etapa, o tempo, a recusa de um segundo pedido e a falha). Os rótulos são os do rascunho dos estados
 * (`entregaveis/design-v2/entrega/e74/estados.html`); o visual da aba é do designer (PR 3). Sem jargão: nada de "fila", "processando" nem "tentativa" (R-m).
 */
import { ETAPAS_DO_ROTEIRO } from "@/config/pedidos";

/** "45 s", "2 min", "1 min 30 s". */
export function duracaoCurta(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `${s} s`;
  const minutos = Math.floor(s / 60);
  const resto = s % 60;
  return resto === 0 ? `${minutos} min` : `${minutos} min ${resto} s`;
}

export const textosPedidos = {
  /** A etapa do roteiro: 1 de 3 lendo a pesquisa, 2 de 3 escrevendo (com a versão, que é real: elas saem uma depois da outra), 3 de 3 conferindo as notas. */
  etapaRoteiro: {
    lendo: `Etapa 1 de ${ETAPAS_DO_ROTEIRO}: lendo a pesquisa`,
    escrevendo: (versao: number | null, total: number) =>
      versao ? `Etapa 2 de ${ETAPAS_DO_ROTEIRO}: escrevendo a versão ${versao} de ${total}` : `Etapa 2 de ${ETAPAS_DO_ROTEIRO}: escrevendo as versões`,
    conferindo: `Etapa 3 de ${ETAPAS_DO_ROTEIRO}: conferindo as três versões`,
  },
  /** O carrossel (as mesmas palavras da tela dele, `textosCarrossel.etapaTexto` e `etapaConferindo`). */
  etapaCarrossel: {
    escrevendo: "Escrevendo o texto dos slides",
    conferindo: "Conferindo os dados e as fontes",
  },
  /** O vídeo de animação, pelo estado da tabela dele. */
  etapaAnimacao: {
    pedida: "Esperando a vez de montar",
    fazendo_previa: "Montando a prévia",
    fazendo_final: "Fazendo o vídeo final",
  },
  /** A faixa do tempo típico, nunca uma barra que anda sozinha (R-f). */
  costumaLevar: (de: number, ate: number) => `Costuma levar de ${duracaoCurta(de)} a ${duracaoCurta(ate)}.`,
  jaPassou: (segundos: number) => `Já passou ${Math.floor(segundos / 60)}:${String(Math.floor(segundos % 60)).padStart(2, "0")}.`,
  /** O segundo pedido do mesmo tipo com um em andamento (estado 6): nada é escrito, nada é gasto. */
  jaEmAndamento: {
    roteiro: "Já tem um roteiro sendo escrito. Espere ele ficar pronto para pedir outro.",
    carrossel: "Já tem um carrossel sendo escrito. Espere ele ficar pronto para pedir outro.",
  },
  verOQueEstaSendoEscrito: "Ver o que está sendo escrito",
  /** O id do pedido não vale (forjado, ou de outra marca): nada é escrito. */
  idInvalido: "Não deu para fazer este pedido. Volte e escolha o tema de novo.",
  /** O título do pedido de um tema do dia antes de o tema ser lido (logo em seguida vira o tema de verdade). */
  temaDoDia: "Tema do dia",
  /** A falha confirmada pelo servidor (estado 7): só aqui aparece "Tentar de novo", e ela não conta no limite (R-o). */
  falhou: {
    roteiro: "Não conseguimos terminar este roteiro. Isto não conta no seu limite. Tente de novo.",
    carrossel: "Não conseguimos terminar este carrossel. Isto não conta no seu limite. Tente de novo.",
  },
  /** O pedido nunca chegou ao servidor (a conexão caiu antes): nada foi escrito, e tentar de novo manda o MESMO pedido (o servidor não escreve duas vezes). */
  naoChegou: "A conexão caiu antes de o pedido chegar. Nada foi escrito e nada conta no seu limite. Tente de novo.",
  /** Sem rede durante a espera (estado 10): o pedido não muda de estado. */
  semRede: "O roteiro continua sendo escrito. A tela atualiza quando a conexão voltar.",
  /** O pronto que saiu com menos versões do que o pedido (a escrita parou no meio e a conferência fechou com o que havia). */
  prontasParcial: (quantas: number) => (quantas === 1 ? "Ficou pronta 1 versão" : `Ficaram prontas ${quantas} versões`),
} as const;
