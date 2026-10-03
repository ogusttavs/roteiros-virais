/**
 * O convite de instalar o aplicativo no celular (E48 PR 1): a folha que aparece uma vez, depois que o primeiro roteiro está na tela, e o botão
 * do cartão da Conta. O que a pessoa lê, em língua de gente: "tela de início" e "aplicativo", nunca "PWA" nem "instalar a página".
 */
export const textosInstalar = {
  convite: {
    titulo: "Coloque o aplicativo na tela de início",
    explica: "Assim o roteiro do dia abre com um toque, como um aplicativo, sem procurar o endereço.",
    /** O botão do Android quando o navegador deixa instalar por aqui. */
    adicionar: "Adicionar ao celular",
    agoraNao: "Agora não",
    adicionando: "Abrindo",
    iphone: {
      sistema: "iPhone",
      passos: [
        "Toque no botão de Compartilhar, o quadrado com a seta para cima, na barra do Safari.",
        "Role a lista e toque em Adicionar à Tela de Início.",
      ],
    },
    android: {
      sistema: "Android",
      semBotao: "Toque no menu do navegador, os três pontinhos, e escolha Instalar aplicativo.",
    },
  },
};
