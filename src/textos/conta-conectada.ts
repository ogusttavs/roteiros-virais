import { config } from "@/lib/config";

import { envolverEmail, linkEmail } from "./casca-email";

/**
 * E19 PR 1: as frases da ligação do Instagram feita pela própria pessoa. A tela de verdade (em Conta, "Seu Instagram") é do PR 2 e as frases dela ficam em `tela`; aqui ficam as frases que o servidor já precisa dizer
 * (o retorno do diálogo da Meta, o erro guardado na conta ligada, o e-mail de aviso e a página de status da exclusão). Linguagem de quem dirige um negócio pequeno: nada de "token",
 * "permissão de API" ou "login social".
 */

/** O que o retorno do diálogo da Meta manda para `/conta?instagram=<código>`. Cada código tem a sua frase (a tela do PR 2 as mostra). */
export type CodigoDoRetorno = "ligada" | "escolher" | "cancelou" | "venceu" | "permissao" | "sem-instagram" | "conta-pessoal" | "ja-ligada" | "falhou" | "nao-configurada" | "sem-acesso";

export const textosLigacao = {
  retorno: {
    ligada: "Pronto, o seu Instagram está ligado. A partir de agora lemos os números dos seus vídeos direto dele.",
    escolher: "Encontramos mais de um Instagram. Escolha qual é o seu.",
    cancelou: "Você não liberou o acesso, então nada foi ligado. Pode tentar de novo quando quiser.",
    venceu: "Essa tentativa venceu. Comece de novo e termine em até dez minutos.",
    permissao: "Faltou liberar alguma coisa. Para a ligação funcionar, libere tudo o que a Meta mostrar na tela.",
    "sem-instagram":
      "Não achamos um Instagram profissional ligado à Página que você escolheu. Confira se o seu Instagram é uma conta profissional e se está ligado a uma Página do Facebook.",
    "conta-pessoal":
      "Esse Instagram é uma conta pessoal, e só conta de empresa ou de criador pode ser ligada. Para trocar, abra o Instagram no celular, vá em Configurações e privacidade, depois em Tipo de conta e ferramentas, e escolha Mudar para conta profissional. Leva um minuto e não custa nada. Depois volte aqui e ligue de novo.",
    "ja-ligada": "Este Instagram já está ligado a outra conta aqui. Desligue lá primeiro e tente de novo.",
    falhou: "Não deu para ligar agora. Tente de novo daqui a pouco.",
    "nao-configurada": "A ligação direta com o Instagram ainda não está aberta para você.",
    "sem-acesso": "Só quem criou a conta pode ligar o Instagram, e a ligação precisa ser começada por aqui. Comece de novo pela tela de Conta.",
  } satisfies Record<CodigoDoRetorno, string>,

  /**
   * E19 PR 2: o cartão "Seu Instagram" da Conta. Linguagem de quem dirige um negócio pequeno: nada de "token", "permissão" ou "integração". A Meta aparece pelo nome porque é ela quem
   * mostra a tela de autorizar e quem aprova o aplicativo; as frases de cada volta do diálogo e de cada problema guardado na conta ficam em `retorno` e `erroDaConta`, aqui em cima.
   */
  tela: {
    titulo: "Seu Instagram",
    /** O que a ligação faz, antes de ligar (sem ligação, dono). */
    explica: "Ligue o seu Instagram e a gente passa a ler os números de cada vídeo seu direto dele, sem você precisar mandar nada.",
    /** E19b: o Instagram só deixa ligar conta profissional; quem é pessoal precisa trocar (de graça, um minuto). */
    contaProfissional:
      "Para ligar, o seu Instagram precisa ser uma conta profissional (de empresa ou de criador). Se o seu for pessoal, abra o Instagram no celular, vá em Configurações e privacidade, depois em Tipo de conta e ferramentas, e escolha Mudar para conta profissional. É de graça e leva um minuto.",
    oQueLemos: "O que lemos: o nome da sua conta e, de cada vídeo, quantas pessoas viram, curtiram, comentaram e compartilharam.",
    oQueNunca: "O que nunca fazemos: ler as suas mensagens nem postar sem você pedir.",
    /** E56 PR 1: a publicação pelo aplicativo é sempre um pedido da pessoa, vídeo por vídeo. */
    oQuePublicamos: "O que fazemos só quando você pedir: publicar no seu Instagram o vídeo que você escolher, na tela do roteiro.",
    /** Conta ligada antes da E56 (ou com a configuração da Meta ainda sem a publicação): a leitura funciona, a publicação pede ligar de novo. */
    publicarFalta: "Para publicar por aqui, ligue o Instagram de novo e libere a publicação.",
    publicarLiberada: "Publicar por aqui: liberado.",
    ligar: "Ligar o meu Instagram",
    ligarDeNovo: "Ligar de novo",
    /** Aplicativo ainda em teste na Meta (só quem tem papel nele passa pelo diálogo): dito com calma, sob o botão. */
    emTeste:
      "Por enquanto a ligação direta está aberta só para um grupo pequeno de pessoas que já liberamos. Se a Meta disser que você não pode entrar, é por isso: a ligação direta abre para todos quando a Meta aprovar o aplicativo.",
    /** A ligação ainda não foi aberta neste ambiente (faltam os dados do aplicativo): sem botão. */
    indisponivel: "A ligação direta com o Instagram ainda não está aberta. Ela abre para todos quando a Meta aprovar o aplicativo. Até lá, seguimos acompanhando os seus vídeos pelo perfil que você informou.",
    indisponivelAprovado: "A ligação direta com o Instagram não está disponível agora. Tente de novo mais tarde.",
    /** Quem é só membro da marca lê o estado, sem botão. */
    soDono: "Só quem criou a conta pode ligar ou desligar o Instagram.",
    /** No "ver como" o cartão é só leitura. */
    verComo: "Você está vendo a conta como a pessoa. Ligar e desligar o Instagram é só dela.",
    rotulos: { conta: "Conta", desde: "Ligado desde", ultimaLeitura: "Última leitura", pagina: "Página" },
    nomeDaConta: (nome: string) => `@${nome}`,
    semLeitura: "Ainda não lemos os números dos seus vídeos. Isso acontece sozinho, ao longo do dia.",
    desligar: "Desligar",
    desligando: "Desligando",
    confirmaDesligar: "Desligar o Instagram? A gente apaga o acesso que guardamos e deixa de ler os números direto dele. Você pode ligar de novo quando quiser.",
    confirmaSim: "Sim, desligar",
    confirmaNao: "Manter ligado",
    desligado: "Instagram desligado.",
    erroDesligar: "Não conseguimos desligar agora. Tente de novo em um minuto.",
    semConexao: "Sem conexão agora. Tente de novo quando voltar a internet.",
    escolher: { esta: "Escolher", escolhendo: "Escolhendo", validade: "Essa escolha vale por 30 minutos.", pagina: (nome: string) => `Página ${nome}`, escolhida: "Instagram ligado." },
    erroEscolher: "Não conseguimos escolher agora. Tente de novo em um minuto.",
  },

  /** Guardadas na conta ligada (`contas_conectadas.erro`) e mostradas na tela do PR 2. */
  erroDaConta: {
    recusada: "A Meta não aceita mais o acesso ao seu Instagram. Ligue de novo para continuar.",
    semPermissao: "A Meta não deixou ler os números do seu Instagram. Ligue de novo e libere tudo o que ela mostrar.",
    naoRenovou: "Não conseguimos renovar o acesso ao seu Instagram. Ligue de novo antes que ele pare de valer.",
    venceu: "O acesso ao seu Instagram venceu. Ligue de novo para voltarmos a ler os números dos seus vídeos.",
    ilegivel: "Não conseguimos abrir o acesso guardado do seu Instagram. Ligue de novo.",
  },

  /** E-mail para o dono da conta, uma vez, quando a ligação não renova mais (E19, "o aviso quando não dá para renovar"). */
  emailAviso: {
    assunto: "Ligue de novo o seu Instagram",
    corpo: (nomeDaConta: string, nomeDaMarca: string) =>
      envolverEmail(
        `<p>O acesso do Instagram <strong>${escaparHtml(nomeDaConta)}</strong> à conta <strong>${escaparHtml(nomeDaMarca)}</strong> está para vencer ou já não vale mais, e não conseguimos renová-lo sozinhos.</p>` +
          `<p>Enquanto isso, seguimos acompanhando os seus vídeos pelo caminho de antes, só que com menos detalhe. Para voltar ao normal, abra a tela de Conta e ligue o Instagram de novo; leva um minuto.</p>` +
          `<p>${linkEmail(`${config.appUrl}/conta`, "abrir a tela de Conta")}</p>`,
      ),
  },

  /** A página pública que a Meta mostra à pessoa depois de um pedido de exclusão de dados (`/dados/exclusao?codigo=...`). */
  exclusao: {
    titulo: "Pedido de exclusão de dados",
    recebido: (codigo: string, quando: string, apagadas: number) => [
      {
        titulo: "Situação do pedido",
        paragrafos: [
          `Código de confirmação: ${codigo}.`,
          `Pedido recebido e atendido em ${quando}.`,
          apagadas > 0
            ? "Apagamos a ligação do seu Instagram com este aplicativo, o acesso guardado e os números dos seus vídeos que tínhamos lido por ela."
            : "Não encontramos nenhuma ligação do seu Instagram com este aplicativo, então não havia nada a apagar por este caminho.",
          `Se você também quiser apagar o resto dos seus dados, escreva para ${config.emailContato}.`,
        ],
      },
    ],
    naoEncontrado: [
      {
        titulo: "Situação do pedido",
        paragrafos: [`Não encontramos um pedido com esse código. Confira o código que a Meta mostrou ou escreva para ${config.emailContato}.`],
      },
    ],
  },
};

/** O nome vem da Meta e da pessoa: nunca entra no HTML do e-mail sem escapar. */
function escaparHtml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
