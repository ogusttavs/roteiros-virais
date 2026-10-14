/**
 * Texto do modo gravação (design v2, `entrega/telas/Gravacao.dc.html`).
 * Primeira letra maiúscula em toda frase (`BRIEF.md`, revisão do lote 6;
 * `PROXIMO.md`, revisão do PR #31, item 3).
 */
export const textosGravacao = {
  sair: "Sair do modo gravação",
  contagem: (atual: number, total: number) => `${atual} de ${total}`,
  depoisVem: "Depois vem",
  telaAcesa: "A tela fica acesa enquanto você grava",
  blocoAnterior: "Bloco anterior",
  proximoBloco: "Próximo bloco",
  marcarGravei: "Marcar que gravei",
  /** Resposta na tela depois de marcar (revisão do PR #31, item 6): o botão vira o estado feito. */
  gravado: "Gravado",
  erroMarcar: "Não deu para marcar agora; tente de novo",
  /** A conexão caiu no meio do toque em "Marcar que gravei" (V7, item 4): marcar de novo é seguro, o roteiro só muda de estado. */
  erroMarcarSemRede: "Sem conexão agora; marque de novo quando a rede voltar",
  /**
   * V11, item 5: no último bloco, o botão do meio substitui "Próximo bloco"; marca gravado e sai
   * para o roteiro. O toast some sozinho (achado do Gustavo testando em produção: o círculo redondo
   * só mudava de cor, "parecia que nada tinha acontecido").
   */
  terminei: "Terminei de gravar",
  gravadoToast: "Gravado. Quando postar, marque em Histórico.",

  /**
   * E52 (PR 5, passo 26): o modo gravação do vídeo longo, um capítulo por vez. "Capítulo" é a palavra do YouTube e da pessoa; a seta da direita passa sem marcar (só "Já gravei este" marca).
   */
  longo: {
    gruposAria: "Os capítulos do vídeo",
    capitulo: (n: number, total: number, de: string, ate: string) => `Capítulo ${n} de ${total} · ${de} a ${ate}`,
    pontosAria: "O que falar e mostrar",
    naImagem: "Na imagem",
    ganchoDoVideo: "O gancho do vídeo",
    segurar: "Para segurar até o próximo",
    chamada: "A chamada final",
    depoisVemCapitulo: (n: number, de: string, ate: string) => `Depois vem o capítulo ${n}, de ${de} a ${ate}`,
    jaGravei: "Já gravei este",
    jaGraveiAria: (nome: string) => `Já gravei o capítulo ${nome}`,
    capituloAnterior: "Capítulo anterior",
    proximoSemMarcar: "Próximo capítulo, sem marcar",
    proximoCapitulo: "Próximo capítulo",
    voltarAoRoteiro: "Voltar ao roteiro",
    gravadoNoAparelho: "Gravado neste aparelho",
    quantosGravados: (n: number, total: number) => `${n} de ${total} gravados`,
    fimTitulo: (total: number) => {
      const palavras = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze"];
      return `${total === 1 ? "O capítulo está gravado" : `Os ${palavras[total] || total} capítulos estão gravados`}`;
    },
    fimAjuda: "Na edição, junte na ordem. Depois cole os capítulos na descrição do vídeo: o YouTube mostra na barra, e quem assiste pula para o que quer. Os tempos são os do roteiro; confira depois de editar.",
    listaAria: "Os capítulos, com o tempo",
    copiarCapitulos: "Copiar os capítulos",
    copiado: "Capítulos copiados",
    erroCopiar: "Não deu para copiar. Selecione a lista e copie à mão.",
  },
};
