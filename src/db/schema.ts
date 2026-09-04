/**
 * Schema do banco. Postgres 16, local (compose.dev.yml) e em producao, o mesmo
 * banco nos dois lugares. Nomes em portugues para bater com os documentos do
 * projeto; as quatro tabelas do better-auth (user, session, account,
 * verification) ficam em ingles, que e o nome usual delas (CLAUDE.md,
 * convencao de nomes).
 *
 * Regra de ouro (escopo 5.8): o banco e a fonte da verdade. O roteiro sai sempre
 * do que esta guardado aqui, nunca de busca ao vivo.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const id = () => integer("id").primaryKey().generatedAlwaysAsIdentity();
const criadoEm = () => timestamp("criado_em", { withTimezone: true }).notNull().defaultNow();

/** Coluna tsvector (Drizzle nao tem um tipo pronto para ela). */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

// ---------------------------------------------------------------------------
// Autenticacao (better-auth, adaptador Drizzle). Schema gerado a partir de
// betterAuth({ emailAndPassword: { enabled: true },
// plugins: [magicLink(...), admin()] }) via better-auth/db getSchema, na
// versao instalada (1.7.2). src/db/schema.auth.test.ts trava esse schema
// contra a versao instalada, porque o @better-auth/cli (o jeito documentado
// de gerar isso) esta desencontrado da versao do pacote principal (TODO.md,
// decisoes pendentes).
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  /** "admin" ou "cliente" (plugin admin do better-auth). */
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("banReason"),
  banExpires: timestamp("banExpires", { withTimezone: true }),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Preenchido quando um admin esta vendo o painel como este cliente. */
  impersonatedBy: text("impersonatedBy"),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  issuer: text("issuer").notNull(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", { withTimezone: true }),
  scope: text("scope"),
  /** So a conta do provedor "credential" tem senha. */
  password: text("password"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Pessoas e contas de acesso
// ---------------------------------------------------------------------------

export const nichos = pgTable("nichos", {
  id: id(),
  slug: text("slug").notNull().unique(),
  nome: text("nome").notNull(),
  descricao: text("descricao"),
  /** Termos de busca do nicho (chave de cache da pesquisa). */
  termos: jsonb("termos").$type<string[]>().notNull().default([]),
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: criadoEm(),
});

/** Quem grava os videos do cliente (briefing-e-rubricas.md, secao 1). */
export type QuemGrava = "propria_pessoa" | "pessoa_e_equipe";

/** Perfis do cliente nas redes, coletados no briefing (secao 1). */
export type PerfisCliente = {
  instagram: string | null;
  tiktok: string | null;
  youtube: string | null;
};

/** "negocio" vende o proprio produto ou servico; "criador" quer atrair marca. */
export type Persona = "negocio" | "criador";

/** Preferencia de tema salva pelo cliente em /conta (etapa D, parte 2). */
export type TemaPreferido = "claro" | "escuro" | "sistema";

export const clientes = pgTable("clientes", {
  id: id(),
  /** Usuario do better-auth que administra esta conta de cliente. */
  usuarioId: text("usuario_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  nome: text("nome").notNull(),
  nichoId: integer("nicho_id").references(() => nichos.id),
  cidade: text("cidade"),
  bairro: text("bairro"),
  /** Texto do ramo quando o cliente escolheu "outro" na lista (briefing-e-rubricas.md, secao 1). */
  ramoOutro: text("ramo_outro"),
  persona: text("persona").$type<Persona>().notNull().default("negocio"),
  perfis: jsonb("perfis").$type<PerfisCliente>(),
  quemGrava: text("quem_grava").$type<QuemGrava>(),
  tema: text("tema").$type<TemaPreferido>().notNull().default("sistema"),
  /**
   * Camada exclusiva de pesquisa (escopo 5.6): concorrentes, termos e perfis
   * admirados citados pelo cliente (nao confundir com clientes.perfis, que
   * sao os @ do proprio cliente).
   */
  camadaExclusiva: jsonb("camada_exclusiva")
    .$type<{ concorrentes: string[]; termos: string[]; perfisAdmirados: string[] }>()
    .notNull()
    .default({ concorrentes: [], termos: [], perfisAdmirados: [] }),
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: criadoEm(),
});

// ---------------------------------------------------------------------------
// Briefing vivo (escopo 4.1)
// ---------------------------------------------------------------------------

export type AvaliacaoResposta = {
  nota: number;
  bom: string;
  melhorar: string;
  como: string;
  impacto: string;
  /**
   * A resposta melhorada, no formato que o cliente deveria ter escrito, em
   * primeira pessoa (briefing-e-rubricas.md, secao 3; avaliarResposta 1.2.0).
   * Opcional: avaliacoes gravadas antes desta versao nao tem o campo.
   */
  exemplo?: string;
};

/** Perfil compilado (briefing-e-rubricas.md, secao 4; tarefa compilarPerfil). */
export type PerfilCompilado = {
  fatos: {
    oQueVende: string;
    preco: string;
    clienteIdeal: string;
    medos: string[];
    frasesDaFala: string[];
    proibicoes: string[];
    cenasFilmaveis: string[];
    concorrentes: string[];
    perfisAdmirados: string[];
  };
  resumo: string;
};

export const briefings = pgTable("briefings", {
  id: id(),
  clienteId: integer("cliente_id")
    .notNull()
    .references(() => clientes.id)
    .unique(),
  /** perguntaId -> resposta do cliente */
  respostas: jsonb("respostas").$type<Record<string, string>>().notNull().default({}),
  /** perguntaId -> avaliacao em quatro partes */
  avaliacoes: jsonb("avaliacoes").$type<Record<string, AvaliacaoResposta>>().notNull().default({}),
  notaGeral: numeric("nota_geral", { precision: 4, scale: 2 }),
  /** true quando a nota geral chegou a 8 (gate da plataforma) */
  completo: boolean("completo").notNull().default(false),
  /** Gerado na liberacao e recompilado a cada edicao posterior (tarefa compilarPerfil). */
  perfil: jsonb("perfil").$type<PerfilCompilado>(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Motor de pesquisa (escopo 5)
// ---------------------------------------------------------------------------

export type Plataforma = "youtube" | "tiktok" | "instagram";

export const contas = pgTable(
  "contas",
  {
    id: id(),
    plataforma: text("plataforma").$type<Plataforma>().notNull(),
    handle: text("handle").notNull(),
    nome: text("nome"),
    url: text("url"),
    seguidores: integer("seguidores"),
    nichoId: integer("nicho_id").references(() => nichos.id),
    /** Entra na lista de vigilancia do nicho (escopo 5.3) */
    vigiada: boolean("vigiada").notNull().default(false),
    /** Mediana de views dos videos coletados da conta (base do fora-da-curva) */
    medianaViews: numeric("mediana_views", { precision: 14, scale: 2 }),
    /**
     * Menos de 5 videos nos ultimos 90 dias (etapa 7): a mediana normal fica
     * pouco confiavel, entao `medianaViews` vira o substituto por seguidor
     * (ver `src/jobs/pontuar.ts`) e esta coluna avisa quem le o dado.
     */
    baseFraca: boolean("base_fraca").notNull().default(false),
    /** Mediana da velocidade (views/hora) dos videos de 2 a 30 dias da conta (etapa 7) */
    medianaVelocidade: numeric("mediana_velocidade", { precision: 14, scale: 3 }),
    /** Fracao dos videos da conta que ficaram fora da curva (ranking da vigilancia) */
    taxaForaDaCurva: numeric("taxa_fora_da_curva", { precision: 6, scale: 4 }),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("contas_plataforma_handle").on(t.plataforma, t.handle)],
);

export type AnaliseVideo = {
  assunto: string;
  gancho: string;
  estrutura: string;
  fechamento: string;
  /** Chamada final do video (nome interno; nunca "CTA" em texto de tela). */
  chamadaFinal: string;
  formato: "fala_para_camera" | "podcast" | "caixinha" | "esquete" | "outro";
  porQueFuncionou: string;
  /**
   * A vigilancia (etapa 7) escolhe conta, nao assunto: nem todo video da
   * conta vigiada fala do nicho (etapa 10, ajuste da revisao da etapa 9).
   * Ausente em analise gravada antes desse campo existir; nesse caso conta
   * como relevante (ver `PERTENCE_AO_NICHO` em `src/servicos/pesquisa.ts`).
   */
  pertenceAoNicho?: boolean;
  motivoNicho?: string;
};

export type AnaliseVisual = {
  falaParaCamera: boolean;
  textoNaTela: { quando: string; onde: string; oQue: string }[];
  cenario: string;
  ritmoDeCorte: string;
  recursos: string[];
  momentoChave: { segundo: number; oQue: string } | null;
};

/**
 * Audio do video (etapa 6): TikTok e Instagram entregam isso junto com os
 * metadados da coleta; o YouTube nao expoe pela API, fica nulo. Fonte do
 * "audio da semana" (etapa 9).
 */
export type VideoAudio = {
  id?: string;
  nome?: string;
  autor?: string;
  original?: boolean;
};

export const videos = pgTable(
  "videos",
  {
    id: id(),
    plataforma: text("plataforma").$type<Plataforma>().notNull(),
    idExterno: text("id_externo").notNull(),
    url: text("url").notNull(),
    contaId: integer("conta_id").references(() => contas.id),
    nichoId: integer("nicho_id").references(() => nichos.id),
    titulo: text("titulo"),
    descricao: text("descricao"),
    publicadoEm: timestamp("publicado_em", { withTimezone: true }),
    duracaoS: integer("duracao_s"),
    views: integer("views").notNull().default(0),
    likes: integer("likes").notNull().default(0),
    comentarios: integer("comentarios").notNull().default(0),
    /** views / mediana da conta (escopo 5.1) */
    foraDaCurva: numeric("fora_da_curva", { precision: 10, scale: 3 }),
    /** views por hora desde a postagem */
    velocidade: numeric("velocidade", { precision: 14, scale: 3 }),
    /** velocidade / mediana de velocidade da conta */
    velocidadeRelativa: numeric("velocidade_relativa", { precision: 10, scale: 3 }),
    transcricao: text("transcricao"),
    analise: jsonb("analise").$type<AnaliseVideo>(),
    analiseVisual: jsonb("analise_visual").$type<AnaliseVisual>(),
    audio: jsonb("audio").$type<VideoAudio>(),
    /** Palavras-chave da extracao (etapa 8), usadas em filtro e evidencia. */
    etiquetas: jsonb("etiquetas").$type<string[]>().notNull().default([]),
    /**
     * Transcricao falhou de vez (sem audio, erro definitivo): preenchida com
     * "agora + 7 dias" (etapa 8, decisao 3 do PROXIMO.md). `transcrever`
     * nunca seleciona video com essa data no futuro.
     */
    proximaTentativaTranscricao: timestamp("proxima_tentativa_transcricao", { withTimezone: true }),
    /** titulo + descricao + transcricao + analise.assunto, para busca de evidencia. */
    busca: tsvector("busca").generatedAlwaysAs(
      sql`to_tsvector('portuguese', coalesce(titulo, '') || ' ' || coalesce(descricao, '') || ' ' || coalesce(transcricao, '') || ' ' || coalesce(analise ->> 'assunto', ''))`,
    ),
    /** "coleta" veio do motor, "seed" e exemplo de desenvolvimento, "curadoria" foi posto pela equipe */
    origem: text("origem").$type<"coleta" | "seed" | "curadoria">().notNull().default("coleta"),
    coletadoEm: timestamp("coletado_em", { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("videos_plataforma_id_externo").on(t.plataforma, t.idExterno),
    index("videos_nicho_publicado").on(t.nichoId, t.publicadoEm),
    index("videos_nicho_fora_da_curva").on(t.nichoId, t.foraDaCurva),
    index("videos_busca_idx").using("gin", t.busca),
    /** Janela de 90 dias por conta, usada pelo job `pontuar` (etapa 7). */
    index("videos_conta_publicado").on(t.contaId, t.publicadoEm),
    /** Consulta "subindo hoje" (etapa 7, src/servicos/pesquisa.ts). */
    index("videos_nicho_velocidade_relativa").on(t.nichoId, t.velocidadeRelativa),
  ],
);

export const noticias = pgTable("noticias", {
  id: id(),
  nichoId: integer("nicho_id").references(() => nichos.id),
  titulo: text("titulo").notNull(),
  url: text("url").notNull().unique(),
  fonte: text("fonte"),
  publicadoEm: timestamp("publicado_em", { withTimezone: true }),
  resumo: text("resumo"),
  relevante: boolean("relevante"),
  /** Angulo sugerido para virar roteiro ("saiu hoje que X, explique o que muda para o seu cliente") */
  angulo: text("angulo"),
  coletadoEm: timestamp("coletado_em", { withTimezone: true }).notNull().defaultNow(),
});

export type ModeloNicho = {
  resumo: string;
  ganchos: { tipo: string; exemplo: string; frequencia: string }[];
  duracaoTipicaS: { min: number; max: number };
  estruturas: string[];
  fechamentos: string[];
  chamadasFinais: string[];
  formatos: { formato: string; participacao: string }[];
  edicao: {
    textoNaTela: string;
    ritmoDeCorte: string;
    recursos: string[];
    audio: string | null;
  };
  assuntosQuentes: string[];
  baseadoEm: number;
  /**
   * Quantos dos `baseadoEm` vídeos estão de fato fora da curva (etapa 10,
   * ajuste da revisão da etapa 9): `baseadoEm` pode incluir um complemento
   * abaixo do limiar para não modelar com pouca evidência (mínimo 10),
   * `acimaDoLimiar` diz quantos vieram da evidência forte de verdade.
   */
  acimaDoLimiar: number;
};

/**
 * Audio da semana (etapa 9, decisao 3 do PROXIMO.md): calculado por
 * matematica pura em `videos.audio` (so TikTok e Instagram), antes de
 * chamar a IA, nao gerado pelo modelo.
 */
export type AudioDaSemana = {
  nome: string | null;
  autor: string | null;
  contagem: number;
  videoExemploId: number;
};

export const modelosNicho = pgTable("modelos_nicho", {
  id: id(),
  nichoId: integer("nicho_id")
    .notNull()
    .references(() => nichos.id),
  semana: date("semana").notNull(),
  modelo: jsonb("modelo").$type<ModeloNicho>().notNull(),
  audiosDaSemana: jsonb("audios_da_semana").$type<AudioDaSemana[]>().notNull().default([]),
  criadoEm: criadoEm(),
});

export type TemaDoDia = {
  titulo: string;
  descricao: string;
  porQue: string;
  /** ids de videos que sustentam o tema (evidencia) */
  evidencias: number[];
  /** objetivo que o tema puxa mais: alcance, engajamento ou conversao (taxonomia interna, escopo 4.3) */
  puxaPara: "alcance" | "engajamento" | "conversao";
};

export const temasDia = pgTable(
  "temas_dia",
  {
    id: id(),
    nichoId: integer("nicho_id")
      .notNull()
      .references(() => nichos.id),
    data: date("data").notNull(),
    temas: jsonb("temas").$type<TemaDoDia[]>().notNull(),
    criadoEm: criadoEm(),
  },
  (t) => [uniqueIndex("temas_dia_nicho_data").on(t.nichoId, t.data)],
);

// ---------------------------------------------------------------------------
// O que o cliente faz no painel (escopo 4.2 a 4.9)
// ---------------------------------------------------------------------------

export type Pilar = "viralizar" | "gerarCliente" | "encaixe" | "novidade" | "facilidade";
export type NotaPilar = { nota: number; justificativa: string };

export const avaliacoesTema = pgTable("avaliacoes_tema", {
  id: id(),
  clienteId: integer("cliente_id")
    .notNull()
    .references(() => clientes.id),
  tema: text("tema").notNull(),
  pilares: jsonb("pilares").$type<Record<Pilar, NotaPilar>>().notNull(),
  nota: numeric("nota", { precision: 4, scale: 2 }).notNull(),
  recomendacao: text("recomendacao").notNull(),
  anguloSugerido: text("angulo_sugerido"),
  evidencias: jsonb("evidencias").$type<number[]>().notNull().default([]),
  criadoEm: criadoEm(),
});

export type Objetivo = "alcance" | "engajamento" | "conversao";

export type ConteudoRoteiro = {
  titulo: string;
  duracaoS: number;
  gancho: string;
  corpo: string;
  fechamento: string;
  chamadaFinal: string;
  cenas: { momento: string; oQueFazer: string }[];
  /** Por que este roteiro so funciona com a pessoa de verdade (tese do produto) */
  ondeGravar: string;
  edicao: {
    textoNaTela: { quando: string; oQue: string; onde: string }[];
    ritmoDeCorte: string;
    recursos: string[];
    audio: string | null;
    referencia: { videoId: number | null; segundo: number | null; oQueOlhar: string } | null;
  };
  /** Ids de video que sustentam o roteiro (etapa 11): a mesma lista que o verificador conferiu. */
  evidencias: number[];
};

export const roteiros = pgTable(
  "roteiros",
  {
    id: id(),
    clienteId: integer("cliente_id")
      .notNull()
      .references(() => clientes.id),
    data: date("data").notNull(),
    tema: text("tema").notNull(),
    origem: text("origem").$type<"sugerido" | "livre">().notNull(),
    objetivo: text("objetivo").$type<Objetivo>().notNull(),
    conteudo: jsonb("conteudo").$type<ConteudoRoteiro>().notNull(),
    referenciaVideoId: integer("referencia_video_id").references(() => videos.id),
    versao: integer("versao").notNull().default(1),
    /**
     * A versao 1 da mesma serie (etapa 11, decisao 4 do PROXIMO.md,
     * "outro angulo" mantem as anteriores acessiveis): nulo na propria
     * versao 1; nas seguintes, aponta para o id da versao 1. Listar a serie
     * inteira e "id = raiz ou versaoDe = raiz", com raiz = versaoDe ?? id.
     */
    versaoDe: integer("versao_de").references((): AnyPgColumn => roteiros.id),
    /**
     * A linha de geracoes_ia da tentativa aprovada que gerou esta versao
     * (etapa 11, decisao 4): onde a avaliacao do cliente (gostei, nao
     * gostei, ou o motivo de pedir outro angulo) e gravada.
     */
    geracaoId: integer("geracao_id").references(() => geracoesIA.id),
    status: text("status").$type<"gerado" | "gravado" | "postado">().notNull().default("gerado"),
    gravadoEm: timestamp("gravado_em", { withTimezone: true }),
    urlPostado: text("url_postado"),
    postadoEm: timestamp("postado_em", { withTimezone: true }),
    criadoEm: criadoEm(),
  },
  (t) => [index("roteiros_cliente_data").on(t.clienteId, t.data)],
);

export const favoritos = pgTable(
  "favoritos",
  {
    id: id(),
    clienteId: integer("cliente_id")
      .notNull()
      .references(() => clientes.id),
    videoId: integer("video_id")
      .notNull()
      .references(() => videos.id),
    criadoEm: criadoEm(),
  },
  (t) => [uniqueIndex("favoritos_cliente_video").on(t.clienteId, t.videoId)],
);

/** Videos postados pelo cliente (acompanhamento da curva, escopo 4.8, fase 3) */
export const videosCliente = pgTable("videos_cliente", {
  id: id(),
  clienteId: integer("cliente_id")
    .notNull()
    .references(() => clientes.id),
  roteiroId: integer("roteiro_id").references(() => roteiros.id),
  plataforma: text("plataforma").$type<Plataforma>(),
  url: text("url").notNull(),
  idExterno: text("id_externo"),
  postadoEm: timestamp("postado_em", { withTimezone: true }).notNull().defaultNow(),
  ultimaColeta: timestamp("ultima_coleta", { withTimezone: true }),
});

export const metricasVideoCliente = pgTable("metricas_video_cliente", {
  id: id(),
  videoClienteId: integer("video_cliente_id")
    .notNull()
    .references(() => videosCliente.id),
  coletadoEm: timestamp("coletado_em", { withTimezone: true }).notNull().defaultNow(),
  views: integer("views").notNull().default(0),
  likes: integer("likes").notNull().default(0),
  comentarios: integer("comentarios").notNull().default(0),
});

// ---------------------------------------------------------------------------
// Operacao
// ---------------------------------------------------------------------------

export const execucoesJob = pgTable("execucoes_job", {
  id: id(),
  nome: text("nome").notNull(),
  iniciadoEm: timestamp("iniciado_em", { withTimezone: true }).notNull().defaultNow(),
  terminadoEm: timestamp("terminado_em", { withTimezone: true }),
  status: text("status").$type<"rodando" | "ok" | "erro">().notNull().default("rodando"),
  resumo: jsonb("resumo").$type<Record<string, unknown>>(),
  erro: text("erro"),
});

/**
 * Um lote pendente na API de lote da Anthropic (etapa 8): a API e assincrona
 * (ate 24h), entao o job `extrair` so cria o lote e grava a linha aqui;
 * `extrairColeta`, rodado a parte, e quem confere o status e busca o
 * resultado quando pronto. `videoIds` guarda a ordem usada como `customId`
 * de cada item (`String(videoId)`), para o resultado voltar ligado ao video
 * certo sem precisar de outra consulta.
 */
export const lotesIa = pgTable("lotes_ia", {
  id: id(),
  /** Nome da tarefa de src/ia/tipos.ts (TarefaIA); texto solto aqui para o schema do
   * banco nao depender da camada de IA, so o codigo que le/escreve tipa certo. */
  tarefa: text("tarefa").notNull(),
  loteIdExterno: text("lote_id_externo").notNull().unique(),
  videoIds: jsonb("video_ids").$type<number[]>().notNull().default([]),
  status: text("status").$type<"em_andamento" | "concluido" | "erro">().notNull().default("em_andamento"),
  criadoEm: criadoEm(),
  concluidoEm: timestamp("concluido_em", { withTimezone: true }),
});

/**
 * Cota diaria por fonte (etapa 6): o YouTube Data API cobra por unidade
 * (search.list custa 100, videos.list e playlistItems.list custam 1) e da
 * 10 mil unidades por dia; paramos em 9 mil de propósito, com folga.
 */
export const consumoApi = pgTable(
  "consumo_api",
  {
    id: id(),
    fonte: text("fonte").notNull(),
    data: date("data").notNull(),
    unidades: integer("unidades").notNull().default(0),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("consumo_api_fonte_data").on(t.fonte, t.data)],
);

/** Como o cliente avaliou a geracao ("outro_angulo" registra o motivo). */
export type AvaliacaoGeracao = "gostei" | "nao_gostei" | "outro_angulo";

/** Registro de toda chamada de IA (escopo 5.9): entrada, saida, custo e nota. */
export const geracoesIA = pgTable("geracoes_ia", {
  id: id(),
  tarefa: text("tarefa").notNull(),
  versaoPrompt: text("versao_prompt").notNull(),
  modelo: text("modelo").notNull(),
  /** Nulo em tarefas de nicho ou do sistema, sem cliente especifico. */
  clienteId: integer("cliente_id").references(() => clientes.id),
  /** Nunca inclui dado de outro cliente (isolamento entre clientes). */
  entradas: jsonb("entradas").$type<Record<string, unknown>>().notNull(),
  /** ids de video ou noticia usados como evidencia. */
  evidencias: jsonb("evidencias").$type<number[]>().notNull().default([]),
  saida: jsonb("saida").$type<Record<string, unknown>>(),
  tokensEntrada: integer("tokens_entrada").notNull().default(0),
  tokensSaida: integer("tokens_saida").notNull().default(0),
  tokensCache: integer("tokens_cache").notNull().default(0),
  custoUsd: numeric("custo_usd", { precision: 10, scale: 6 }).notNull().default("0"),
  avaliacao: text("avaliacao").$type<AvaliacaoGeracao>(),
  motivoAvaliacao: text("motivo_avaliacao"),
  criadoEm: criadoEm(),
});

export type Nicho = typeof nichos.$inferSelect;
export type Cliente = typeof clientes.$inferSelect;
export type Briefing = typeof briefings.$inferSelect;
export type Conta = typeof contas.$inferSelect;
export type Video = typeof videos.$inferSelect;
export type Noticia = typeof noticias.$inferSelect;
export type Roteiro = typeof roteiros.$inferSelect;
export type AvaliacaoTema = typeof avaliacoesTema.$inferSelect;
export type GeracaoIA = typeof geracoesIA.$inferSelect;
export type ExecucaoJob = typeof execucoesJob.$inferSelect;
export type ConsumoApi = typeof consumoApi.$inferSelect;
