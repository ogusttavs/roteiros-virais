/**
 * E22: os textos da assinatura (`/assinar` e o cartão "Sua assinatura" em Conta), em linguagem de quem dirige um negócio pequeno: nada de "cobrança recorrente", "checkout" ou
 * "webhook". O preço é o do plano único (R$ 397 por mês, R$ 1.191 a cada 3 meses, só no cartão; decisão do Gustavo em 22/10/2026) e muda aqui e em `config/assinatura.ts`, nunca em JSX.
 */

import { config } from "@/lib/config";

import { envolverEmail, linkEmail } from "./casca-email";

/** O nome da marca vem da pessoa: nunca entra no HTML do e-mail sem escapar. */
function escaparHtml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const DATA = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Sao_Paulo" });

/** "22 de janeiro de 2027". */
export function dataPorExtensoDaAssinatura(data: Date): string {
  return DATA.format(data);
}

/** "7 dias", "1 dia". */
export function diasPorExtenso(dias: number): string {
  return dias === 1 ? "1 dia" : `${dias} dias`;
}

export const textosAssinatura = {
  /** O que o Stripe chama de status, dito em português claro. */
  status: {
    active: "Ativa",
    trialing: "Teste grátis",
    past_due: "Pagamento atrasado",
    unpaid: "Pagamento não feito",
    canceled: "Cancelada",
    incomplete: "Esperando o pagamento",
    incomplete_expired: "Pagamento não concluído",
    paused: "Pausada",
  },

  plano: {
    rotulo: "Plano trimestral",
    preco: "R$ 397",
    porMes: "por mês",
    total: "Cobrado R$ 1.191 a cada 3 meses, só no cartão.",
    semTaxa: "Sem taxa para entrar.",
  },

  inclui: {
    titulo: "O que você recebe",
    itens: [
      "Todo dia, três ideias de vídeo tiradas do que está funcionando no seu ramo.",
      "Roteiro pronto para você gravar, com o que falar e como editar no celular.",
      "Lembrete e histórico do que você gravou, para manter o ritmo.",
    ],
  },

  /**
   * O teste grátis (E22, decisão do Gustavo em 28/10/2026): os primeiros dias de quem assina pela primeira vez. Com `exigeCartao` (o padrão), o cartão é pedido no começo e só é
   * cobrado no fim do teste, se a pessoa não cancelar; sem, o teste começa sem cartão e a assinatura termina no fim dele se o cartão não vier. Nunca prometer aqui o que o Stripe não faz.
   */
  teste: {
    rotulo: (dias: number) => `${diasPorExtenso(dias)} grátis`,
    convite: {
      titulo: (dias: number) => `Teste ${diasPorExtenso(dias)} grátis`,
      frase: (dias: number) => `Use o aplicativo por ${diasPorExtenso(dias)} sem pagar, com os temas e os roteiros de cada dia. Depois, o plano segue por R$ 397 por mês.`,
    },
    /** Embaixo do preço, no convite. */
    total: (dias: number, exigeCartao: boolean) =>
      exigeCartao
        ? `Os primeiros ${diasPorExtenso(dias)} são grátis. Depois, R$ 1.191 a cada 3 meses, só no cartão.`
        : `Os primeiros ${diasPorExtenso(dias)} são grátis, sem cadastrar o cartão agora. Para continuar depois, você cadastra o cartão e o plano segue por R$ 1.191 a cada 3 meses, só no cartão.`,
    botao: (dias: number) => `Começar ${diasPorExtenso(dias)} grátis`,
    garantia: (dias: number, exigeCartao: boolean) =>
      exigeCartao
        ? `Você cadastra o cartão agora, mas só é cobrado depois dos ${diasPorExtenso(dias)}. Se cancelar antes, não paga nada.`
        : `Não pedimos o cartão agora. Se você não cadastrar o cartão até o fim do teste, a assinatura termina e nada é cobrado.`,
    /** Em `/assinar` e em Conta, enquanto o teste corre. As duas datas são o mesmo dia: o teste acaba quando a primeira cobrança acontece. */
    titulo: "Você está no teste grátis",
    frase: (data: Date) => `Você está no teste grátis até ${dataPorExtensoDaAssinatura(data)}. Se não cancelar, a primeira cobrança é em ${dataPorExtensoDaAssinatura(data)}.`,
    fraseSemCartao: (data: Date) => `Seu teste grátis termina em ${dataPorExtensoDaAssinatura(data)}. Para continuar, cadastre o cartão. Se você já cadastrou, está tudo certo.`,
    fraseCancelada: (data: Date) => `Você cancelou. O teste grátis vai até ${dataPorExtensoDaAssinatura(data)} e nada será cobrado.`,
    fraseSemData: "Você está no teste grátis. Se não cancelar, a primeira cobrança é no fim do teste.",
    confirmada: {
      titulo: "Seu teste grátis começou",
    },
  },

  /** O corpo de cada situação em `/assinar`. */
  situacoes: {
    nunca: {
      titulo: "Assine para continuar",
      frase: "Para seguir recebendo os temas e os roteiros de cada dia, assine o plano.",
    },
    encerrada: {
      titulo: "Sua assinatura terminou",
      frase: "Assine de novo para voltar a receber os temas e os roteiros de cada dia. Tudo o que você já fez continua guardado.",
      fraseComData: (data: Date) => `Ela terminou em ${dataPorExtensoDaAssinatura(data)}. Assine de novo para voltar a receber os temas e os roteiros de cada dia. Tudo o que você já fez continua guardado.`,
    },
    cartao: {
      titulo: "Falta acertar o pagamento",
      frase: "Não conseguimos cobrar o seu cartão. Atualize o cartão para voltar a usar; o que você já fez continua guardado.",
    },
    aguardando: {
      titulo: "Estamos confirmando o seu pagamento",
      frase: "Isso leva alguns segundos. Esta página se atualiza sozinha e não precisa pagar de novo.",
      demora: "A confirmação está demorando mais do que o normal. Não pague de novo: volte daqui a pouco, ou fale com a gente.",
    },
    confirmada: {
      titulo: "Assinatura confirmada",
      frase: (ate: Date | null) => (ate ? `Obrigado. Seu plano vai até ${dataPorExtensoDaAssinatura(ate)} e renova sozinho.` : "Obrigado. Seu plano já está valendo e renova sozinho."),
    },
    ativa: {
      titulo: "Sua assinatura está ativa",
    },
    atrasada: {
      titulo: "O último pagamento não passou",
      frase: "Você continua usando por enquanto, e o banco tenta de novo. Para não perder o acesso, atualize o cartão.",
    },
    cortesia: {
      titulo: "Esta conta usa sem cobrança",
      frase: "Não precisa assinar nada.",
    },
  },

  /** A linha de data de cada estado (aparece em `/assinar` e em Conta). */
  datas: {
    renova: (data: Date) => `Renova em ${dataPorExtensoDaAssinatura(data)}.`,
    terminaEm: (data: Date) => `Você cancelou. Vale até ${dataPorExtensoDaAssinatura(data)} e não renova.`,
    paga: (data: Date) => `Pago até ${dataPorExtensoDaAssinatura(data)}.`,
  },

  botoes: {
    assinar: "Assinar por R$ 1.191 a cada 3 meses",
    assinarCurto: "Assinar",
    assinarDeNovo: "Assinar de novo",
    atualizarCartao: "Atualizar o cartão",
    cadastrarCartao: "Cadastrar o cartão",
    gerenciar: "Gerenciar a assinatura",
    irParaHoje: "Ir para o Hoje",
  },

  /** Embaixo do botão de assinar. */
  garantias: [
    "O pagamento é feito na página segura do Stripe. A gente não vê os dados do seu cartão.",
    "Você cancela quando quiser, pela própria conta. O plano vale até o fim do período que você já pagou.",
  ],

  /** O e-mail de 2 dias antes do fim do teste grátis (job `lembrete-fim-do-teste`): uma vez por assinatura, para o dono da conta. */
  emailFimDoTeste: {
    assunto: "O seu teste grátis termina em 2 dias",
    corpo: (nomeDaMarca: string, fim: Date, exigeCartao: boolean) =>
      envolverEmail(
        `<p>O teste grátis da conta <strong>${escaparHtml(nomeDaMarca)}</strong> termina em ${dataPorExtensoDaAssinatura(fim)}.</p>` +
          (exigeCartao
            ? `<p>Se você não cancelar, a primeira cobrança, de R$ 1.191 (a cada 3 meses, no cartão que você cadastrou), é feita nesse dia. Se quiser cancelar, abra a tela de Conta e toque em Gerenciar a assinatura: cancelando antes, nada é cobrado.</p>`
            : `<p>Para continuar, cadastre o cartão antes dessa data: abra a tela de Conta e toque em Cadastrar o cartão. Se você já cadastrou, está tudo certo. Sem o cartão, a assinatura termina sozinha e nada é cobrado.</p>`) +
          `<p>${linkEmail(`${config.appUrl}/conta`, "abrir a tela de Conta")}</p>`,
      ),
  },

  semPermissao: "Só quem criou a conta pode assinar ou mexer na assinatura. Peça para essa pessoa abrir esta página.",
  verComo: "Você está olhando como a pessoa. Assinar e mexer na assinatura só ela faz.",
  erroGenerico: "Não deu para abrir o pagamento agora. Tente de novo daqui a pouco.",

  /** O cartão "Sua assinatura" em Conta. */
  conta: {
    titulo: "Sua assinatura",
    statusRotulo: "Situação",
    semAssinatura: "Esta conta ainda não tem assinatura.",
    verPlano: "Ver o plano",
  },
};
