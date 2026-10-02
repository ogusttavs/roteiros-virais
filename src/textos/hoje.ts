/**
 * Texto de tela de `/hoje` (brief-frontend.md, seção 6.3; design v2,
 * `entregaveis/design-v2/entrega/telas/Hoje.dc.html`), incluindo o cartão de
 * roteiro do dia (etapa 11) e o bloco de evidência (design v2, `PROXIMO.md`,
 * D2 parte 1, item 5). Primeira letra maiúscula em toda frase (`BRIEF.md`,
 * revisão do lote 6; `PROXIMO.md`, revisão do PR #31, item 3).
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
  /**
   * Linha de constância de Hoje (design v2; revisão do PR #31, item 2): o
   * número vem de `resumoHistorico().ultimos30Dias`, os últimos 7, a mesma que
   * monta "sua semana". A `Constancia` (sequência) continua valendo em
   * outras telas (Histórico); aqui é só esta linha que muda.
   */
  constanciaSemana: (diasGravados: number) =>
    diasGravados === 0
      ? "Você ainda não gravou nesta semana. Gravar hoje começa o ritmo."
      : `Você gravou ${diasGravados} dos últimos 7 dias. Gravar hoje mantém o ritmo.`,
  constancia: {
    primeiroDia: "Hoje é o seu primeiro dia",
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
   * à parte na tela; esta função só devolve o resto da frase. `rotulo` já
   * vem calculado por `rotuloMultiploConta` (revisão do PR #31, item 4: o
   * rótulo acompanha o número, nunca fixo em "acima"); `quando` por
   * `fraseDiasAtras` (nunca "em 0 dias").
   */
  evidenciaMultiplo: (rotulo: string, views: string, quando: string) =>
    `${rotulo}, ${views} visualizaç${views === "1" ? "ão" : "ões"} ${quando}`,
  evidenciaParecidos: (n: number) => `Mais ${n} vídeo${n === 1 ? "" : "s"} parecido${n === 1 ? "" : "s"} nos últimos 7 dias`,
  maisIndicadoParaHoje: "Mais indicado para hoje",
  queroEsse: "Quero esse",
  /** Enquanto a tela seguinte abre depois do toque (V7, item 4): o botão que foi tocado diz isto, os outros ficam desabilitados. */
  abrindo: "Abrindo",
  escreverMeuAssunto: "Escrever o meu assunto",
  preferAssuntoSeu: "Prefere um assunto seu?",
  preferAssuntoSeuTexto: "Escreva o que você quer gravar e a gente diz se vale a pena hoje, com nota e com o que mudar.",
  carregando: "Lendo os vídeos que funcionaram esta semana",
  carregandoAviso: "Isso leva menos de um minuto. Pode deixar aberto.",
  vazioTitulo: "Os temas de hoje saem até as 6h30",
  vazio:
    "A busca do que está funcionando no seu setor roda de madrugada. Se você chegou antes, ainda dá para escrever o seu assunto.",
  /**
   * H3, item 1: depois das 6h30 (fuso da marca) ainda sem tema é um caso diferente de "chegou cedo
   * demais" (`vazioTitulo`/`vazio` continuam valendo antes desse horário): o tema de hoje já devia ter
   * saído e não saiu. Mostrado dentro da porta Reels, no lugar dos três temas.
   */
  semTemaDepoisTitulo: "Hoje não saiu tema para o seu setor",
  semTemaDepois: "Dá para gravar do mesmo jeito: conte o que está acontecendo ou escreva o seu assunto.",
  /** M1, item 5: mesmo espírito do aviso de Referências, aqui na porta Reels, no lugar dos três temas. */
  aindaLendoTitulo: "Estamos lendo os vídeos do seu setor",
  aindaLendo:
    "As primeiras referências aparecem em algumas horas. Dá para gravar do mesmo jeito: conte o que está acontecendo ou escreva o seu assunto.",
  erroAviso: "A busca de hoje falhou",
  erroTitulo: "Ainda dá para gravar",
  erro:
    "Não conseguimos falar com uma das fontes agora. O que já estava guardado continua valendo, e você pode escrever o seu assunto.",
  tentarDeNovo: "Tentar de novo",
  /** V9b-0: plano sem limite diário; V12: também o padrão, para um roteiro só. Título do bloco, com a contagem só acima de um. */
  seusRoteirosDeHoje: (n: number) => (n > 1 ? `Seus roteiros de hoje (${n})` : "Seus roteiros de hoje"),
  escritoAs: (h: string) => `Escrito às ${h}`,
  abrirRoteiro: "Abrir o roteiro",
  modoGravacao: "Modo gravação",
  verOutros: "Ver os outros temas de hoje",
  esconderOutros: "Esconder os outros temas",
  contagemTemas: (n: number) => `${n} tema${n === 1 ? "" : "s"}`,
  trocarTemaAviso: "Trocar de tema escreve um roteiro novo. O de agora continua guardado no histórico.",
  trocar: "Trocar",
  avisoVideoSubindo: (dia: string, vezes: string) =>
    `Seu vídeo de ${dia} está ${vezes} acima do normal; responda os comentários hoje`,
  suaSemana: "Sua semana",
  seuUltimoVideo: "Seu último vídeo",
  visualizacoesEmHoras: (views: string, horas: number) => `${views} visualizações em ${horas} hora${horas === 1 ? "" : "s"}`,
  acimaDoSeuNormal: (vezes: string) => `${vezes} acima do seu normal`,
  doNormalDaSuaConta: (vezes: string) => `${vezes} do normal da sua conta`,
  verComoFoi: "Ver como foi",
  atualizar: "Atualizar",
  conta: "Conta",
  roteiroGeradoDescricao: (duracaoS: number) =>
    `Quatro blocos, ${duracaoS} segundos, com a edição junto. Escrito com o que funcionou no seu setor esta semana.`,
  hoje: "hoje",

  /** V12, item 1: a legenda dos três estados do dia na semana do topo (design v2, `.legenda-semana`). */
  legendaSemana: { gravou: "gravou", postou: "postou", nada: "nada" },

  /** V12, item 2: a pergunta das duas portas, antes de qualquer tema (design v2, `Hoje.dc.html`, estado `portas`). */
  pergunta: "O que você quer gravar agora?",
  portaReels: "Reels ou vídeo curto",
  portaReelsAjuda: "para Instagram, TikTok e YouTube",
  portaStory: "Story",
  portaStoryAjuda: "um vídeo com o que está acontecendo agora",

  /** V12, item 3a: a rede principal, na porta Reels. */
  ondeVocePostaMais: "Onde você posta mais?",
  /**
   * A revisão do Fable (ajuste a, `PROXIMO.md`): o desenho dizia "O roteiro
   * sai no jeito dessa rede", mas o prompt ainda não tem as regras por
   * plataforma (V12b); a frase promete só o que o código já faz nesta
   * rodada.
   */
  dicaRedePrincipal: "As referências e os exemplos vêm dessa rede. Dá para trocar quando quiser.",

  /** V12, item 4a: o cartão "Planejar os próximos dias" na porta Story (a instrução da folha em si é mais longa). */
  planejarDiasDescricao: "Conte o que você vai fazer, onde e quando; a gente monta o que gravar em cada dia.",

  /** V12, item 3c: o tema livre, como botão na porta Reels (mesmo texto de baixo de `preferAssuntoSeuTexto`). */
  querOutroAssunto: "Quer outro assunto?",

  /** V12, ajuste (d): o botão do cartão de roteiro compacto, quando há dois ou mais roteiros de hoje. */
  abrir: "Abrir",

  /**
   * E39a: Hoje vira a agenda (desenho do Opus, passo 10, `Hoje.dc.html`, estados `agenda`,
   * `agendaVazia`, `agendaOutroDia`, `agendaBriefingIncompleto`). Nada se cria aqui; "Criar
   * roteiro" sempre leva para `/criar`. Os estados da E39b (ainda vale, atrasado, calendário)
   * ficam fora de propósito.
   */
  agenda: {
    estaSemana: "Esta semana",
    marcadoPara: "Marcado para",
    voltarParaHoje: "Voltar para hoje",
    /** E39c, parte 1: as duas setas ao lado de "Esta semana", sem limite de quanto se pode ir. */
    semanaAnterior: "Semana anterior",
    proximaSemana: "Próxima semana",
    /** A legenda do topo da semana: um ponto cheio é Reels, um anel é Story. */
    legendaReels: "Reels",
    legendaStory: "Story",
    /**
     * Passo 12 do Opus, o planejador, com aba própria desde a decisão do Gustavo de 01/10, 22:15
     * (`/planejamento`, não mais dentro de Hoje): o cabeçalho é um só nas três visões
     * (`cabeca-plano`), com o rótulo pequeno do período, o título grande, as duas setas (o
     * significado muda por visão) e o seletor Dia, Semana, Mês. `rotuloPeriodo` é o texto pequeno
     * acima do título; os nomes das visões e os pares de seta vêm de `visao` e `setas` (dúvida 12
     * do README, lista literal).
     */
    planejador: {
      seletorRotulo: "Ver o calendário por",
      visao: { dia: "Dia", semana: "Semana", mes: "Mês" },
      setas: {
        dia: { anterior: "Dia anterior", seguinte: "Próximo dia" },
        semana: { anterior: "Semana anterior", seguinte: "Próxima semana" },
        mes: { anterior: "Mês anterior", seguinte: "Próximo mês" },
      },
      hoje: "Hoje",
      semanaPassada: "Semana passada",
      semanaQueVem: "Semana que vem",
      mesPassado: "Mês passado",
      esteMes: "Este mês",
      mesQueVem: "Mês que vem",
      criarRoteiroParaEsteDia: "Criar roteiro para este dia",
      /** O "mais" de cada dia da Semana, e o dia vazio do desktop (dúvida 12: "Criar roteiro" curto). */
      criarRoteiro: "Criar roteiro",
      criarRoteiroParaDia: (diaPorExtenso: string) => `Criar roteiro para ${diaPorExtenso}`,
      verMais: (n: number) => `Ver mais ${n}`,
      sugerido: "sugerido",
      legendaSugerido: "sugerido: veio da sua agenda e ainda não tem roteiro",
      notaSugeridos: "Os sugeridos vieram da agenda que você contou. Toque num deles para escrever o roteiro.",
      soltarAqui: "Soltar aqui",
      movendoPara: (titulo: string, dia: string) => `Movendo ${titulo} para ${dia}.`,
      semanaVaziaTitulo: "Nada marcado nesta semana",
      semanaVaziaDescricao:
        "Toque num dia para criar um roteiro para ele, ou conte a sua agenda e a gente sugere o que gravar em cada dia.",
      nadaMarcadoNesteDiaTitulo: "Nada marcado neste dia",
      proximoMarcadoCurto: (quando: string, formato: string) => `O mais perto marcado é ${quando}: um ${formato}.`,
      erroAviso: "Não deu para abrir o calendário",
      erroTitulo: "O que você marcou está guardado",
      erro: "A falha foi nossa. Os seus roteiros e os dias marcados continuam aqui; é só tentar de novo.",
      carregandoRotulo: "Carregando a semana",
      /** O selo de estado dos itens da Semana (`.estado`), minúsculo, igual ao desenho. */
      estadoAtrasado: "atrasado",
    },
    /**
     * Pedido do Gustavo em 01/10, 21:33: tirar um item da frente sem abrir o roteiro. O mesmo menu
     * em três lugares (o destaque, as linhas e os itens da Semana, nas abas Hoje e Planejar); as
     * folhas são as que já existem (Mudar o dia, Arquivar com desfazer, Reprovar com motivo).
     */
    menu: {
      abrir: "Mais opções",
      /** Vários itens na mesma tela, cada um com o próprio menu (dúvida de acessibilidade: "mais
       * opções" sozinho não diz de qual item, com vários na tela). */
      abrirRotulo: (titulo: string) => `Mais opções: ${titulo}`,
      naoVouGravarHoje: "Não vou gravar hoje",
      arquivar: "Arquivar",
      naoGosteiQueroOutro: "Não gostei, quero outro",
      arquivadoToast: "Arquivado",
      desfazer: "Desfazer",
      erroArquivar: "Não foi possível arquivar. Tente de novo.",
    },
    /** O título de cada coluna do dia: muda só quando o dia aberto não é hoje (dúvida 2). */
    reels: { hoje: "Reels de hoje", outroDia: "Reels" },
    stories: { hoje: "Stories de hoje", outroDia: "Stories" },
    /** `aria-label` de cada dia da semana (dúvida, ícones da semana): dia mais o que tem marcado, sempre lido por extenso. */
    diaAgendaRotulo: (diaDaSemanaCompleto: string, diaDoMes: number, qtdReels: number, qtdStories: number) => {
      const marcas: string[] = [];
      if (qtdReels === 1) marcas.push("1 Reels");
      if (qtdReels > 1) marcas.push(`${qtdReels} Reels`);
      if (qtdStories === 1) marcas.push("1 Story");
      if (qtdStories > 1) marcas.push(`${qtdStories} Stories`);
      const oQueTem = marcas.length > 0 ? marcas.join(" e ") : "nada marcado";
      return `${diaDaSemanaCompleto}, dia ${diaDoMes}: ${oQueTem}`;
    },
    estadoReels: { gerado: "a gravar", gravado: "gravado", postado: "postado" },
    /** Dúvida 5: num dia que não é hoje, o que ainda não foi gravado diz "marcado", não "a gravar". */
    estadoOutroDia: "marcado",
    nadaMarcadoTitulo: "Nada marcado para hoje",
    nadaMarcado: "Crie um roteiro para hoje ou deixe os próximos dias prontos.",
    /** O mesmo cartão vazio, num dia que não é hoje: "para hoje" seria falso (achado da prova manual da E39a). */
    nadaMarcadoOutroDiaTitulo: "Nada marcado",
    nadaMarcadoOutroDia: "Crie um roteiro para este dia ou veja outro na semana.",
    proximoMarcado: (quando: string, formato: string) => `O próximo marcado é ${quando}: um ${formato}.`,
    /** O lugar reservado de uma coluna (Reels ou Stories) sem nada, com a outra coluna preenchida; nunca "para hoje", vale em qualquer dia. */
    semNadaNaColuna: "Nada marcado",
    criarRoteiro: "Criar roteiro",
    abrirRoteiro: "Abrir o roteiro",
    briefingPodeRenderMais: "O seu briefing pode render mais",
    briefingNotaEMeta: (nota: string, meta: string) =>
      `Nota ${nota}, meta ${meta}. Complete para os roteiros saírem mais com a sua cara.`,
    abrirBriefing: "Abrir o briefing",

    /**
     * E39b, item (b): o atrasado (desenho do Opus, passo 10, `Hoje.dc.html`, estados
     * `agendaComAtraso` e `agendaComAtrasoSozinho`). "Gravar hoje" só existe quando hoje está
     * livre; no outro caso, `porQueNaoGravarHoje` explica o porquê.
     */
    atrasado: {
      titulo: "Atrasado",
      eraPara: (quando: string) => `Era para ${quando}`,
      mudarODia: "Mudar o dia",
      arquivar: "Arquivar",
      gravarHoje: "Gravar hoje",
      porQueNaoGravarHoje: "Hoje já tem roteiro marcado. Escolha outro dia para este.",
      foraOAtrasadoNadaMarcado: "Fora o atrasado, nada marcado para hoje.",
      salvar: "Salvar",
      salvando: "Salvando",
      erroSalvar: "Não foi possível salvar. Tente de novo.",
    },

    /**
     * E39b, item (a): "ainda vale?", só no Reels em destaque feito com antecedência. Um toque
     * ("Conferir"), nunca automático; a resposta fica no próprio cartão.
     */
    aindaVale: {
      feitoHaDias: (dias: number) => `Feito há ${dias} dia${dias === 1 ? "" : "s"}.`,
      pergunta: "Ainda vale?",
      conferir: "Conferir",
      conferindo: "Conferindo",
      continuaValendo: "Este roteiro continua valendo",
      continuaValendoDescricao: (quando: string) => `Nada mais forte apareceu no seu setor desde ${quando}, quando ele foi feito.`,
      saiuAlgoMelhor: "Saiu algo hoje que pode render mais",
      saiuAlgoMelhorDescricao: (quando: string) =>
        `Desde ${quando}, quando este roteiro foi feito, um vídeo do seu setor passou muito do normal:`,
      criarNovoSobreIsso: "Criar um novo sobre isso",
      manterOQueTinha: "Manter o que eu tinha",
    },

    /** E39b, item (e): o calendário do mês, navegável sem limite (design v2, estado `calendario`). */
    calendario: {
      verOMes: "Ver o mês",
      hoje: (diaPorExtenso: string) => `Hoje, ${diaPorExtenso}`,
      mesAnterior: "Mês anterior",
      proximoMes: "Próximo mês",
      legendaAtrasado: "atrasado",
      aviso: "Planeje com a antecedência que quiser: o calendário segue para a frente sem fim.",
      diaMesRotulo: (diaPorExtenso: string, qtdReels: number, qtdStories: number, atrasado: boolean) => {
        const marcas: string[] = [];
        if (qtdReels === 1) marcas.push("1 Reels");
        if (qtdReels > 1) marcas.push(`${qtdReels} Reels`);
        if (qtdStories === 1) marcas.push("1 Story");
        if (qtdStories > 1) marcas.push(`${qtdStories} Stories`);
        const oQueTem = marcas.length > 0 ? marcas.join(" e ") : "nada marcado";
        return atrasado ? `${diaPorExtenso}: ${oQueTem}, atrasado` : `${diaPorExtenso}: ${oQueTem}`;
      },
    },
  },
};
