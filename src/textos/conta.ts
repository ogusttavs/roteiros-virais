export const textosConta = {
  titulo: "Conta",
  nome: "nome",
  email: "e-mail",
  soLeitura: "(só leitura)",
  redes: "perfis nas redes",
  /** V3, item 4: o grupo ganha o nome da marca ativa no subtítulo (dúvida 5 do BRIEF.md). */
  redesSub: (nomeMarca: string) => `É por eles que a gente compara os vídeos de ${nomeMarca} com o normal da conta.`,
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
