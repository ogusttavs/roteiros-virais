import { escaparHtml } from "@/lib/chromium-de-impressao";
import { config } from "@/lib/config";

import { envolverEmail } from "./casca-email";

/**
 * A página de entrada (`/`, E57a): o que o produto faz em três passos, o porquê em uma frase, o preço do plano trimestral e o "Quero testar". Os textos seguem as regras do
 * projeto (sem jargão, "você" no singular, nada de promessa que o produto não cumpre) e a tese do `CLAUDE.md`: quem aparece é a pessoa, nunca um vídeo feito por inteligência
 * artificial. O nome do produto vem de `APP_NAME` (`config.appName`), nunca escrito aqui. O preço é o do plano trimestral da grade (R$ 397 por mês); se mudar, muda aqui.
 */
export const PRECO_TRIMESTRAL_MES = "R$ 397";
export const PRECO_TRIMESTRAL_TOTAL = "R$ 1.191";

export const textosInteressados = {
  topo: { entrar: "Entrar" },
  heroi: {
    titulo: "Todo dia, o roteiro pronto para você gravar.",
    subtitulo:
      "A gente descobre o que está funcionando no seu ramo e escreve o roteiro, com a edição junto. Você grava no celular, do seu jeito. Quem aparece no vídeo é você.",
    botao: "Quero testar",
  },
  passos: {
    titulo: "Como funciona",
    itens: [
      {
        numero: "1",
        titulo: "Todo dia, o que está funcionando no seu ramo",
        texto: "A gente acompanha os vídeos que mais cresceram entre negócios como o seu e separa três assuntos para você escolher.",
      },
      {
        numero: "2",
        titulo: "Um roteiro pronto, com a edição junto",
        texto: "Você escolhe o assunto e recebe o que falar, em que ordem, o que mostrar e o que colocar na tela. Pronto para gravar e editar no celular.",
      },
      {
        numero: "3",
        titulo: "Você grava, a gente acompanha",
        texto: "Você marca o vídeo como postado e a gente guarda o histórico, lembra você de gravar no dia seguinte e escreve os próximos levando em conta o que você aprovou e o que recusou.",
      },
    ],
  },
  porque: {
    titulo: "Por que aparecer você mesmo",
    frase:
      "Vídeo feito por inteligência artificial está ficando comum, e o cliente de um negócio como o seu escolhe quem ele vê de verdade: por isso aqui quem aparece é você, nunca um avatar.",
  },
  preco: {
    titulo: "O plano",
    nomeDoPlano: "Trimestral",
    porMes: `${PRECO_TRIMESTRAL_MES} por mês`,
    total: `${PRECO_TRIMESTRAL_TOTAL} a cada 3 meses`,
    detalhes: ["Um roteiro novo todo dia, com a edição junto.", "Sem taxa de adesão.", "Você cancela quando quiser."],
  },
  formulario: {
    ancora: "quero-testar",
    titulo: "Quero testar",
    subtitulo: "Deixe seus dados e a gente entra em contato para combinar o teste.",
    nome: { rotulo: "Seu nome", marcador: "Como você se chama" },
    email: { rotulo: "Seu e-mail", marcador: "voce@exemplo.com.br" },
    whatsapp: { rotulo: "Seu WhatsApp", ajuda: "Com o DDD.", marcador: "11 91234-5678" },
    ramo: { rotulo: "Seu ramo", ajuda: "Por exemplo: dentista, loja de produtos de limpeza, estética automotiva.", marcador: "O que o seu negócio faz" },
    aceiteAntes: "Aceito que a gente entre em contato por WhatsApp e por e-mail sobre o teste. Veja a ",
    aceiteLink: "política de privacidade",
    aceiteDepois: ".",
    privacidade: `Usamos seus dados só para falar com você sobre o teste. Para apagar, escreva para ${config.emailContato}.`,
    botao: "Quero testar",
    enviando: "Enviando",
    sucessoTitulo: "Recebemos o seu pedido.",
    sucessoTexto: "A gente entra em contato com você pelo WhatsApp ou pelo e-mail para combinar o teste.",
  },
  erros: {
    nome: "Escreva o seu nome.",
    email: "Esse e-mail não parece certo. Confira.",
    whatsapp: "Escreva o WhatsApp com o DDD, por exemplo 11 91234-5678.",
    ramo: "Conte em poucas palavras o que o seu negócio faz.",
    aceite: "Marque a caixa para a gente poder entrar em contato.",
    limite: "Muitas tentativas em pouco tempo. Espere alguns minutos e tente de novo.",
    generico: "Não deu para enviar agora. Tente de novo em instantes.",
    semConexao: "Sem conexão com a internet. Confira o sinal e tente de novo.",
  },
  rodape: { termos: "Termos de uso", privacidade: "Política de privacidade", entrar: "Entrar" },
  /** O que o admin lê em `/admin/interessados`. */
  admin: {
    titulo: "Interessados",
    subtitulo: (n: number) => (n === 0 ? "ninguém ainda" : n === 1 ? "1 pessoa pediu para testar" : `${n} pessoas pediram para testar`),
    colunaNome: "nome",
    colunaEmail: "e-mail",
    colunaWhatsapp: "WhatsApp",
    colunaRamo: "ramo",
    colunaQuando: "quando",
    abrirWhatsapp: "abrir no WhatsApp",
    vazio: "Ninguém pediu para testar ainda. Quando alguém preencher o formulário da página de entrada, aparece aqui.",
    colunaAcoes: "ações",
    apagar: "apagar",
    apagarConfirmar: "apagar de vez",
    apagarCancelar: "não apagar",
    apagando: "apagando",
    apagarAria: (nome: string) => `apagar ${nome} da lista`,
    apagarErro: "Não deu para apagar agora. Tente de novo.",
    listaTruncada: (mostrados: number) => `Mostrando as ${mostrados} mais recentes.`,
  },
  /** O aviso ao admin a cada inscrição. */
  email: {
    assunto: (nome: string) => `Novo interessado em testar: ${nome}`,
    corpo: (dados: { nome: string; email: string; whatsapp: string; ramo: string }) =>
      envolverEmail(
        `<p>Alguém pediu para testar ${escaparHtml(config.appName)}.</p>` +
          `<p><strong>Nome:</strong> ${escaparHtml(dados.nome)}<br>` +
          `<strong>E-mail:</strong> ${escaparHtml(dados.email)}<br>` +
          `<strong>WhatsApp:</strong> ${escaparHtml(dados.whatsapp)}<br>` +
          `<strong>Ramo:</strong> ${escaparHtml(dados.ramo)}</p>` +
          `<p>A lista completa está no admin, em Interessados.</p>`,
      ),
  },
};
