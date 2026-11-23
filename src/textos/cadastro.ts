import { TETO_DO_TESTE } from "@/config/cadastro";
import { config } from "@/lib/config";

import { envolverEmail, linkEmail } from "./casca-email";

/** O nome do negócio vem da pessoa e entra no HTML do e-mail para o admin. */
function escaparHtml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * E63 PR 1: os textos do cadastro sozinho. As telas bonitas vêm no PR 2; aqui ficam as frases que o servidor já devolve e as duas páginas simples (confirmar o e-mail e o limite do
 * teste). Sem jargão: quem lê é dono de pequeno negócio.
 */
export const textosCadastro = {
  erros: {
    nome: "Escreva o seu nome.",
    negocio: "Escreva o nome do seu negócio.",
    email: "Confira o e-mail: ele parece incompleto.",
    emailDescartavel: "Esse tipo de e-mail temporário não serve. Use o e-mail que você lê todo dia.",
    senhaCurta: "A senha precisa ter pelo menos 8 caracteres.",
    senhaLonga: "A senha pode ter no máximo 128 caracteres.",
    aceite: "Para criar a conta, aceite os termos de uso e a política de privacidade.",
    jaExiste: "Esse e-mail já tem uma conta. Entre com ele, ou peça uma senha nova em \"esqueci a senha\".",
    limite: "Muitas tentativas agora. Espere alguns minutos e tente de novo.",
    cheio: "Muita gente criando conta neste momento. Tente de novo daqui a pouco.",
    fechado: "O cadastro ainda não está aberto. Deixe o seu contato na página inicial e a gente conversa.",
    generico: "Não foi possível criar a conta agora. Tente de novo em instantes.",
  },

  /** O e-mail com o link de confirmar. Vale 24 horas e só funciona uma vez. */
  assuntoConfirmacao: `Confirme o seu e-mail em ${config.appName}`,
  corpoConfirmacao: (opcoes: { url: string; nome: string }) =>
    envolverEmail(
      `<p>Oi, ${escaparHtml(opcoes.nome)}. Falta só um passo: confirme que este e-mail é seu.</p>` +
        `<p>${linkEmail(opcoes.url, "Confirmar o meu e-mail")}</p>` +
        `<p>O link vale por 24 horas e só funciona uma vez. Se ele vencer, entre no aplicativo e peça outro.</p>` +
        `<p>Se não foi você que criou a conta, pode ignorar este e-mail.</p>`,
    ),

  /** O aviso ao admin a cada conta nova: só o nome do negócio e o e-mail, nada além. */
  assuntoAvisoAoAdmin: (negocio: string) => `Conta nova: ${negocio}`,
  corpoAvisoAoAdmin: (opcoes: { negocio: string; email: string; adminUrl: string }) =>
    envolverEmail(
      `<p>Entrou uma conta nova pelo cadastro.</p><p>Negócio: ${escaparHtml(opcoes.negocio)}<br/>E-mail: ${escaparHtml(opcoes.email)}</p><p>${linkEmail(opcoes.adminUrl, "Abrir o admin")}</p>`,
    ),

  /** A página de quem ainda não confirmou o e-mail: é tudo o que o painel mostra até confirmar. */
  confirmeSeuEmail: {
    titulo: "Confirme o seu e-mail",
    texto: (email: string) => `Mandamos um link para ${email}. Toque nele para liberar a sua conta. Se não chegou, olhe também a caixa de spam.`,
    reenviar: "Mandar outro link",
    reenviado: "Mandamos outro link. Olhe a sua caixa de entrada.",
    jaConfirmado: "O seu e-mail já está confirmado.",
    esperar: "Espere um minuto antes de pedir outro link.",
    limiteDeReenvios: "Você já pediu links demais por hoje. Tente de novo amanhã, ou use o último que recebeu.",
    linkInvalido: "Esse link não vale mais: já foi usado, venceu ou está errado. Peça outro abaixo.",
  },

  /** A página de quem chegou ao limite do teste: o caminho para assinar. */
  limiteDoTeste: {
    titulo: "Você chegou ao limite do teste",
    roteiros: `Você já criou os ${TETO_DO_TESTE.roteiros} roteiros do teste.`,
    edicoes: `Você já usou as ${TETO_DO_TESTE.edicoes} edições de vídeo do teste.`,
    uso: "Você já usou tudo o que o teste inclui.",
    assinar: "Para continuar, assine o plano. O que você já criou fica guardado.",
    botao: "Ver o plano",
  },
  /** A frase curta que as rotas devolvem (a tela de cada ação decide como mostrar). */
  limiteDoTesteCurto: "Você chegou ao limite do teste. Para continuar, assine o plano.",
  confirmeSeuEmailCurto: "Confirme o seu e-mail para continuar.",

  /** O admin dá acesso a um e-mail que já criou conta sozinho e ainda não confirmou: recusa, para ninguém herdar a marca de outro. */
  adminEmailNaoConfirmado: "Essa pessoa criou uma conta sozinha e ainda não confirmou o e-mail. Peça para ela confirmar antes de dar acesso.",
};
