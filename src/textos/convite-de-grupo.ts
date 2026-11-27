import { config } from "@/lib/config";

import { envolverEmail, linkEmail } from "./casca-email";

/** O nome da empresa e o do dono vêm de pessoas e entram no HTML dos e-mails. */
function escaparHtml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Convite de grupo (27/11/2026): os textos da página do link, das ações do dono (criar outra empresa, dar e tirar acesso) e dos e-mails. A frase de link inválido é UMA só, sem
 * dizer o motivo (usado, vencido ou desativado): quem não tem o link certo não aprende nada sobre os outros.
 */
export const textosConviteDeGrupo = {
  linkInvalido: {
    titulo: "Este link não vale mais",
    texto: "Este link não vale mais. Peça um novo a quem te mandou.",
    entrar: "Já tenho conta, quero entrar",
  },
  pagina: {
    titulo: "Crie o seu acesso",
    subtitulo: "Você vai criar a primeira empresa agora e, depois, as outras dentro do aplicativo.",
    nome: { rotulo: "Seu nome", marcador: "Como você se chama" },
    empresa: { rotulo: "Nome da empresa", ajuda: "A primeira. As outras você cria depois, dentro do aplicativo." },
    email: { rotulo: "E-mail", marcador: "voce@suaempresa.com.br" },
    senha: { rotulo: "Senha", ajuda: "Pelo menos 8 caracteres.", mostrar: "Mostrar a senha", esconder: "Esconder a senha" },
    aceite: "Li e aceito os termos de uso e a política de privacidade.",
    lerTermos: "Ler os termos",
    lerPrivacidade: "Ler a privacidade",
    botao: "Criar o meu acesso",
    enviando: "Criando o seu acesso",
    confiraUm: "Confira o ponto marcado acima.",
    confiraVarios: "Confira os {n} pontos marcados acima.",
    jaTemConta: "Já tem conta?",
    entrar: "Entrar",
  },
  erros: {
    jaTemConta: "Esse e-mail já tem conta. Entre com ele e fale com a gente para ligar a empresa.",
    limite: "Muitas tentativas em pouco tempo. Espere alguns minutos e tente de novo.",
    generico: "Não deu para criar o acesso agora. Tente de novo em instantes: o que você escreveu continua aqui.",
    semConexao: "Sem conexão agora. Confira o sinal e tente de novo: o que você escreveu continua aqui.",
  },

  /** O bloco "Suas empresas" da Conta: só aparece para quem criou o acesso por um convite de grupo. */
  empresas: {
    titulo: "Suas empresas",
    explica: "Cada empresa tem os próprios temas, roteiros e histórico. Para trocar de empresa, use o seletor no alto.",
    contagem: (usadas: number, maximo: number) => `${usadas} de ${maximo}`,
    campo: "Nome da nova empresa",
    marcador: "Por exemplo, Clínica Centro",
    botao: "Criar outra empresa",
    criando: "Criando",
    cheio: "Você chegou ao limite de empresas. Fale com a gente para abrir mais.",
    nomeInvalido: "Escreva o nome da empresa, com até 80 caracteres.",
    erro: "Não deu para criar a empresa agora. Tente de novo em instantes.",
    semPermissao: "Esta conta não pode criar empresas.",
  },

  /** As pessoas da empresa: no lugar do "fale com a gente" da Conta, quando a empresa ativa é do grupo e quem olha é o dono dela. */
  pessoas: {
    campo: "E-mail de quem vai entrar",
    marcador: "pessoa@suaempresa.com.br",
    dar: "Dar acesso",
    dando: "Mandando",
    tirar: "Tirar acesso",
    tirando: "Tirando",
    pronto: (email: string) => `Pronto. Mandamos um e-mail para ${email} com o acesso.`,
    removido: "Acesso retirado.",
    emailInvalido: "Esse e-mail não parece certo. Confira.",
    limite: "Você já deu acesso a muita gente por hoje. Tente de novo amanhã.",
    erro: "Não deu para fazer isso agora. Tente de novo em instantes.",
    semPermissao: "Só quem criou a empresa pode mudar quem entra nela.",
    dono: "dono",
  },

  /** O e-mail de quem ganha acesso a uma empresa que já existe: sem a frase do briefing, que é de quem começa do zero. */
  assuntoAcessoNovo: (empresa: string) => `Você ganhou acesso à empresa ${empresa}`,
  corpoAcessoNovo: (opcoes: { empresa: string; nome: string | null; url: string; entrarUrl: string }) =>
    envolverEmail(
      `<p>${opcoes.nome ? `Oi, ${escaparHtml(opcoes.nome)}. ` : ""}Você ganhou acesso à empresa ${escaparHtml(opcoes.empresa)} no ${config.appName}.</p>` +
        `<p>Entre pelo link e escolha a sua senha.</p>` +
        `<p>${linkEmail(opcoes.url, "Entrar e escolher a senha")}</p>` +
        `<p>Este link vale por 48 horas e só funciona uma vez. Se ele vencer, é só abrir ${linkEmail(opcoes.entrarUrl, "a página de entrar")} e tocar em "esqueci a senha".</p>`,
    ),
  /** Para quem já tinha conta e foi ligado a mais uma empresa: só o aviso e o caminho de entrar. */
  assuntoAcessoNaConta: (empresa: string) => `Você ganhou acesso à empresa ${empresa}`,
  corpoAcessoNaConta: (opcoes: { empresa: string; entrarUrl: string }) =>
    envolverEmail(`<p>Você ganhou acesso à empresa ${escaparHtml(opcoes.empresa)} no ${config.appName}.</p><p>${linkEmail(opcoes.entrarUrl, "Entrar")} e escolher a empresa no seletor do alto.</p>`),

  /** O aviso ao admin quando alguém abre um convite e cria o acesso. */
  assuntoAvisoAoAdmin: (rotulo: string) => `Convite de grupo usado: ${rotulo}`,
  corpoAvisoAoAdmin: (opcoes: { rotulo: string; empresa: string; email: string; adminUrl: string }) =>
    envolverEmail(
      `<p>Um convite de grupo foi usado.</p><p>Convite: ${escaparHtml(opcoes.rotulo)}<br/>Empresa: ${escaparHtml(opcoes.empresa)}<br/>E-mail: ${escaparHtml(opcoes.email)}</p><p>${linkEmail(opcoes.adminUrl, "Abrir o admin")}</p>`,
    ),
};
