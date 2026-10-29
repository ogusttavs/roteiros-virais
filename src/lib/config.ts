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
  /**
   * E17 parte 1 (refeita em 23/10/2026, ajustada pela medição com dados reais): a prova do Tema livre por significado. Desligada por padrão, até a Central ligar.
   * Uma chave só: a busca nova sem o modelo traz mais prova sem relação (78% de lixo no ramo 5, contra 61% da busca antiga), então as duas partes andam juntas.
   * Ligada, em toda busca do Tema livre o modelo barato lê o conjunto elegível do setor (até 200 vídeos, uns US$ 0,009 por tema no maior setor, com cache) e devolve só
   * os que tratam do mesmo assunto; se ele não responde, vale a busca por palavra de sempre.
   */
  busca: {
    porSignificado: env("BUSCA_POR_SIGNIFICADO") === "1",
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
    /**
     * Tempo limite de UMA leitura de vídeo do TikTok por URL pelo `yt-dlp` (curva do cliente), em segundos. O estudo de 27/10/2026
     * mediu de 2,7 a 4 s por vídeo; 60 s já é proxy ou firewall engasgado.
     */
    tiktokYtdlpLimiteS: envNumero("TIKTOK_YTDLP_LIMITE_S", 60),
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
    /**
     * Ler o vídeo do TikTok por URL (a curva do cliente) pelo `yt-dlp` e deixar a Apify só de reserva (27/10/2026, `tiktok-ytdlp.ts`). Ligado por padrão;
     * `TIKTOK_YTDLP=0` volta para a Apify sozinha, sem novo deploy de código.
     */
    tiktokYtdlp: env("TIKTOK_YTDLP") !== "0",
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
   * E19 PR 1 e E19b, o Instagram ligado pela própria pessoa. Há duas vias; a E19b (27/10/2026) fez a do Instagram ser a de verdade:
   *  - `instagram` (E19b): API do Instagram com o Login do Instagram, sem Página do Facebook. `appId` e `appSecret` são os do PRODUTO Instagram do aplicativo da Meta (painel do aplicativo,
   *    Instagram, "Configuração da API com o login do Instagram", "Configurações de login da empresa": "ID do app do Instagram" e "Chave secreta do app do Instagram"; são DIFERENTES dos
   *    do aplicativo do Facebook: `pesquisa/plataformas/docs/meta/ig-login-business-login.md`). `redirectUri` é a URI cadastrada ali, exata.
   *  - `facebook` (E19 PR 1, código antigo): Login do Facebook para Empresas. `META_APP_ID`, `META_APP_SECRET` e `META_LOGIN_CONFIG_ID` (o `config_id`). Fica DESLIGADA por padrão: só liga com
   *    `META_VIA_FACEBOOK=1` junto dos três dados (e só vale quando a via do Instagram não está ativa).
   * `tokenChave` cifra o token de cada conta ligada (AES-256-GCM, 32 bytes em base64 ou em 64 caracteres hexadecimais; `openssl rand -base64 32`) e é a mesma nas duas vias. `ativa` é "alguma via
   * pode começar uma ligação"; sem ela ninguém começa e a curva segue pelos outros dois caminhos, sem erro de boot.
   */
  metaConexao: {
    appId: env("META_APP_ID"),
    appSecret: env("META_APP_SECRET"),
    loginConfigId: env("META_LOGIN_CONFIG_ID"),
    tokenChave: env("META_TOKEN_CHAVE"),
    redirectUri: env("META_REDIRECT_URI", `${env("APP_URL", "http://localhost:3000")}/api/meta/retorno`),
    instagram: {
      appId: env("META_IG_APP_ID"),
      appSecret: env("META_IG_APP_SECRET"),
      redirectUri: env("META_IG_REDIRECT_URI", `${env("APP_URL", "http://localhost:3000")}/api/meta/retorno`),
      ativa: env("META_IG_APP_ID") !== "" && env("META_IG_APP_SECRET") !== "" && env("META_TOKEN_CHAVE") !== "",
    },
    viaFacebookLigada:
      env("META_VIA_FACEBOOK") === "1" && env("META_APP_ID") !== "" && env("META_APP_SECRET") !== "" && env("META_LOGIN_CONFIG_ID") !== "" && env("META_TOKEN_CHAVE") !== "",
    ativa:
      (env("META_IG_APP_ID") !== "" && env("META_IG_APP_SECRET") !== "" && env("META_TOKEN_CHAVE") !== "") ||
      (env("META_VIA_FACEBOOK") === "1" && env("META_APP_ID") !== "" && env("META_APP_SECRET") !== "" && env("META_LOGIN_CONFIG_ID") !== "" && env("META_TOKEN_CHAVE") !== ""),
    /**
     * E19 PR 2: `META_APP_APROVADO=1` quando a Meta aprovar o aplicativo para todo mundo. Enquanto não for, o aplicativo está em modo de desenvolvimento e só quem tem papel nele
     * consegue passar pelo diálogo; a tela de Conta avisa isso com calma (`textos/conta-conectada.ts`, `tela.emTeste`).
     */
    aprovadoPelaMeta: env("META_APP_APROVADO") === "1",
    /**
     * E19 PR 2, só para o e2e: o endereço de um servidor local que faz o papel do diálogo e da Graph API da Meta. Só vale com `MODO_E2E=1` (que
     * `verificarSegredosDeProducao` recusa fora de localhost); em qualquer outro caso fica vazio e as chamadas vão à Meta de verdade.
     */
    simuladorE2E: env("MODO_E2E") === "1" ? env("META_SIMULADOR_E2E") : "",
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
  /**
   * E22 PR 1, a assinatura pelo Stripe (conta dividida com o OdontoTech: nunca tocar em produto, preço ou evento sem `metadata.produto = roteiros`).
   * `ativa` é o portão: falso se a variável não for exatamente "1" (produção sobe desligada; quem liga é o Gustavo, depois de marcar as cortesias). Desligado,
   * nada muda para ninguém, mas o webhook e o checkout continuam funcionando (dá para provar tudo antes de ligar).
   * `provedor`: "mock" nos testes (vitest e Playwright forçam `STRIPE_PROVIDER=mock`) e sempre que o processo é do Vitest, mesmo com a chave de teste no `.env`;
   * "stripe" só com `STRIPE_SECRET_KEY` preenchida. Nenhum teste chama o Stripe de verdade.
   */
  cobranca: {
    ativa: env("COBRANCA_ATIVA") === "1",
    provedor: (env("STRIPE_PROVIDER") === "mock" || process.env.VITEST ? "mock" : env("STRIPE_SECRET_KEY") ? "stripe" : "mock") as "stripe" | "mock",
    stripeSecretKey: env("STRIPE_SECRET_KEY"),
    webhookSecret: env("STRIPE_WEBHOOK_SECRET"),
    /** A chave de busca do preço do plano trimestral no Stripe (criado por `scripts/stripe-preparar.ts`). */
    precoLookupKey: "roteiros_trimestral",
  },
  /**
   * O alarme do disco do servidor (29/10/2026, antes de abrir a edicao de video para clientes): a VPS tem 100 GB e e dividida com outro produto. Com `atencaoPercentual` do disco usado o admin e avisado;
   * com `criticoPercentual` o envio de video para editar e pausado e a limpeza roda na hora. Valores fora do razoavel (atencao fora de 1 a 99, critico menor ou igual a atencao ou acima de 100) voltam
   * para 80 e 90 (`limitesDoDisco`, em `servicos/disco.ts`).
   */
  disco: {
    atencaoPercentual: envNumero("DISCO_ATENCAO_PERCENTUAL", 80),
    criticoPercentual: envNumero("DISCO_CRITICO_PERCENTUAL", 90),
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
    /**
     * A faxina das contas fora do setor (22/10/2026, `jobs/faxina-de-contas.ts`): uma conta é marcada "fora do setor" num ramo quando a MAIORIA (mais da metade) dos vídeos conferidos
     * dela naquele ramo é de outro assunto, e só com pelo menos `faxinaContaMinimoDeVideos` vídeos conferidos (abaixo disso a conta não é decidida: pode ter começado agora). A amostra de cada conta
     * são os `faxinaContaAmostra` vídeos mais vistos dela acima do piso do ramo, dos últimos `faxinaJanelaDias` dias (os que viram referência). `faxinaVideosPorRodada` é o teto de vídeos
     * perguntados à IA por ramo em cada rodada (a conferência fica guardada; o que não coube, fica para a rodada seguinte ou para o "rodar agora").
     */
    faxinaContaMinimoDeVideos: 5,
    faxinaContaAmostra: 8,
    faxinaContaProporcaoFora: 0.5,
    faxinaJanelaDias: 90,
    faxinaVideosPorRodada: 500,
    limiarForaDaCurva: 3,
    /**
     * Quantos vídeos o `transcrever` lê por noite em cada setor (era uma constante, 40). Achado de 23/10/2026: o ramo 5 tinha 3.523 vídeos acima do piso e só 109 lidos, e 40 por noite
     * levariam três meses para esvaziar a fila. O setor com ao menos uma marca ativa (`setoresComMarcaAtiva`) lê `transcricoesPorDiaComMarca` (100); os outros ficam no padrão. Dentro do
     * teto a fila vai pelos vídeos acima do piso de maior "fora da curva" (e pelos que sobem hoje, antes). O que limita de verdade é o tempo (cerca de 52 s por vídeo do YouTube), por isso o
     * setor com marca também ganha mais orçamento de tempo (`orcamentoTranscreverPorSetorComMarcaMin`).
     */
    transcricoesPorDia: envNumero("TRANSCRICOES_POR_DIA", 40),
    transcricoesPorDiaComMarca: envNumero("TRANSCRICOES_POR_DIA_COM_MARCA", 100),
    /**
     * Orçamento de tempo do `transcrever` por setor, em minutos (M5c): passou disto, o setor para (o que sobrou fica para
     * a noite seguinte: a fila é por vídeo ainda sem leitura) e o job passa ao próximo setor. Sem isto, um setor lento
     * (o YouTube pelo proxy, 4 minutos por vídeo) comia a madrugada inteira e os setores seguintes ficavam a zero.
     */
    orcamentoTranscreverPorSetorMin: envNumero("ORCAMENTO_TRANSCREVER_SETOR_MIN", 30),
    /** O mesmo orçamento para o setor com marca ativa, que lê mais vídeos por noite (100 vídeos do YouTube a cerca de 52 s cada pedem uns 90 minutos). Sai do teto do job inteiro, depois de reservar o orçamento comum dos setores que faltam. */
    orcamentoTranscreverPorSetorComMarcaMin: envNumero("ORCAMENTO_TRANSCREVER_SETOR_COM_MARCA_MIN", 90),
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
    /**
     * Hotfix de 22/10/2026 (achado do Gustavo em produção, no Criar): uma voz só aparece se aparece em pelo menos tantos vídeos DIFERENTES do
     * setor. Uma pergunta dita 41 vezes nos comentários de um vídeo só (uma árvore de pêssego no setor de empreendedorismo) não é o que
     * o público do setor pergunta, é o que o público daquele vídeo perguntou.
     */
    vozesMinimoDeVideos: 2,
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
     * E52 (PR 1), o vídeo longo do YouTube: acima do teto de 180 s até este limite o vídeo é "longo" (`servicos/videos-longos.ts`).
     * Fica de fora o que passa disto (transmissão ao vivo, podcast de horas, aula inteira): não é o modelo de um roteiro de uns
     * dez minutos. `VIDEO_LONGO_MAX_S` ajusta; hipótese do Sonnet, 40 minutos.
     */
    videoLongoMaxS: envNumero("VIDEO_LONGO_MAX_S", 2400),
    /** E52 (PR 1): a janela dos longos que a lista e a fila de transcrição olham (o vídeo longo fora da curva é raro no setor, então 30 dias, e não 7). */
    longosJanelaDias: envNumero("LONGOS_JANELA_DIAS", 30),
    /** E52 (PR 1): a janela de onde saem a duração e a estrutura típicas dos longos (mais larga que a da lista: a amostra é pequena). */
    longosMedidaJanelaDias: envNumero("LONGOS_MEDIDA_JANELA_DIAS", 90),
    /** E52 (PR 1): quantos vídeos longos por setor, por semana, ganham leitura (a transcrição de um longo custa dez vezes a de um curto). */
    longosParaLerPorSemana: envNumero("LONGOS_PARA_LER_POR_SEMANA", 5),
    /**
     * E52 (PR 2): o teto de duração transcrita por ramo por semana, em minutos de vídeo (pedido do Fable: um longo de até 40 minutos custa e demora bem mais que um curto,
     * e o áudio passa pelo proxy, que se paga por gigabyte). Cinco longos de 18 minutos cabem; o que não cabe espera a semana seguinte. `LONGOS_MINUTOS_POR_SEMANA` ajusta.
     */
    longosMinutosPorSemana: envNumero("LONGOS_MINUTOS_POR_SEMANA", 90),
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
    /**
     * E54, a pesquisa na hora (estrategia/plano-de-execucao.md): o teto de buscas por pesquisa (`max_uses` da ferramenta),
     * normal e aprofundada; quantas pesquisas uma marca faz por dia (cada uma custa de R$ 0,50 a R$ 0,95 no modelo barato);
     * quantos dados a pessoa vê, e a idade, em meses, a partir da qual um dado vem marcado como antigo.
     */
    pesquisaNaHoraBuscas: envNumero("PESQUISA_NA_HORA_BUSCAS", 5),
    pesquisaNaHoraBuscasAprofundada: envNumero("PESQUISA_NA_HORA_BUSCAS_APROFUNDADA", 10),
    pesquisasNaHoraPorMarcaPorDia: envNumero("PESQUISAS_NA_HORA_MARCA_DIA", 3),
    pesquisaNaHoraDadosMax: 8,
    /**
     * E61 PR 3, a pesquisa do foco (28/10/2026): a camada pequena de coleta por conta com foco confirmado, SO com fontes sem custo extra (a API do YouTube dentro da cota). Os tetos valem por conta e por dia:
     * `focoBuscasPorContaPorDia` buscas por frase (cada uma 100 unidades da cota do YouTube, a cota gratuita de 10 mil por dia), `focoVideosPorContaPorDia` vídeos guardados, `focoCanaisPorConta` canais de referência
     * (1 unidade cada para ler os últimos vídeos). `focoUnidadesPorDia` é o teto de TODAS as contas juntas, para a camada nunca tirar a cota da coleta do setor. `focoProvaSuficiente`: com tantos vídeos do setor já
     * tratando do assunto da conta, a camada não gasta busca (só lê os canais de referência). `PESQUISA_DO_FOCO=0` desliga a camada inteira.
     */
    focoPesquisaLigada: env("PESQUISA_DO_FOCO", "1") !== "0",
    focoBuscasPorContaPorDia: envNumero("FOCO_BUSCAS_CONTA_DIA", 2),
    focoVideosPorContaPorDia: envNumero("FOCO_VIDEOS_CONTA_DIA", 40),
    focoCanaisPorConta: envNumero("FOCO_CANAIS_CONTA", 3),
    focoUnidadesPorDia: envNumero("FOCO_UNIDADES_YOUTUBE_DIA", 1500),
    focoProvaSuficiente: envNumero("FOCO_PROVA_SUFICIENTE", 6),
    pesquisaNaHoraDadoAntigoMeses: 12,
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
/** A chave que cifra o token das contas ligadas tem 32 bytes (base64 ou 64 caracteres hexadecimais)? Mora aqui para o carregamento da configuração conferir sem importar o módulo que cifra. */
export function chaveDoTokenValida(valor: string | undefined): boolean {
  return Boolean(valor) && bytesDaChaveDoToken(valor as string) !== null;
}

/** Os 32 bytes da chave, ou `null` quando o valor não é uma chave válida. */
export function bytesDaChaveDoToken(valor: string): Buffer | null {
  if (/^[0-9a-fA-F]{64}$/.test(valor)) return Buffer.from(valor, "hex");
  if (/^[A-Za-z0-9+/_-]{42,43}={0,2}$/.test(valor)) {
    const bytes = Buffer.from(valor.replaceAll("-", "+").replaceAll("_", "/"), "base64");
    return bytes.length === 32 ? bytes : null;
  }
  return null;
}

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
    COBRANCA_ATIVA?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    META_APP_ID?: string;
    META_APP_SECRET?: string;
    META_LOGIN_CONFIG_ID?: string;
    META_TOKEN_CHAVE?: string;
    META_IG_APP_ID?: string;
    META_IG_APP_SECRET?: string;
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
   * E22 PR 1: o portão ligado sem a chave do Stripe ou sem o segredo do webhook mandaria toda marca sem cortesia para uma tela de pagar que não consegue cobrar (e
   * recusaria todo evento). Melhor não subir do que subir assim.
   */
  if (env.COBRANCA_ATIVA === "1") {
    if (!env.STRIPE_SECRET_KEY) {
      throw new ErroConfiguracao("COBRANCA_ATIVA=1 exige STRIPE_SECRET_KEY; sem ela a tela de assinar nao consegue cobrar.");
    }
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw new ErroConfiguracao("COBRANCA_ATIVA=1 exige STRIPE_WEBHOOK_SECRET; sem ele o webhook recusa todo evento e a assinatura nunca vira ativa.");
    }
  }

  /**
   * E19 PR 1 e E19b: a ligação do Instagram guarda um token de acesso por conta. Cada via exige os seus dados juntos, e a chave que cifra o token (`META_TOKEN_CHAVE`, a mesma nas duas) precisa ter
   * 32 bytes (base64 ou 64 caracteres hexadecimais): subir com a ligação pela metade deixaria a pessoa chegar ao diálogo da Meta e voltar sem poder guardar o token, ou, pior, guardar com uma
   * chave fraca. Via do Instagram: `META_IG_APP_ID` e `META_IG_APP_SECRET` juntos (e com a chave). Via do Facebook (código antigo): `META_APP_ID`, `META_APP_SECRET` e `META_LOGIN_CONFIG_ID` juntos
   * (e com a chave). Melhor não subir do que subir assim.
   */
  const dadosDaViaInstagram = [env.META_IG_APP_ID, env.META_IG_APP_SECRET];
  const dadosDaViaFacebook = [env.META_APP_ID, env.META_APP_SECRET, env.META_LOGIN_CONFIG_ID];
  if (dadosDaViaInstagram.some(Boolean) && !dadosDaViaInstagram.every(Boolean)) {
    throw new ErroConfiguracao("A ligacao do Instagram exige META_IG_APP_ID e META_IG_APP_SECRET juntos; falta um.");
  }
  if (dadosDaViaFacebook.some(Boolean) && !dadosDaViaFacebook.every(Boolean)) {
    throw new ErroConfiguracao("A ligacao pelo Facebook exige META_APP_ID, META_APP_SECRET e META_LOGIN_CONFIG_ID juntos; falta pelo menos um.");
  }
  const algumaVia = dadosDaViaInstagram.some(Boolean) || dadosDaViaFacebook.some(Boolean);
  if (algumaVia && !env.META_TOKEN_CHAVE) {
    throw new ErroConfiguracao("Os dados da ligacao do Instagram vao juntos: com os dados do aplicativo falta META_TOKEN_CHAVE, a chave que cifra o token.");
  }
  if (env.META_TOKEN_CHAVE && !algumaVia) {
    throw new ErroConfiguracao("Os dados da ligacao do Instagram vao juntos: META_TOKEN_CHAVE sozinha nao serve, falta META_IG_APP_ID e META_IG_APP_SECRET.");
  }
  if (algumaVia) {
    if (!chaveDoTokenValida(env.META_TOKEN_CHAVE)) {
      throw new ErroConfiguracao("META_TOKEN_CHAVE precisa ter 32 bytes (base64 de 32 bytes, p. ex. `openssl rand -base64 32`, ou 64 caracteres hexadecimais).");
    }
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
