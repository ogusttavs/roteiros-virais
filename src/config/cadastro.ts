/**
 * E63 PR 1: o cadastro sozinho (a pessoa cria a conta pela página, sem o admin). Tudo que é regra de produto ou número do cadastro mora aqui, com nome claro; a chave que liga e
 * desliga também. Este arquivo lê o ambiente sozinho (e não `lib/config.ts`) para o cadastro não depender de outra etapa.
 */

/**
 * `CADASTRO_ABERTO=1` liga o cadastro sozinho. Ausente ou diferente de 1, o cadastro responde fechado como sempre respondeu e nada muda para ninguém. É lida a cada pedido (e não
 * guardada), para desligar de novo bastar reiniciar o app, e para o teste ligar e desligar sem recarregar o módulo.
 */
export function cadastroAberto(): boolean {
  return process.env.CADASTRO_ABERTO === "1";
}

/**
 * O teto do teste, por marca de cadastro próprio que ainda não tem assinatura paga (decisão do Gustavo em 23/11/2026): até 10 roteiros, 3 edições de vídeo e US$ 4 de IA no total.
 * A IA conta tudo o que ficou em `geracoes_ia` da marca mais a transcrição das edições. Vale desde o primeiro dia da marca, não por mês. Marca com cortesia ou com assinatura
 * `active` (paga) não tem teto.
 */
export const TETO_DO_TESTE = {
  roteiros: 10,
  edicoes: 3,
  iaUsd: 4,
} as const;

/** Contra abuso do cadastro (decisão do Gustavo em 23/11/2026: sem captcha no começo; entra se aparecer abuso). */
export const LIMITES_DO_CADASTRO = {
  /** Pedidos de cadastro por endereço (IP): cinco em dez minutos (quem erra a digitação cabe; um robô não). Em memória e por processo, como o do "Quero testar". */
  porIp: { janelaMs: 10 * 60 * 1000, maximo: 5 },
  /** Contas novas por hora no sistema todo, contadas no banco: acima disso ninguém mais entra até a hora virar (IP falso não passa por aqui). */
  contasPorHora: 30,
  /** O link de confirmar o e-mail vale 24 horas e só funciona uma vez. */
  validadeDoLinkMs: 24 * 60 * 60 * 1000,
  /** Reenvios: no máximo cinco e-mails de confirmação por pessoa em 24 horas (o primeiro conta), e um minuto entre um e outro. */
  enviosPorDia: 5,
  esperaEntreEnviosMs: 60 * 1000,
  /** A conta de cadastro próprio que nunca confirmou o e-mail é apagada depois de 7 dias (job diário), para não prender o e-mail. */
  diasParaApagarSemConfirmar: 7,
  /** A pesquisa de setor novo (Apify e YouTube) roda sozinha só para este tanto de ramos novos por dia (24 horas) vindos de cadastro próprio; o resto espera o admin aprovar. */
  ramosNovosPorDia: 2,
} as const;

export const TAMANHO_DO_CADASTRO = {
  nomeMax: 80,
  negocioMax: 80,
  emailMax: 254,
  /** Os campos de texto aceitam até isto antes de qualquer outra conta (um corpo de um milhão de caracteres nem é lido). */
  brutoMax: 500,
} as const;
