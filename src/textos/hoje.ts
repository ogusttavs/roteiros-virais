/**
 * Texto de tela de `/hoje` (brief-frontend.md, seção 6.3; design v2,
 * `entregaveis/design-v2/entrega/telas/Hoje.dc.html`), incluindo o cartão de
 * roteiro do dia (etapa 11) e o bloco de evidência (design v2, `PROXIMO.md`,
 * D2 parte 1, item 5).
 *
 * O rótulo por objetivo do `TemaCartao` ("para te conhecerem") fica em
 * `src/ia/enums.ts`, não aqui: a chave do objeto seria um dos três nomes
 * internos do objetivo (escopo-e-arquitetura.md 4.3), que coincidem com o
 * jargão proibido em `regras-de-texto.ts`; o `checar-texto` reprovaria o
 * identificador mesmo sem virar texto de tela (mesmo motivo de
 * `NOME_OBJETIVO` já estar lá).
 */

export const textosHoje = {
  titulo: "O que gravar hoje",
  constancia: {
    seguidos: (n: number) => `${n} dia${n === 1 ? "" : "s"} seguido${n === 1 ? "" : "s"} gravando`,
    parado: (n: number) => `faz ${n} dia${n === 1 ? "" : "s"} que você não grava`,
    primeiroDia: "hoje é o seu primeiro dia",
  },
  /**
   * Conta vídeos e notícias juntos (correção do dia 1 da etapa 14,
   * `PROXIMO.md`, item 1): antes só contava vídeo, e um tema sustentado só
   * por notícia aparecia como "0 vídeos fora da curva esta semana".
   */
  evidencia: (videos: number, noticias: number) => {
    if (noticias === 0) return `${videos} vídeo${videos === 1 ? "" : "s"} fora da curva esta semana`;
    if (videos === 0) return `${noticias} notícia${noticias === 1 ? "" : "s"} do setor esta semana`;
    return `${videos} vídeo${videos === 1 ? "" : "s"} e ${noticias} notícia${noticias === 1 ? "" : "s"} esta semana`;
  },
  /**
   * Bloco de evidência (design v2, três linhas: conta, múltiplo, parecidos).
   * Sem dado, o bloco some (`BRIEF.md`). O múltiplo ("4,1x") vem em negrito
   * à parte na tela; esta função só devolve o resto da frase.
   */
  evidenciaMultiplo: (views: string, dias: number) =>
    `acima do normal dessa conta, ${views} visualizaç${views === "1" ? "ão" : "ões"} em ${dias} dia${dias === 1 ? "" : "s"}`,
  evidenciaParecidos: (n: number) => `Mais ${n} vídeo${n === 1 ? "" : "s"} parecido${n === 1 ? "" : "s"} nos últimos 7 dias`,
  maisIndicadoParaHoje: "Mais indicado para hoje",
  queroEsse: "quero esse",
  escreverMeuAssunto: "escrever o meu assunto",
  preferAssuntoSeu: "Prefere um assunto seu?",
  preferAssuntoSeuTexto: "Escreva o que você quer gravar e a gente diz se vale a pena hoje, com nota e com o que mudar.",
  carregando: "lendo os vídeos que funcionaram esta semana",
  carregandoAviso: "Isso leva menos de um minuto. Pode deixar aberto.",
  vazioTitulo: "Os temas de hoje saem até as 6h30",
  vazio:
    "A busca do que está funcionando no seu setor roda de madrugada. Se você chegou antes, ainda dá para escrever o seu assunto.",
  erroAviso: "A busca de hoje falhou",
  erroTitulo: "Ainda dá para gravar",
  erro:
    "Não conseguimos falar com uma das fontes agora. O que já estava guardado continua valendo, e você pode escrever o seu assunto.",
  tentarDeNovo: "tentar de novo",
  roteiroDeHoje: "Roteiro de hoje",
  roteiroDeHojePronto: "Seu roteiro de hoje está pronto",
  escritoAs: (h: string) => `escrito às ${h}`,
  abrirRoteiro: "abrir o roteiro",
  modoGravacao: "Modo gravação",
  verOutros: "Ver os outros temas de hoje",
  esconderOutros: "esconder os outros temas",
  contagemTemas: (n: number) => `${n} tema${n === 1 ? "" : "s"}`,
  trocarTemaAviso: "Trocar de tema escreve um roteiro novo. O de agora continua guardado no histórico.",
  trocar: "trocar",
  avisoVideoSubindo: (dia: string, vezes: string) =>
    `seu vídeo de ${dia} está ${vezes} acima do normal; responda os comentários hoje`,
  suaSemana: "Sua semana",
  seuUltimoVideo: "Seu último vídeo",
  visualizacoesEmHoras: (views: string, horas: number) => `${views} visualizações em ${horas} hora${horas === 1 ? "" : "s"}`,
  acimaDoSeuNormal: (vezes: string) => `${vezes} acima do seu normal`,
  doNormalDaSuaConta: (vezes: string) => `${vezes} do normal da sua conta`,
  verComoFoi: "Ver como foi",
  atualizar: "Atualizar",
  roteiroGeradoDescricao: (duracaoS: number) =>
    `Quatro blocos, ${duracaoS} segundos, com a edição junto. Escrito com o que funcionou no seu setor esta semana.`,
  hoje: "hoje",
  semVideoAinda: "assim que você postar um vídeo, o acompanhamento aparece aqui",
};
