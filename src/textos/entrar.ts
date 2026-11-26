import { LIMITE_DE_LINKS_POR_HORA, TRAVA_EM_MINUTOS, VALIDADE_DA_SENHA_PROVISORIA_EM_HORAS } from "@/lib/entrada-regras";

export const textosEntrar = {
  /** E63 PR 2: o rodapé de Entrar quando o cadastro está aberto (a chave `CADASTRO_ABERTO`). */
  cadastro: { pergunta: "Ainda não tem conta?", botao: "Começar o teste grátis" },
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
  /**
   * Os freios por pessoa (auditoria de 26/11/2026, A3 e M7, `lib/entrada-regras.ts`): a trava depois de senhas erradas seguidas, que deixa o link por e-mail de pé; a
   * senha provisória do convite, que vence em 48 horas; e o teto de links por hora. O servidor manda a mesma frase no erro e a tela escolhe pelo código.
   */
  contaTravada: `muitas senhas erradas seguidas neste e-mail; por segurança, entrar com senha fica parado por ${TRAVA_EM_MINUTOS} minutos, mas dá para entrar agora sem senha, pelo link no e-mail`,
  senhaProvisoriaVencida: `esta senha provisória venceu, ela vale ${VALIDADE_DA_SENHA_PROVISORIA_EM_HORAS} horas; peça uma senha nova a quem criou o seu acesso, ou toque em "esqueci a senha" para escolher a sua`,
  linksDemais: `já mandamos ${LIMITE_DE_LINKS_POR_HORA} links para este e-mail na última hora; use o último que chegou ou espere um pouco e peça de novo`,
  erroDeServidor: "não deu para entrar agora; tente de novo em instantes",
  /** O link por e-mail nao tem senha: o "e-mail ou senha não conferem" nao serve para ele. */
  erroLink: "não conseguimos mandar o link agora; tente de novo em instantes",
  semConexaoLink: "sem conexão para mandar o link agora; confira a rede e tente de novo",
  /**
   * E58, "esqueci a senha": a resposta é a mesma exista ou não a conta (a tela não revela quem tem cadastro), por isso a frase fala em "se esse e-mail tiver uma conta".
   */
  esqueciALink: "esqueci a senha",
  esqueciExplica: "Escreva o seu e-mail. Se ele tiver uma conta, mandamos um link para você escolher uma senha nova.",
  esqueciBotao: "mandar o link",
  esqueciMandando: "mandando o link",
  esqueciVoltar: "voltar para entrar",
  esqueciEnviado: (email: string) =>
    `Se ${email} tiver uma conta, o link já está a caminho. Ele vale por 30 minutos e só funciona uma vez. Se não chegar, olhe também a caixa de spam.`,
  esqueciMandarDeNovo: "mandar de novo",
  esqueciErro: "não conseguimos mandar o link agora; tente de novo em instantes",
  esqueciSemConexao: "sem conexão para mandar o link agora; confira a rede e tente de novo",
};
