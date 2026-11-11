import { config } from "@/lib/config";

/**
 * Termos de uso e política de privacidade (etapa 12, decisão 7 do
 * `PROXIMO.md`). Texto base escrito pelo Sonnet, em português simples, sem
 * jargão: marcar "texto base, revisão jurídica pendente" só fora de
 * produção (`avisoRevisaoPendente`, mostrado pelas próprias páginas quando
 * `process.env.NODE_ENV !== "production"`). A regra do escopo 4.9 (so
 * circula padrao, nunca o roteiro nem o video de um cliente especifico)
 * esta por extenso nas duas paginas, escrita sem a palavra generica que o
 * checar-texto reprova como jargao (regras-de-texto.ts, JARGAO).
 */
/**
 * E37b, item 9 (pendência desde a P2b, liberada pelo Gustavo em 01/10/2026):
 * versão nova, com a linha sobre a prévia por reconhecimento de voz. Quem já
 * tinha aceitado uma versão anterior (`aceitouTermosEm` mais antigo que
 * esta data) vê a folha de aceite de novo no próximo acesso, como a regra
 * dos termos já previa (`LayoutCompleto`, `(painel)/layout.tsx`).
 */
/**
 * E38 PR 2, item 1b (aprovado pelo Gustavo em 09/10/2026): versão nova, com a linha do site e das redes (a leitura das páginas públicas do
 * site e dos títulos dos vídeos, o resumo que a pessoa confirma, o que guardamos e o que é apagado). O instante é o desta mudança, e não a
 * meia-noite, para quem aceitou hoje antes do deploy ver o aceite novo também; precisa ser anterior ao deploy, senão quem aceita logo
 * depois de subir seria perguntado de novo a cada visita até a data chegar.
 */
/**
 * 23/10/2026 (decisão do Gustavo na madrugada, HISTORICO.md): a cláusula "circula padrão, nunca o que é de cada um" por extenso (o que nunca aparece para outra marca e
 * o mínimo para uma conclusão circular: 5 marcas, 3 donos, 10 vídeos, nenhuma com mais da metade), junto dos parágrafos de privacidade que entraram sem
 * subir a versão (o Instagram ligado, E19, e quem pede para testar, E57a). Esta é a única subida de versão para tudo isso: cada pessoa aceita de novo uma
 * vez. O instante é a meia-noite de Brasília de 23/10, anterior ao deploy.
 */
/**
 * 27/10/2026 (revisão do Fable, achado 1): três linhas que contradiziam o que o aplicativo faz desde a E56 e a E19b. Os termos diziam que o aplicativo não publica nada em nome da
 * pessoa (agora publica, mas só quando ela toca em publicar); a privacidade não falava da cópia temporária do vídeo (guardada até 6 horas, `lib/video-temporario.ts`); e o caminho para
 * retirar o acesso só existia pelo Facebook (agora também pelo Instagram). Esta é a subida de versão para tudo isso: cada pessoa aceita de novo uma vez. O instante é a meia-noite de
 * Brasília de 27/10, anterior ao deploy.
 */
/** "7 dias", "1 dia". */
function diasDoTeste(dias: number): string {
  return dias === 1 ? "1 dia" : `${dias} dias`;
}

/**
 * 03/11/2026 (autorizado pelo Gustavo, "pode começar a sua parte já"): a edição do vídeo pela IA (E47) entrou nos termos, na privacidade e na exclusão (o vídeo enviado fica até 48 horas e o editado até 7
 * dias, o áudio vai para a transcrição e o texto da fala para a IA, sem música, ninguém de outra marca vê), mais um parágrafo em inglês no topo da privacidade e da exclusão, para o revisor da Meta (pedido
 * de análise do app, `entregaveis/meta/analise-do-app.md`, 4.4). Esta é a única subida de versão para tudo isso: cada pessoa aceita de novo uma vez. O instante é a meia-noite de Brasília de 03/11,
 * anterior ao deploy. A mesma subida cobre a cláusula do teste grátis (E22, seção 5), que entrou junto na integração de 11/11/2026.
 */
export const VERSAO_TERMOS_EM = new Date("2026-11-03T03:00:00Z");

/**
 * O resumo em inglês do topo de `/privacidade` e `/dados`, para o revisor da Meta (que pode não ler português). Cada frase confere com o que o aplicativo faz: o que guardamos do Instagram ligado, publicar
 * só quando a pessoa toca em "Publicar agora" (as 6 horas do `lib/video-temporario.ts`), a edição do vídeo (48 horas e 7 dias de `config/edicao.ts`, só o áudio para a Groq, só o texto para a Anthropic), como
 * desligar, como pedir a exclusão (30 dias) e o aviso automático da Meta (`/api/meta/exclusao`). Mudou um desses, muda aqui.
 */
const RESUMO_EM_INGLES = `Summary in English. ${config.appName} is a web app for small business owners: every day it suggests what to film and writes a ready-to-record script, and the owner films the video on their own phone. If the owner connects their Instagram professional account, we store the account name, an encrypted access token and the numbers of their videos (views, likes and comments) to follow how the videos perform. We publish a video to their Instagram only when they tap "Publish now" for that video; the video is kept on our server for up to 6 hours, only so Instagram can download it, and is then deleted. If the owner uses the video editing feature, the uploaded video is kept for up to 48 hours and the edited video for up to 7 days, then deleted automatically; only the audio (with the brand name, city and a few business names, to spell them right) is sent to a speech-to-text service (Groq), and only the text of the speech, the script and a short brand summary are sent to an AI service (Anthropic) that decides the cuts; the video image never leaves our server. We never show one customer's data to another. To disconnect Instagram, use Account > Disconnect in the app, or remove the app in Instagram: Settings > Apps and websites. To request deletion of all data, write to ${config.emailContato} from the e-mail you use in the app; we delete within 30 days. Meta's automatic data deletion requests are handled at ${config.appUrl}/api/meta/exclusao.`;

export const textosTermos = {
  avisoRevisaoPendente: "texto base, revisão jurídica pendente",
  atualizadoEm: "atualizado em 3 de novembro de 2026",
  voltar: "voltar",

  termos: {
    titulo: "Termos de uso",
    secoes: [
      {
        titulo: "1. O que você contrata",
        paragrafos: [
          `Uma assinatura mensal que entrega, todo dia, temas e roteiros para você gravar vídeos sobre o seu negócio. Você grava. Se quiser, pode mandar o vídeo para a gente cortar as pausas e os erros e pôr a legenda e o título (seção 3), e você aprova antes de usar. O ${config.appName} só publica no seu Instagram se você ligar a sua conta e tocar em publicar, vídeo por vídeo, na tela do roteiro; sem esse toque, nada é publicado em seu nome.`,
          "Os roteiros são sugestões escritas com ajuda de inteligência artificial, a partir do que você respondeu no briefing e da pesquisa do seu nicho. Quem decide o que vai para o vídeo, grava e publica é sempre você.",
        ],
      },
      {
        titulo: "2. As suas respostas e os seus dados",
        paragrafos: [
          "O que você escreve no briefing é usado para escrever os seus roteiros e para acompanhar o seu negócio. Você pode editar as respostas quando quiser, em Briefing e em Conta.",
          "Quando você responde falando, a prévia do texto que aparece na tela pode usar o reconhecimento de voz do seu aparelho ou navegador, que é um serviço do fabricante. O texto definitivo é sempre feito pela nossa transcrição.",
          "Quando você informa o site ou o perfil da sua marca, lemos até cinco páginas públicas do site e os títulos dos vídeos mais recentes, e mandamos esse texto à IA para escrever um resumo que você confirma ou corrige. Só o que você confirma entra nos seus roteiros.",
        ],
      },
      {
        titulo: "3. Editar o seu vídeo com a IA",
        paragrafos: [
          "Em Editar o meu vídeo, você envia um vídeo que gravou e a gente corta as pausas e os erros e coloca a legenda e o título na tela. O vídeo mostra o seu rosto e tem a sua voz. Você nos autoriza a usá-lo só para fazer essa edição para você.",
          "O vídeo que você envia fica guardado por até 48 horas, e o vídeo editado por até 7 dias. Depois disso, o aplicativo apaga sozinho. Baixe o que quiser guardar antes do prazo.",
          "A edição é feita por inteligência artificial e pode errar, principalmente em nome, número e preço. Você assiste a uma prévia antes de aprovar, e o que vai para a internet é sempre decisão sua. O vídeo sai sem música: você escolhe a música na hora de postar, no Instagram ou no TikTok.",
        ],
      },
      {
        titulo: "4. O que aprendemos entre clientes",
        paragrafos: [
          "Cada vídeo que você posta vira um ponto de dado com resultado real, e esse resultado ajuda a melhorar os roteiros de outros clientes, do seu nicho e de outros nichos.",
          "A regra é fixa: circula o padrão, nunca o que é seu. Tudo o que você escreve (o briefing, os temas, os roteiros), tudo o que você grava e os números dos seus vídeos nunca aparecem para outra marca, nem com o seu nome nem sem ele. E você nunca vê nada disso de outra marca.",
          "O que pode circular é só uma conclusão que vale para muita gente e que não deixa saber de quem veio, por exemplo: \"neste setor, abrir o vídeo com uma pergunta rende mais\". E só quando essa conclusão juntar o resultado de pelo menos 5 marcas, de pelo menos 3 donos diferentes, com pelo menos 10 vídeos no total e sem que nenhuma marca sozinha responda por mais da metade deles. Abaixo disso, nada circula.",
        ],
      },
      {
        titulo: "5. Cancelamento",
        paragrafos: [
          ...(config.cobranca.testeDias > 0
            ? [
                config.cobranca.testeExigeCartao
                  ? `Quem assina pela primeira vez tem ${diasDoTeste(config.cobranca.testeDias)} grátis. O cartão é pedido no começo e só é cobrado depois do teste; se você cancelar antes do fim do teste, nada é cobrado. O teste vale uma vez por conta.`
                  : `Quem assina pela primeira vez tem ${diasDoTeste(config.cobranca.testeDias)} grátis, sem cadastrar o cartão. Para continuar depois do teste, você cadastra o cartão antes do fim dele; sem o cartão, a assinatura termina sozinha e nada é cobrado. O teste vale uma vez por conta.`,
              ]
            : []),
          "Você cancela quando quiser, em Conta, na gestão da assinatura, ou escrevendo para o contato abaixo. Cancelar encerra a renovação: o acesso continua até o fim do período já pago, sem multa. O que já foi pago não é devolvido.",
        ],
      },
      {
        titulo: "6. Contato",
        paragrafos: [`Dúvida sobre estes termos, escreva para ${config.emailContato}.`],
      },
    ],
  },

  privacidade: {
    titulo: "Política de privacidade",
    resumoEmIngles: RESUMO_EM_INGLES,
    secoes: [
      {
        titulo: "1. O que guardamos",
        paragrafos: [
          "O briefing (as respostas sobre o seu negócio), os roteiros gerados para você, e os links dos vídeos que você marca como postado. Guardamos também os perfis que você informa em Conta (Instagram, TikTok, YouTube).",
          "Guardamos também o que a nossa leitura entendeu da sua marca e o que você confirmou, corrigiu ou tirou.",
          "Se você ligar o seu Instagram ao aplicativo (em Conta), guardamos o nome da conta, o acesso que a Meta nos dá para ler os números dos seus vídeos e para publicar na sua conta quando você pedir (cifrado, nunca à vista) e esses números: visualizações, curtidas e comentários. Usamos só para acompanhar o desempenho dos seus vídeos e para publicar o que você mandar publicar. Você desliga quando quiser, em Conta, e desligar apaga o acesso na hora. Também pode retirar o acesso pelo próprio Instagram: Configurações, depois Apps e sites.",
          "Quando você toca em publicar pelo aplicativo, o vídeo fica guardado no nosso servidor por até seis horas, só para o Instagram buscá-lo, por um endereço com código que não dá para adivinhar e que vale por poucas horas. Ele é apagado assim que a publicação termina, falha ou é cancelada, e o que sobrar por algum problema nosso é apagado em, no máximo, seis horas. Depois disso, não guardamos cópia do vídeo para publicar.",
          "Se você usar Editar o meu vídeo, guardamos o vídeo que você manda, com o seu rosto e a sua voz, por até 48 horas, e o vídeo editado, por até 7 dias, junto com o texto do que você falou. Os dois são apagados sozinhos, e você pode baixar o editado nesse prazo. Os detalhes estão na seção 4.",
        ],
      },
      {
        titulo: "2. Por quanto tempo",
        paragrafos: [
          "Enquanto a sua conta estiver ativa, e por até 12 meses depois do cancelamento, para o caso de você voltar a assinar. Passado esse prazo, ou a qualquer momento a seu pedido, apagamos o briefing e os roteiros. Os vídeos da edição não seguem esse prazo: o vídeo que você manda sai em até 48 horas e o editado em até 7 dias, com a conta ativa ou não.",
        ],
      },
      {
        titulo: "3. Uso de inteligência artificial",
        paragrafos: [
          "Usamos modelos de IA (da Anthropic) para escrever os seus roteiros, avaliar os seus temas e, se você usar Editar o meu vídeo, decidir a edição do seu vídeo (seção 4), a partir do seu briefing e da pesquisa do nicho. As suas respostas não são usadas para treinar modelo nenhum; são contexto de uma chamada, como uma pergunta feita à IA a cada roteiro.",
          "Quando você informa o site ou o perfil da sua marca, lemos até cinco páginas públicas do site e os títulos dos vídeos mais recentes, e mandamos esse texto à IA para escrever um resumo que você confirma ou corrige. Só o que você confirma entra nos seus roteiros.",
        ],
      },
      {
        titulo: "4. A edição do seu vídeo pela IA",
        paragrafos: [
          "Quando você usa Editar o meu vídeo, guardamos o vídeo que você envia por até 48 horas e o vídeo editado, com a legenda, por até 7 dias. Junto vai o texto do que você falou e o plano da edição: o texto sai junto com o vídeo enviado, e o plano sai junto com o vídeo editado. Passado o prazo, o aplicativo apaga tudo sozinho. Fica só o registro de que a edição existiu (a data e quantas edições você usou no mês), para contar o limite mensal.",
          "O vídeo mostra o seu rosto e tem a sua voz. Só a sua marca o vê: nenhuma outra marca tem acesso. Quem administra o produto só o abre se precisar ajudar com um problema na sua edição. Não usamos o seu vídeo nem a sua fala para treinar modelo nenhum.",
          "Para editar, usamos dois serviços de fora, e cada um recebe só o que precisa. Do vídeo, só o som vai para um serviço de transcrição (a Groq), junto com o nome da sua marca, a sua cidade ou região, o que você vende e os concorrentes que você citou, só para ele acertar a grafia dos nomes; ele devolve o texto do que você falou. Depois, o texto da fala, o seu roteiro e o resumo da sua marca vão para a inteligência artificial (a Anthropic), que decide o que fica no vídeo, escreve o título e confere a legenda. A imagem do vídeo não sai do nosso servidor.",
          "O vídeo sai sem música. Se você quiser que apaguemos o vídeo antes do prazo, escreva para o contato abaixo; o pedido segue os mesmos prazos da página de exclusão de dados.",
        ],
      },
      {
        titulo: "5. O que aprendemos entre clientes",
        paragrafos: [
          "Como explicado nos termos de uso: só circula o padrão que funcionou, nunca o roteiro, o vídeo ou os números de um cliente específico. O resultado dos seus vídeos ajuda a melhorar o sistema para todo mundo, mas ninguém vê o seu roteiro, o seu número ou o seu vídeo além de você. E uma conclusão só circula quando juntar o resultado de pelo menos 5 marcas, de pelo menos 3 donos diferentes, sem que nenhuma marca responda por mais da metade dos vídeos usados.",
        ],
      },
      {
        titulo: "6. Seus direitos",
        paragrafos: [
          "Você pode ver, editar ou pedir a exclusão dos seus dados a qualquer momento, escrevendo para o contato abaixo.",
        ],
      },
      {
        titulo: "7. Quem pede para testar",
        paragrafos: [
          "Na página inicial, quem preenche o Quero testar nos dá o nome, o e-mail, o WhatsApp e o ramo do negócio, e guardamos também o dia e a hora em que a pessoa aceitou o nosso contato. Esses dados servem só para a gente falar com você sobre o teste, por WhatsApp ou por e-mail, e só quem administra o produto os vê.",
          `Ficam guardados por até 12 meses depois do pedido, ou até você pedir para apagar, o que vier primeiro. Para apagar, escreva para ${config.emailContato} dizendo o e-mail que usou no formulário. O endereço de internet do seu aparelho é usado só na hora, para barrar pedidos em excesso, e não fica guardado.`,
        ],
      },
      {
        titulo: "8. Contato",
        paragrafos: [`Dúvida sobre os seus dados, escreva para ${config.emailContato}.`],
      },
    ],
  },

  dados: {
    titulo: "Exclusão de dados",
    resumoEmIngles: RESUMO_EM_INGLES,
    secoes: [
      {
        titulo: "1. Como pedir a exclusão",
        paragrafos: [
          `Escreva para ${config.emailContato}, do mesmo e-mail que você usa para entrar na plataforma, pedindo a exclusão dos seus dados.`,
          "Se você ligou o seu Instagram, também pode retirar o acesso pela própria Meta: no Instagram, abra Configurações, depois Apps e sites, e remova este aplicativo. O acesso deixa de valer na hora; para apagar também os dados que guardamos, escreva para o contato acima. Se você ligou pela forma antiga, com o Facebook, abra no Facebook Configurações e privacidade, depois Configurações, depois Aplicativos e sites, remova este aplicativo e peça a exclusão dos dados: recebemos o pedido sozinhos, apagamos a ligação e você vê a confirmação em uma página que a Meta mostra.",
        ],
      },
      {
        titulo: "2. O que é apagado",
        paragrafos: [
          "O briefing (as respostas sobre o seu negócio), os roteiros gerados para você, os perfis informados em Conta (Instagram, TikTok, YouTube) e os links dos vídeos que você marcou como postado. O que a nossa leitura entendeu da sua marca e o que você confirmou, corrigiu ou tirou também é apagado.",
          "Se você ligou o seu Instagram: o acesso guardado, o nome da conta ligada, os números dos seus vídeos que lemos por essa ligação e qualquer vídeo que ainda esteja guardado para publicar.",
          "Se você usou Editar o meu vídeo: o vídeo que você enviou, o vídeo editado, a legenda, o texto do que você falou (a sua fala) e o plano da edição que ainda estiverem guardados. Sem pedido nenhum, eles já saem sozinhos, o vídeo enviado em até 48 horas e o editado em até 7 dias.",
        ],
      },
      {
        titulo: "3. Em quanto tempo",
        paragrafos: [
          "Em até 30 dias corridos depois do pedido. Você recebe uma confirmação por e-mail quando a exclusão terminar.",
        ],
      },
      {
        titulo: "4. Contato",
        paragrafos: [`Dúvida sobre a exclusão dos seus dados, escreva para ${config.emailContato}.`],
      },
    ],
  },

  aceite: {
    titulo: "Antes de entrar",
    itens: [
      "Os roteiros são sugestões; quem grava e publica é você.",
      "As suas respostas servem só para escrever os seus roteiros.",
      "Você cancela quando quiser, sem multa.",
    ],
    lerTermos: "ler os termos",
    aceitar: "li e aceito",
    erro: "não conseguimos salvar agora; tente de novo em um minuto",
    /** A rede caiu no meio do aceite (V7, item 4 do PROXIMO.md): o aceite não foi guardado, é só tentar de novo. */
    erroSemRede: "Sem conexão agora. Você ainda não aceitou os termos; tente de novo quando a rede voltar.",
  },
};
