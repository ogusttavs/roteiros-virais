import "dotenv/config";

import { PHASE_PRODUCTION_BUILD } from "next/constants";

function env(nome: string, padrao = ""): string {
  const v = process.env[nome];
  return v === undefined || v === "" ? padrao : v;
}

function envNumero(nome: string, padrao: number): number {
  const v = process.env[nome];
  if (v === undefined || v === "") return padrao;
  const n = Number(v);
  return Number.isFinite(n) ? n : padrao;
}

export type ProvedorIA = "anthropic" | "mock";

function provedorIA(): ProvedorIA {
  const p = env("AI_PROVIDER");
  if (p === "anthropic" || p === "mock") return p;
  return env("ANTHROPIC_API_KEY") ? "anthropic" : "mock";
}

export const config = {
  /** Nome de trabalho (V5, entregaveis/design-v2/IDENTIDADE.md, 19/09/2026): troca sem tocar em código, só a variável de ambiente. */
  appName: env("APP_NAME", "Klaki"),
  appUrl: env("APP_URL", "http://localhost:3000"),
  jobsApiKey: env("JOBS_API_KEY", ""),
  auth: {
    secret: env("BETTER_AUTH_SECRET", "troque-em-producao"),
    url: env("BETTER_AUTH_URL", "http://localhost:3000"),
  },
  /**
   * Modo da suíte e2e (etapa 13, parte 3, ajuste da revisão): `next start`
   * sempre roda com `NODE_ENV=production`, mas a suíte não pode se
   * comportar como produção de verdade em dois pontos.
   *
   * (1) O better-auth liga sozinho, só em produção, um limite de taxa
   * embutido em `/sign-in*` (3 tentativas a cada 10 s, não configurável por
   * fora, `getDefaultSpecialRules` do pacote); várias telas da suíte entram
   * pela mesma conta de exemplo em sequência, o que basta para estourar
   * esse limite (`src/lib/auth.ts`).
   *
   * (2) `enviarEmail` só simula fora de produção; a suíte rodando contra
   * `next start` mandou e-mail de verdade pelo Resend para
   * `cliente-e2e@exemplo.teste` (domínio inexistente, bounce), porque o
   * `.env` local tinha a chave real (achado da revisão desta etapa).
   *
   * `verificarSegredosDeProducao`, abaixo, recusa `MODO_E2E=1` fora de
   * `localhost`/`127.0.0.1`: essa flag só existe para o `webServer.env` do
   * `playwright.config.ts` e nunca pode valer na VPS de verdade.
   */
  modoE2E: env("MODO_E2E") === "1",
  ia: {
    provedor: provedorIA(),
    modeloForte: env("AI_MODEL_FORTE", "claude-opus-5"),
    modeloBarato: env("AI_MODEL_BARATO", "claude-haiku-4-5"),
  },
  transcricao: {
    groqKey: env("GROQ_API_KEY"),
    groqModel: env("GROQ_MODEL", "whisper-large-v3-turbo"),
    /**
     * Servidor do provedor de PO Token do YouTube (transcricao do YouTube,
     * rodada 2, item 1): `roteiros-pot` e o nome do servico no Compose
     * (`compose.prod.yml`), sem porta publicada, so na rede interna. Vazio
     * fora do Docker (desenvolvimento local sem o servico) faz o yt-dlp
     * usar o padrao do proprio plugin (localhost:4416), que so funciona se
     * o provedor estiver rodando na maquina.
     */
    potBaseUrl: env("YOUTUBE_POT_BASE_URL", "http://roteiros-pot:4416"),
    /** Pausa entre um video do YouTube e o seguinte, em segundos (item 2: espacar as chamadas). */
    youtubePausaS: envNumero("YOUTUBE_PAUSA_S", 20),
    /**
     * Proxy do yt-dlp (preparacao da viagem, item 0, decisao do Gustavo em
     * 19/09/2026: resolver o bloqueio de IP de datacenter do YouTube ja, em
     * vez de esperar). Vazia por padrao (sem proxy, o comportamento de hoje
     * nao muda). Formato esperado: "http://usuario:senha@host:porta", o
     * mesmo que `argumentosYoutube()` passa direto para `--proxy`. O
     * provedor escolhido e o DataImpulse (residencial rotativo, conta do
     * Gustavo); TikTok usa o mesmo proxy, o Instagram nunca usa.
     */
    ytdlpProxy: env("YTDLP_PROXY"),
    /**
     * Tempo limite de UM download do `yt-dlp` (áudio ou legenda), em segundos (M5c, achado de 03/10/2026: sem limite, um
     * vídeo pendurado no proxy segurava o `transcrever` inteiro por mais de 4 horas). Passou disto, o processo é morto, a
     * falha conta e o job segue para o próximo vídeo. Um áudio de 64 kbps de um vídeo curto baixa em segundos; 90 s já é
     * proxy engasgado.
     */
    ytdlpLimiteS: envNumero("YTDLP_LIMITE_S", 90),
    /** Tempo limite de UMA transcrição na Groq (todas as tentativas do SDK juntas), em segundos (M5c). */
    groqLimiteS: envNumero("GROQ_LIMITE_S", 60),
  },
  coleta: {
    youtubeKey: env("YOUTUBE_API_KEY"),
    apifyToken: env("APIFY_TOKEN"),
    atorTiktok: env("APIFY_ACTOR_TIKTOK", "clockworks/tiktok-scraper"),
    atorInstagram: env("APIFY_ACTOR_INSTAGRAM", "apify/instagram-scraper"),
    /** `maxItems` de cada chamada ao ator (PROXIMO.md, etapa 6 parte 2): 50 em desenvolvimento, 200 em producao. */
    apifyMaxItems: envNumero("APIFY_MAX_ITEMS", process.env.NODE_ENV === "production" ? 200 : 50),
    /** Teto diario de resultados do Apify (fonte "apify" em consumo_api), somando TikTok e Instagram. */
    apifyMaxResultadosDia: envNumero("APIFY_MAX_RESULTADOS_DIA", 1000),
    /** Id numerico da conta Instagram que enxerga a Business Discovery e a Hashtag Search (a Velura). */
    metaIgId: env("META_IG_ID"),
    /** Token permanente de usuario do sistema do Portfolio empresarial (acessos/meta-app.md). */
    metaToken: env("META_TOKEN"),
    /**
     * E6 parte 3, segunda rodada: so true com META_ATIVO=1 e os dois dados
     * da conta chamadora preenchidos. Sem isso (ainda faltando o id, o
     * token, ou a flag desligada), os jobs do Instagram pela API nao
     * agendam e o Apify continua como hoje (PROXIMO.md, item 1): nunca um
     * erro de boot, so a rodada anterior seguindo em frente.
     */
    metaAtivo: env("META_ATIVO") === "1" && env("META_IG_ID") !== "" && env("META_TOKEN") !== "",
    /**
     * Passada leve do meio-dia (E6 parte 3, terceira rodada, item 6):
     * desligada por padrao (nem no ensaio). Com `COLETA_MEIO_DIA=1`, o job
     * `coleta-meio-dia` agenda ao meio-dia; sem a variavel, `agendarTudo`
     * nem inscreve (mesmo mecanismo `condicao` de `metaAtivo`).
     */
    coletaMeioDia: env("COLETA_MEIO_DIA") === "1",
    /**
     * P2, item 0b da revisão do PR #74: cada termo custa 200 unidades do YouTube (duas buscas,
     * `pesquisa-de-setor.ts`). Hotfix de 01/10/2026: eram 8, e a conta estava errada: a rodada mensal
     * passa por todos os setores ativos no mesmo dia (3 setores x 8 termos x 200 = 4.800 unidades,
     * mais da metade da cota diaria de 9.000, antes da coleta). Com 4 sao 2.400 para tres setores.
     * Os termos mais curtos entram primeiro (são os mais genéricos, acham mais candidato).
     */
    termosPesquisaSetor: envNumero("TERMOS_PESQUISA_SETOR", 4),
  },
  email: {
    resendKey: env("RESEND_API_KEY"),
    de: env("EMAIL_FROM", "painel@localhost"),
  },
  /**
   * E48 PR 2: as chaves VAPID do aviso por push (gerar com `npx web-push generate-vapid-keys`). Sem elas nenhum push sai e o lembrete continua por
   * e-mail para todo mundo. A chave pública também vai ao navegador (a tela a recebe do servidor, em tempo de execução: `NEXT_PUBLIC_*` pediria
   * a chave no build da imagem). `subject` é um `mailto:` ou uma URL do responsável.
   */
  push: {
    publicKey: env("VAPID_PUBLIC_KEY"),
    privateKey: env("VAPID_PRIVATE_KEY"),
    subject: env("VAPID_SUBJECT"),
  },
  /** Contato mostrado em /termos e /privacidade (etapa 12, decisao 7). */
  emailContato: env("EMAIL_CONTATO", "contato@localhost"),
  /**
   * Para onde o e-mail diario de acompanhamento da viagem vai (V10, item 4).
   * Vazia por padrao: sem ela, o job nao manda nada (nao e erro, so nao ha
   * destinatario configurado ainda).
   */
  emailAcompanhamento: env("EMAIL_ACOMPANHAMENTO"),
  /** Vazio ate o Gustavo criar a conta (etapa 13, decisao 1); sem DSN, o Sentry nao inicia. */
  sentryDsn: env("SENTRY_DSN"),
  /**
   * Sha curto do commit (etapa 13, decisao 1): vira `release` no Sentry.
   * Passado como build-arg pelo workflow "Imagens" para os Dockerfiles do
   * app e do worker; vazio fora desses containers (dev local, testes).
   */
  gitSha: env("GIT_SHA"),
  /** Regras de produto que sao decisao, nao opiniao (CLAUDE.md e briefing-e-rubricas.md) */
  regras: {
    notaMinimaBriefing: 8,
    notaMinimaTema: 9,
    vigilanciaPorNicho: 50,
    limiarForaDaCurva: 3,
    transcricoesPorDia: 40,
    /**
     * Orçamento de tempo do `transcrever` por setor, em minutos (M5c): passou disto, o setor para (o que sobrou fica para
     * a noite seguinte: a fila é por vídeo ainda sem leitura) e o job passa ao próximo setor. Sem isto, um setor lento
     * (o YouTube pelo proxy, 4 minutos por vídeo) comia a madrugada inteira e os setores seguintes ficavam a zero.
     */
    orcamentoTranscreverPorSetorMin: envNumero("ORCAMENTO_TRANSCREVER_SETOR_MIN", 30),
    /**
     * Teto do `transcrever` inteiro, em minutos (M5c): 3h30, abaixo das 4 horas em que a fila dá o job por vencido. O orçamento
     * de cada setor é o menor entre o seu e o que sobra deste teto dividido pelos setores que faltam, então nenhum setor
     * fica de fora por causa dos de antes, e o job sempre termina (e a cadeia dispara) antes de a fila o vencer.
     */
    orcamentoTranscreverTotalMin: envNumero("ORCAMENTO_TRANSCREVER_TOTAL_MIN", 210),
    visuaisPorSemana: 10,
    /**
     * E28, os comentários do público: quantos vídeos do YouTube de cada setor têm os comentários lidos por semana (1 unidade da cota
     * de cada um; o desenho do passo 25 diz "20 vídeos"), quantos dias de idade o vídeo pode ter para entrar, o mínimo de comentários
     * que ele precisa ter para valer a leitura e quantos comentários se leem de cada (a primeira página da API, pela relevância).
     */
    comentariosVideosPorSemana: 20,
    comentariosJanelaDias: 7,
    comentariosMinimoNoVideo: 20,
    comentariosPorVideo: 100,
    /** E28: com quantos comentários iguais uma pergunta, reclamação ou pedido aparece na tela (a hipótese do passo 25, dúvida 7). */
    vozesMinimoDeComentarios: 5,
    /** E28: depois de quantos dias "as vozes do público" de um setor deixam de valer (a rodada é semanal; passou de duas semanas, a rotina não rodou). */
    vozesValidasPorDias: 14,
    /** Teto de vídeos com análise usados como evidência do modelo do nicho (etapa 9, decisão 2 do PROXIMO.md: "30 a 60"). */
    videosParaModeloNicho: 60,
    /** Piso de vídeos usados como evidência do modelo do nicho (etapa 10, ajuste da revisão da etapa 9): abaixo de `limiarForaDaCurva`, completa até aqui em vez de modelar com pouca evidência. */
    minimoEvidenciaModeloNicho: 10,
    janelaLinhaEditorial: 15,
    minimoParaAvisoLinhaEditorial: 5,
    /**
     * V2b, item 6, escopo 5.11: no minimo 70% brasileiro. Achado 2 da revisão do motor
     * (01/10/2026): a seleção de leitura (o que transcrever, o que ler por imagem) parou de
     * aplicar isto (`semProporcaoBrasil`); continua valendo nas telas e na prova do tema e do
     * roteiro (`aplicarProporcaoBrasil`), até o Gustavo decidir.
     */
    proporcaoBrasil: 0.7,
    /**
     * V9d, item 0b (decisão do Gustavo em 25/09/2026, achado usando o painel): um vídeo de 128
     * views contra uma mediana de 71 não ensina nada e não pode virar referência nem evidência,
     * mesmo passando do múltiplo (`limiarForaDaCurva`). O piso vem antes do múltiplo, nessa ordem
     * fixa; `PISO_VIEWS_REFERENCIA` (variável de ambiente) ajusta sem mexer em código.
     */
    pisoViewsReferencia: envNumero("PISO_VIEWS_REFERENCIA", 50_000),
    /**
     * E26 (4b): o teto de segurança de versões de roteiro por marca por dia (as três da primeira geração e cada "Gerar outra"), só contra laço ou abuso: a pessoa não vê contador nenhum, e
     * quem chega nele lê uma frase própria. `ROTEIROS_POR_DIA_MAX` ajusta. Hoje a geração do roteiro único não passa por aqui.
     */
    roteirosPorDiaMax: envNumero("ROTEIROS_POR_DIA_MAX", 20),
    /** E26 4c: depois de quantos dias sem nenhuma versão nova um grupo deixa de guardar as versões que ninguém escolheu (a faxina diária de `versoes_do_roteiro`). */
    diasDasVersoesGuardadas: envNumero("DIAS_DAS_VERSOES_GUARDADAS", 30),
    /**
     * Hotfix de 30/09/2026 (achado do Gustavo): vídeo longo não é referência de vídeo curto. 180
     * segundos é o limite do Shorts e do Reels gravado no aplicativo; acima disso o vídeo fica fora
     * de Referências, dos temas, da evidência do roteiro e da fila de transcrição
     * (`DENTRO_DO_TETO_DE_DURACAO`, `servicos/pesquisa.ts`). `TETO_DURACAO_REFERENCIA_S` ajusta.
     */
    tetoDuracaoReferenciaS: envNumero("TETO_DURACAO_REFERENCIA_S", 180),
    /**
     * M2, item 2: filtro de "tem alcance" do job `pesquisa-de-setor`, mediana de views dos
     * últimos vídeos do candidato. Bem mais baixo que `pisoViewsReferencia` (o piso de um vídeo
     * VIRAR referência): aqui é só "essa conta tem audiência de verdade", não "todo vídeo dela
     * estoura"; uma conta pode valer a pena como semente mesmo sem nenhum vídeo individual acima
     * de 50 mil. `ALCANCE_MINIMO_CONTA_SETOR` ajusta sem mexer em código.
     */
    alcanceMinimoContaSetor: envNumero("ALCANCE_MINIMO_CONTA_SETOR", 5_000),
    /**
     * M3, item 2: teto diário próprio da análise de vídeo sem fala (quadros + legenda), separado
     * de `visuaisPorSemana` (que é semanal e exige transcrição e análise já prontas). Só roda para
     * setor com `nichos.video_sem_fala_vale` true (`reguaDoSetor`); mais caro que a extração por
     * transcrição (baixa o vídeo e chama o modelo forte com imagem), por isso um teto conservador.
     */
    analiseSemFalaPorDia: envNumero("ANALISE_SEM_FALA_POR_DIA", 15),
    /**
     * E45 PR 1: quantos setores NOVOS (que nascem da escolha de um ramo do catálogo) podem nascer por dia, no sistema todo. Cada setor novo
     * começa uma pesquisa paga e passa a ser coletado todo dia (uns US$ 0,60 por dia, medido em 02/10); sem teto, um laço no navegador de
     * uma conta qualquer faria nascer os 44 de uma vez. `MAX_SETORES_NOVOS_POR_DIA=0` desliga o teto.
     */
    setoresNovosPorDia: envNumero("MAX_SETORES_NOVOS_POR_DIA", 10),
    /**
     * E38 PR 2, "o que entendemos da sua marca": a leitura do site e das redes da própria marca
     * se refaz com esta idade (dias desde a última leitura boa; o despachante diário
     * `entender-marca` só enfileira quem passou disto, o que também pega marca nova e tick
     * perdido do cron). `DIAS_ENTRE_LEITURAS_MARCA` ajusta.
     */
    diasEntreLeituraMarca: envNumero("DIAS_ENTRE_LEITURAS_MARCA", 30),
    /** Quantas marcas o despachante enfileira por rodada; o resto rola para o dia seguinte. */
    leiturasDeMarcaPorRodada: envNumero("LEITURAS_MARCA_POR_RODADA", 25),
    /**
     * Teto de custo de IA da tarefa `entenderMarca` por mês, somado de `geracoes_ia` (nunca em
     * memória, o job pode repetir): passou disto, o despachante e as leituras novas param com
     * aviso até o mês virar. Uma leitura custa centavos; o teto só protege de erro de laço.
     */
    tetoCustoLeituraMarcaMesUsd: envNumero("TETO_CUSTO_LEITURA_MARCA_MES_USD", 5),
    /** Leitura disparada por evento (a pessoa salvou o site ou um perfil) não repete o site em menos de N minutos. */
    minutosEntreLeiturasMarcaPorEvento: envNumero("MINUTOS_ENTRE_LEITURAS_MARCA_EVENTO", 10),
    /**
     * Quantas chamadas da tarefa uma marca gasta por dia antes de o job pular (o freio por marca, além do
     * teto global do mês: quem troca o site de dez em dez minutos não esgota o teto de todo mundo). Cada
     * leitura gasta uma chamada, ou duas se o verificador reprovar a primeira.
     */
    chamadasDeIaPorMarcaPorDia: envNumero("CHAMADAS_IA_MARCA_POR_DIA", 6),
    /**
     * O despachante diário lê, sozinho, toda marca ativa com site ou perfil que ainda não foi lida: na primeira
     * rodada depois de subir a versão, as marcas que já existem. `LEITURA_MARCA_DESPACHO=0` segura isso até
     * alguém liberar (a leitura por evento, quando a pessoa salva o site ou um perfil, continua).
     */
    leituraDaMarcaPeloDespachante: env("LEITURA_MARCA_DESPACHO", "1") !== "0",
  },
};

const SEGREDO_PADRAO = "troque-em-producao";

export class ErroConfiguracao extends Error {}

/**
 * Em producao, recusa iniciar se o segredo de sessao ou a chave de jobs
 * ainda forem o valor de exemplo do .env.example (etapa 4, revisao da
 * etapa 3). Roda sozinha ao carregar este modulo; exportada para testar com
 * um ambiente fabricado, sem depender do process.env real.
 *
 * `next build` roda com NODE_ENV=production mesmo local, sem os segredos
 * reais (que so existem no container em producao); NEXT_PHASE distingue
 * esse passo de build do servidor rodando de verdade (etapa 4, achado ao
 * rodar `npm run build` local com o .env.example ainda no .env).
 */
/** `null` sem host valido (URL ausente ou malformada): tratado como reprovado por MODO_E2E. */
function hostDeUrl(valor: string | undefined): string | null {
  if (!valor) return null;
  try {
    return new URL(valor).hostname;
  } catch {
    return null;
  }
}

export function verificarSegredosDeProducao(
  env: {
    NODE_ENV?: string;
    NEXT_PHASE?: string;
    BETTER_AUTH_SECRET?: string;
    JOBS_API_KEY?: string;
    MODO_E2E?: string;
    APP_URL?: string;
    BETTER_AUTH_URL?: string;
  } = process.env,
): void {
  if (env.NODE_ENV !== "production") return;
  if (env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return;

  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET === SEGREDO_PADRAO) {
    throw new ErroConfiguracao(
      "BETTER_AUTH_SECRET ainda e o valor de exemplo do .env.example; gere um segredo de verdade antes de subir em producao.",
    );
  }
  if (!env.JOBS_API_KEY || env.JOBS_API_KEY === SEGREDO_PADRAO) {
    throw new ErroConfiguracao(
      "JOBS_API_KEY ainda e o valor de exemplo do .env.example; gere uma chave de verdade antes de subir em producao.",
    );
  }

  /**
   * MODO_E2E desliga o limite de taxa do better-auth e o envio de e-mail de
   * verdade (config.modoE2E, src/lib/auth.ts, src/lib/email.ts); sem essa
   * trava, a mesma flag num `.env` de producao de verdade abriria as duas
   * brechas na VPS. So vale com APP_URL e BETTER_AUTH_URL em localhost ou
   * 127.0.0.1, o unico jeito de rodar de verdade `next start` para a suite
   * e2e (etapa 13, parte 3, ajuste da revisao: e-mail real saiu pelo Resend
   * numa rodada da suite antes desta trava existir).
   */
  if (env.MODO_E2E === "1") {
    const HOSTS_PERMITIDOS = new Set(["localhost", "127.0.0.1"]);
    for (const [nome, valor] of [
      ["APP_URL", env.APP_URL],
      ["BETTER_AUTH_URL", env.BETTER_AUTH_URL],
    ] as const) {
      const host = hostDeUrl(valor);
      if (!host || !HOSTS_PERMITIDOS.has(host)) {
        throw new ErroConfiguracao(
          `MODO_E2E=1 exige ${nome} em localhost ou 127.0.0.1; recebido "${valor}". Essa flag nunca pode valer fora do e2e.`,
        );
      }
    }
  }
}

verificarSegredosDeProducao();

export function hojeISO(d = new Date()): string {
  // Data local do Brasil (o servidor pode estar em UTC)
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

/**
 * "HH:00" na hora local do Brasil (etapa 12, decisão 5 do `PROXIMO.md`: o
 * job `lembrete` roda de hora em hora e compara com `clientes.hora_lembrete`,
 * que também é "HH:00").
 */
export function horaAtualISO(d = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false,
  });
  return `${fmt.format(d)}:00`;
}

/** "HH:MM" na hora local do Brasil, com o minuto certo (H3, item 1: o aviso de "sem tema" muda às 6h30). */
export function horaMinutoAtualISO(d = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(d);
}
