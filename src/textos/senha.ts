/**
 * E58: a senha na mão da pessoa (trocar na Conta, trocar no primeiro acesso, esqueci a senha). O que está em `entrar.ts` é só o pedido do link, dentro da tela de entrar.
 * Sem "token", sem "sessão": quem lê é dono de pequeno negócio.
 */
export const textosSenha = {
  /** Os dois campos de senha nova, iguais nas três telas. */
  campoNova: "senha nova",
  campoRepetir: "repita a senha nova",
  ajudaMinimo: "Use pelo menos 8 caracteres.",
  erroCurta: "a senha precisa de pelo menos 8 caracteres",
  erroLonga: "a senha pode ter no máximo 128 caracteres",
  erroNaoConferem: "as duas senhas não são iguais",
  erroDeServidor: "não conseguimos trocar a senha agora; tente de novo em um minuto",
  semConexao: "sem conexão para trocar a senha agora; confira a rede e tente de novo",

  /** Conta: o cartão "Senha". */
  conta: {
    titulo: "Senha",
    explica: "Troque a senha por uma que só você sabe. Quem está com a sua conta aberta em outro aparelho precisa entrar de novo.",
    abrir: "trocar a senha",
    campoAtual: "senha de agora",
    campoNova: "senha nova",
    salvar: "trocar a senha",
    salvando: "trocando",
    cancelar: "cancelar",
    atualErrada: "a senha de agora não confere",
    igual: "a senha nova precisa ser diferente da de agora",
    feito: "Senha trocada. Nos outros aparelhos você vai precisar entrar de novo.",
    muitasTentativas: "muitas tentativas seguidas; espere um minuto e tente de novo",
  },

  /** Primeiro acesso de quem entrou por convite: a tela que vem antes do resto. */
  primeiroAcesso: {
    titulo: "Escolha a sua senha",
    explica: "A senha que veio no convite é provisória e quem criou o seu acesso a conhece. Escolha uma só sua para continuar.",
    botao: "salvar a minha senha",
    salvando: "salvando",
    igualProvisoria: "a senha nova precisa ser diferente da provisória",
  },

  /** A tela do link do e-mail: escolher a senha nova. */
  redefinir: {
    titulo: "Escolha uma senha nova",
    explica: "Depois de salvar, você entra com ela. Se tinha o painel aberto em outro aparelho, vai precisar entrar de novo lá.",
    botao: "salvar a senha nova",
    salvando: "salvando",
    feito: "Senha trocada. Agora é só entrar com a nova.",
    irParaEntrar: "ir para entrar",
    linkInvalidoTitulo: "Este link não vale mais",
    linkInvalidoTexto: "Ele vale por 30 minutos e só pode ser usado uma vez. Peça um link novo na tela de entrar.",
    pedirOutro: "pedir um link novo",
    muitasTentativas: "muitas tentativas seguidas; espere um minuto e tente de novo",
  },
};
