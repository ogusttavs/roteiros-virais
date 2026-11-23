import { TETO_DO_TESTE } from "@/config/cadastro";
import { config } from "@/lib/config";

import { envolverEmail, linkEmail } from "./casca-email";
import { PRECO_TRIMESTRAL_MES, PRECO_TRIMESTRAL_TOTAL } from "./interessados";

/** O nome do negócio vem da pessoa e entra no HTML do e-mail para o admin. */
function escaparHtml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * E63 PR 1: os textos do cadastro sozinho. As telas bonitas vêm no PR 2; aqui ficam as frases que o servidor já devolve e as duas páginas simples (confirmar o e-mail e o limite do
 * teste). Sem jargão: quem lê é dono de pequeno negócio.
 */
export const textosCadastro = {
  /** O que o servidor devolve campo a campo e a frase geral: os textos aprovados do desenho (E63, 23/11/2026). */
  erros: {
    nome: "Escreva o seu nome.",
    negocio: "Escreva o nome do seu negócio, ou o do seu perfil.",
    email: "Esse e-mail não parece certo. Confira.",
    emailDescartavel: "Use um e-mail que você lê sempre. Esse endereço é temporário e some sozinho.",
    senhaCurta: "A senha precisa de pelo menos 8 caracteres.",
    senhaLonga: "A senha pode ter no máximo 128 caracteres.",
    aceite: "Marque a caixa para criar a conta.",
    limite: "Muitas tentativas em pouco tempo. Espere alguns minutos e tente de novo.",
    cheio: "Muita gente criando conta neste momento. Tente de novo daqui a pouco.",
    fechado: "O cadastro ainda não está aberto. Deixe o seu contato na página inicial e a gente conversa.",
    generico: "Não deu para criar a conta agora. Tente de novo em instantes: o que você escreveu continua aqui.",
    semConexao: "Sem conexão agora. Confira o sinal e tente de novo: o que você escreveu continua aqui.",
  },
  /** Campo vazio: o servidor só diz "inválido"; a tela troca pela frase de quem esqueceu de escrever. */
  vazios: {
    nome: "Escreva o seu nome.",
    negocio: "Escreva o nome do seu negócio, ou o do seu perfil.",
    email: "Escreva o seu e-mail.",
    senha: "Escolha uma senha.",
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

  /** Para quem tentou criar conta com um e-mail que já tem uma: a tela responde igual a um cadastro novo, e é só este e-mail que conta a verdade. */
  assuntoJaTemConta: `Você já tem conta em ${config.appName}`,
  corpoJaTemConta: (opcoes: { entrarUrl: string; esqueciUrl: string }) =>
    envolverEmail(
      `<p>Alguém tentou criar uma conta com este e-mail, mas ele já tem uma.</p>` +
        `<p>${linkEmail(opcoes.entrarUrl, "Entrar na minha conta")}</p>` +
        `<p>Se você não lembra da senha, ${linkEmail(opcoes.esqueciUrl, "peça uma senha nova")}.</p>` +
        `<p>Se não foi você que tentou, pode ignorar este e-mail: nada mudou na sua conta.</p>`,
    ),

  /** O aviso ao admin a cada conta nova: só o nome do negócio e o e-mail, nada além. */
  assuntoAvisoAoAdmin: (negocio: string) => `Conta nova: ${negocio}`,
  corpoAvisoAoAdmin: (opcoes: { negocio: string; email: string; adminUrl: string }) =>
    envolverEmail(
      `<p>Entrou uma conta nova pelo cadastro.</p><p>Negócio: ${escaparHtml(opcoes.negocio)}<br/>E-mail: ${escaparHtml(opcoes.email)}</p><p>${linkEmail(opcoes.adminUrl, "Abrir o admin")}</p>`,
    ),

  /** "Confirme o seu e-mail" e as peças dele: a página de quem ainda não confirmou (tudo o que o painel mostra até confirmar), o reenvio, a troca e o link vencido. */
  confirmeSeuEmail: {
    titulo: "Confirme o seu e-mail",
    subtitulo: "É o último passo antes do seu briefing.",
    texto: "Mandamos um link para esse endereço. Toque nele para confirmar e seguir para o briefing.",
    prazo: "vale por 24 horas",
    spam: "Não chegou em alguns minutos? Olhe a caixa de spam e a de promoções.",
    reenviar: "Mandar de novo",
    reenviarEspera: "Mandar de novo em 1 minuto",
    reenviado: "Mandamos de novo para o mesmo endereço.",
    trocar: "Trocar o e-mail",
    jaConfirmado: "O seu e-mail já está confirmado.",
    esperar: "Espere um minuto antes de pedir outro link.",
    limiteDeReenvios: "Você já pediu links demais por hoje. Tente de novo amanhã, ou use o último que recebeu.",
    semConexao: "Sem conexão agora. Confira o sinal e tente de novo.",
    falha: "Não deu para mandar agora. Tente de novo em instantes.",
  },
  trocarEmail: {
    titulo: "Trocar o e-mail",
    texto: "Escreva o e-mail certo. O link que mandamos para o outro deixa de valer.",
    campo: "E-mail",
    botao: "Mandar para este e-mail",
    mandando: "Mandando",
    voltar: "Voltar",
  },
  linkVencido: {
    titulo: "Esse link já venceu",
    texto: "O link de confirmação vale por 24 horas e só funciona uma vez. Peça outro: ele chega em seguida.",
    botao: "Mandar outro link",
    jaConfirmei: "Já confirmei, quero entrar",
  },
  emailConfirmado: {
    titulo: "E-mail confirmado",
    subtitulo: "A sua conta está criada. Agora vem o briefing.",
    itens: [
      "Doze perguntas sobre o seu trabalho e sobre quem você atende. É com elas que o roteiro sai do seu jeito, e não um texto que serviria para qualquer um.",
      "Leva cerca de 20 minutos. Dá para parar no meio: tudo salva sozinho.",
      "Depois do briefing, começam os seus 7 dias grátis.",
    ],
    botao: "Ir para o briefing",
  },

  /** A tela "Criar a conta" e o caminho do teste. Os números do teste vêm de `TETO_DO_TESTE`, nunca escritos à mão. */
  criarConta: {
    titulo: "Crie a sua conta",
    subtitulo: "Leva um minuto. Em seguida vem o seu briefing.",
    nome: { rotulo: "Seu nome", marcador: "Como você se chama" },
    negocio: { rotulo: "Nome do seu negócio", ajuda: "Ou o nome do seu perfil, se quem vende é você." },
    email: { rotulo: "E-mail", marcador: "voce@seunegocio.com.br", ajuda: "É para ele que vai o link de confirmação." },
    senha: { rotulo: "Senha", ajuda: "Pelo menos 8 caracteres.", mostrar: "Mostrar a senha", esconder: "Esconder a senha" },
    aceite: "Li e aceito os termos de uso e a política de privacidade.",
    lerTermos: "Ler os termos",
    lerPrivacidade: "Ler a privacidade",
    botao: "Começar o teste grátis",
    enviando: "Criando a sua conta",
    /** Texto puro (a tela de cliente recebe os textos por props, e função não atravessa): `{n}` vira o número de pontos. */
    confiraUm: "Confira o ponto marcado acima.",
    confiraVarios: "Confira os {n} pontos marcados acima.",
    linhaTeste: {
      destaque: "7 dias grátis, sem cartão.",
      limites: `No teste, até ${TETO_DO_TESTE.roteiros} roteiros e ${TETO_DO_TESTE.edicoes} vídeos editados.`,
      preco: `Depois, ${PRECO_TRIMESTRAL_MES} por mês no plano trimestral, se você quiser continuar.`,
    },
    jaTemConta: "Já tem conta?",
    entrar: "Entrar",
  },
  caminho: {
    rotulo: "Como é o teste",
    agora: "agora",
    feito: "feito",
    passos: [
      { titulo: "Crie a sua conta", texto: "Nome, e-mail e senha. Sem cartão." },
      { titulo: "Confirme o e-mail", texto: "Mandamos um link na hora." },
      { titulo: "Responda o briefing", texto: "Doze perguntas sobre o seu trabalho, cerca de 20 minutos. Dá para parar no meio." },
      {
        titulo: "Use 7 dias grátis",
        texto: `O aplicativo de verdade, no seu ramo, com até ${TETO_DO_TESTE.roteiros} roteiros e ${TETO_DO_TESTE.edicoes} vídeos editados. Se não quiser continuar, não precisa fazer nada: o teste termina sozinho e nada é cobrado.`,
      },
    ],
    preco: {
      antes: "Depois, se quiser continuar: ",
      valor: PRECO_TRIMESTRAL_MES,
      depois: ` por mês no plano trimestral, cobrados ${PRECO_TRIMESTRAL_TOTAL} a cada 3 meses, só no cartão. Sem taxa de adesão.`,
    },
  },
  /** O cadastro fechado (a chave desligada): o formulário de interessado de hoje, com o cabeçalho próprio. */
  cadastroFechado: {
    titulo: "O teste começa por conversa",
    subtitulo: "Estamos abrindo aos poucos. Deixe seus dados e a gente entra em contato para combinar o teste.",
    jaTenhoConta: "Já tenho conta, quero entrar",
    enviado: "Pedido enviado",
    enviadoTitulo: "Recebemos o seu pedido",
    enviadoTexto: "A gente entra em contato com você pelo WhatsApp ou pelo e-mail para combinar o teste.",
    voltar: "Voltar para a página",
  },

  /** A folha de quem bate no limite do teste. O preço e o período são os do plano único; o número de edições por mês vem de `LIMITES_DA_EDICAO`. */
  limiteDoTeste: {
    tituloRoteiros: `Os ${TETO_DO_TESTE.roteiros} roteiros do teste acabaram`,
    tituloEdicoes: `As ${TETO_DO_TESTE.edicoes} edições do teste acabaram`,
    tituloUso: "O que o teste inclui acabou",
    contadorRoteiros: { numero: `${TETO_DO_TESTE.roteiros} de ${TETO_DO_TESTE.roteiros}`, texto: "roteiros do teste usados" },
    contadorEdicoes: { numero: `${TETO_DO_TESTE.edicoes} de ${TETO_DO_TESTE.edicoes}`, texto: "vídeos editados no teste" },
    contadorUso: { numero: "100%", texto: "do que o teste inclui usado" },
    paraContinuarRoteiros: "Para escrever o próximo roteiro, assine o plano. Assinando agora, o teste termina hoje e o limite sai na hora.",
    paraContinuarEdicoes: (porMes: number) =>
      `Para mandar mais vídeos para a gente editar, assine o plano: são até ${porMes} edições por mês. Assinando agora, o teste termina hoje e o limite sai na hora.`,
    paraContinuarUso: "Para continuar, assine o plano. Assinando agora, o teste termina hoje e o limite sai na hora.",
    aindaTemRoteiros: "Os roteiros que você já tem continuam abertos até o fim do teste, para você gravar.",
    aindaTemEdicoes: 'Este vídeo você ainda pode editar no celular, com o "Como editar" do roteiro.',
    aindaTemUso: "O que você já criou fica guardado.",
    plano: {
      rotulo: "Plano trimestral",
      valor: PRECO_TRIMESTRAL_MES,
      porMes: "por mês",
      cobranca: `Cobrado ${PRECO_TRIMESTRAL_TOTAL} a cada 3 meses, só no cartão. Sem taxa para entrar.`,
      cancelar: "Você cancela quando quiser, pela própria conta. O plano vale até o fim do período que você já pagou.",
    },
    botao: `Assinar por ${PRECO_TRIMESTRAL_TOTAL} a cada 3 meses`,
    agoraNao: "Agora não",
    stripe: "O pagamento é feito na página segura do Stripe. A gente não vê os dados do seu cartão.",
    fechar: "Fechar",
  },
  /** A frase curta que as rotas devolvem (a tela de cada ação decide como mostrar). */
  limiteDoTesteCurto: "Você chegou ao limite do teste. Para continuar, assine o plano.",
  confirmeSeuEmailCurto: "Confirme o seu e-mail para continuar.",

  /** O admin dá acesso a um e-mail que já criou conta sozinho e ainda não confirmou: recusa, para ninguém herdar a marca de outro. */
  adminEmailNaoConfirmado: "Essa pessoa criou uma conta sozinha e ainda não confirmou o e-mail. Peça para ela confirmar antes de dar acesso.",
};
