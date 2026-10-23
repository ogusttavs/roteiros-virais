import { config } from "@/lib/config";

import { envolverEmail, linkEmail } from "./casca-email";

/**
 * E19 PR 1: as frases da ligação do Instagram feita pela própria pessoa. A tela de verdade (em Conta, "Seu Instagram") é do PR 2; aqui ficam as frases que o servidor já precisa dizer
 * (o retorno do diálogo da Meta, o erro guardado na conta ligada, o e-mail de aviso e a página de status da exclusão). Linguagem de quem dirige um negócio pequeno: nada de "token",
 * "permissão de API" ou "login social".
 */

/** O que o retorno do diálogo da Meta manda para `/conta?instagram=<código>`. Cada código tem a sua frase (a tela do PR 2 as mostra). */
export type CodigoDoRetorno = "ligada" | "escolher" | "cancelou" | "venceu" | "permissao" | "sem-instagram" | "ja-ligada" | "falhou" | "nao-configurada" | "sem-acesso";

export const textosLigacao = {
  retorno: {
    ligada: "Pronto, o seu Instagram está ligado. A partir de agora lemos os números dos seus vídeos direto dele.",
    escolher: "Encontramos mais de um Instagram. Escolha qual é o seu.",
    cancelou: "Você não liberou o acesso, então nada foi ligado. Pode tentar de novo quando quiser.",
    venceu: "Essa tentativa venceu. Comece de novo e termine em até dez minutos.",
    permissao: "Faltou liberar alguma coisa. Para a ligação funcionar, libere tudo o que a Meta mostrar na tela.",
    "sem-instagram":
      "Não achamos um Instagram profissional ligado à Página que você escolheu. Confira se o seu Instagram é uma conta profissional e se está ligado a uma Página do Facebook.",
    "ja-ligada": "Este Instagram já está ligado a outra conta aqui. Desligue lá primeiro e tente de novo.",
    falhou: "Não deu para ligar agora. Tente de novo daqui a pouco.",
    "nao-configurada": "A ligação direta com o Instagram ainda não está aberta para você.",
    "sem-acesso": "Só quem criou a conta pode ligar o Instagram, e a ligação precisa ser começada por aqui. Comece de novo pela tela de Conta.",
  } satisfies Record<CodigoDoRetorno, string>,

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
