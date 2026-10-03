export const textosConta = {
  titulo: "Conta",
  /**
   * E39a (desenho do Opus, dúvida 2): Briefing saiu da navegação principal e virou esta linha,
   * no topo de Conta, com a nota de agora e uma seta para abrir.
   */
  briefingLinha: {
    rotulo: "Briefing",
    nota: (nota: number) => `Nota ${nota.toFixed(1).replace(".", ",")}`,
    semNota: "Ainda sem nota",
  },
  nome: "nome",
  email: "e-mail",
  soLeitura: "(só leitura)",
  /** E45, PR 1: o ramo editável na Conta (antes só o Começar tinha o campo, e depois do briefing a pessoa ficava sem como mudá-lo). */
  ramo: {
    rotulo: "ramo",
    ajuda: "Escreva uma palavra ou uma letra do que você faz e escolha na lista.",
    /** E45 PR 3: só leitura; quem liga e desliga é o admin (decisão do Gustavo de 02/10/2026). */
    alternativos: (nomes: string[]) =>
      nomes.length === 1
        ? `A gente ligou também ${nomes[0]} ao seu tema livre, às suas referências e aos seus roteiros.`
        : `A gente ligou também ${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]} ao seu tema livre, às suas referências e aos seus roteiros.`,
    aviso: "Ao trocar, os temas e as referências passam a ser os do ramo novo. Se ele ainda não foi pesquisado, aparecem a partir da próxima madrugada. O briefing e os roteiros continuam.",
    /** E45 PR 2: o "Não achei o meu" da Conta (o campo de texto livre que abre, no estilo minúsculo da tela). */
    campoOutro: "qual é o seu ramo",
    ajudaOutro: "Escreva em poucas palavras.",
  },
  redes: "perfis nas redes",
  /** V3, item 4: o grupo ganha o nome da marca ativa no subtítulo (dúvida 5 do BRIEF.md). */
  redesSub: (nomeMarca: string) => `É por eles que a gente compara os vídeos de ${nomeMarca} com o normal da conta.`,
  /** V12c, item 3b, a E37b: sem travar o salvar, o bloco de perfis é opcional. */
  perfilInvalido: "Confira o nome do perfil",
  lembrete: "a que horas você quer o lembrete de gravar?",
  erroHoraForaDaFaixa: "escolha uma hora entre 6h e 22h",
  tema: "tema",
  temas: [
    { valor: "claro", rotulo: "claro" },
    { valor: "escuro", rotulo: "escuro" },
    { valor: "sistema", rotulo: "do sistema" },
  ],
  salvar: "salvar",
  salvando: "salvando",
  salvo: "salvo",
  sair: "sair",
  saindo: "saindo",
  erroSair: "não conseguimos sair agora; tente de novo em um minuto",
  erro: "não conseguimos salvar agora; tente de novo em um minuto",
  /** V3, item 4: "Quem tem acesso a esta marca" (Conta.dc.html). */
  acessos: {
    titulo: "Quem tem acesso a esta marca",
    explica: "Cada pessoa entra com o próprio e-mail e vê os mesmos temas, roteiros e histórico desta marca.",
    explicaUmaPessoa: "Por enquanto, só você entra nesta marca.",
    contagem: (n: number) => (n === 1 ? "1 pessoa" : `${n} pessoas`),
    voce: "você",
    rodape: "Para dar acesso a mais alguém, fale com a gente.",
  },
  /**
   * H3, item 4: a folha "Informações do aparelho", para o Gustavo mandar ao
   * Fable quando algo aparece torto no telefone dele ou no do Bruno. Sem dado
   * de cliente, sem mandar nada para servidor nenhum.
   */
  diagnostico: {
    linha: "Informações do aparelho",
    tituloFolha: "Informações do aparelho",
    explica: "Só para o Fable entender o que apareceu torto no seu aparelho. Nada daqui sai do seu navegador.",
    larguraJanela: "largura da janela",
    alturaJanela: "altura da janela",
    alturaVisivel: "altura visível",
    escala: "escala",
    areaSeguraTopo: "área segura, em cima",
    areaSeguraBaixo: "área segura, embaixo",
    areaSeguraEsquerda: "área segura, à esquerda",
    areaSeguraDireita: "área segura, à direita",
    modoAplicativo: "modo aplicativo",
    tecladoAberto: "teclado considerado aberto",
    sim: "sim",
    nao: "não",
    versaoPainel: "versão do painel",
    versaoDesconhecida: "não sei dizer",
    naoDisponivel: "não disponível",
    navegador: "navegador",
    copiar: "Copiar",
    copiado: "Copiado",
  },
  /** V7, item 5: só aparece enquanto o aplicativo ainda não está na tela de início. */
  instalar: {
    titulo: "Instalar no celular",
    explica: "Coloque na tela de início e abra o roteiro do dia com um toque, como um aplicativo.",
    iphone: {
      sistema: "iPhone",
      passos: "toque em Compartilhar e depois em Adicionar à Tela de Início.",
    },
    android: {
      sistema: "Android",
      passos: "toque no botão de menu do navegador e escolha Instalar aplicativo.",
    },
  },
};
