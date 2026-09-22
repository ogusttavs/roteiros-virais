export const textosEntrar = {
  titulo: "Bom te ver",
  campoEmail: "e-mail",
  campoSenha: "senha",
  botaoEntrar: "entrar",
  entrando: "entrando",
  linkSemSenha: "entrar sem senha, receber um link por e-mail",
  mandandoLink: "mandando o link",
  erroGenerico: "e-mail ou senha não conferem",
  erroSemEmail: "escreva o seu e-mail para mandar o link",
  linkEnviado: (email: string) => `Mandamos um link para ${email}. Vale por 15 minutos.`,
  mandarDeNovo: "mandar de novo",
  /**
   * Falhas que nao sao "senha errada" (V7, item 4 do PROXIMO.md): a rede caiu
   * ou travou, o limite de tentativas, o servidor falhou. Nenhuma mexe no que
   * foi digitado: e-mail e senha continuam nos campos.
   */
  semConexao: "sem conexão para entrar agora; confira a rede e tente de novo",
  muitasTentativas: "muitas tentativas seguidas; espere um minuto e tente de novo",
  erroDeServidor: "não deu para entrar agora; tente de novo em instantes",
  /** O link por e-mail nao tem senha: o "e-mail ou senha não conferem" nao serve para ele. */
  erroLink: "não conseguimos mandar o link agora; tente de novo em instantes",
  semConexaoLink: "sem conexão para mandar o link agora; confira a rede e tente de novo",
};
