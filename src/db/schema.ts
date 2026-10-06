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
  /**
   * M3, a régua por setor: os três ajustes que hoje são globais
   * (`config.regras`) passam a poder ser mudados por setor no admin, sem
   * mexer em `.env` nem em código. Nulo usa o padrão de `config.regras`
   * (`reguaDoSetor`, `servicos/pesquisa.ts`); "voltar ao padrão" só grava
   * nulo de novo.
   */
  pisoViews: integer("piso_views"),
  /** Fração de 0 a 1 (`config.regras.proporcaoBrasil` é 0.7). */
  proporcaoBrasil: numeric("proporcao_brasil", { precision: 4, scale: 3 }),
  /** Vídeo sem fala (transcrição curta) vale como referência via análise visual. Padrão: não. */
  videoSemFalaVale: boolean("video_sem_fala_vale"),
  /**
   * E45, PR 1: o ramo do catálogo (`src/config/ramos.ts`) a que este setor corresponde, pelo `slug` do ramo. Nulo nos setores que
   * o admin criou à mão e ainda não foram encaixados. Único (onde não nulo): um ramo do catálogo tem um setor só, e é isso que
   * deixa duas pessoas que escolhem o mesmo ramo ao mesmo tempo caírem na mesma base de vídeos. O setor de um ramo sem conta nem
   * existe: nasce quando a primeira marca escolhe o ramo (`garantirNichoDoRamo`, `servicos/ramos.ts`), e é aí que a pesquisa começa.
   */
  ramoCatalogo: text("ramo_catalogo"),
},
(t) => [uniqueIndex("nichos_ramo_catalogo_unico").on(t.ramoCatalogo).where(sql`${t.ramoCatalogo} is not null`)]);

/**
 * Quem grava os videos do cliente (briefing-e-rubricas.md, secao 1). V12c,
 * item 3: "equipe" (so a equipe, o dono nao aparece) e "outra_pessoa" (um
 * apresentador, criador ou cliente) sao valores novos; a pergunta deixou de
 * dizer que e fixo ("pode mudar a cada video. aqui e so o mais comum").
 */
export type QuemGrava = "propria_pessoa" | "pessoa_e_equipe" | "equipe" | "outra_pessoa";
export const VALORES_QUEM_GRAVA = ["propria_pessoa", "pessoa_e_equipe", "equipe", "outra_pessoa"] as const;

/**
 * V12c, item 1: onde estao os clientes do negocio, substitui cidade/bairro na tela. E42a, item 1
 * (achado do Gustavo em 02/10, no Comecar pelo celular: "ta muito limitado ao Brasil"):
 * "outro_pais" (um pais, campo `clientes.pais`) e "mais_de_um_pais" (campo `clientes.paises`,
 * texto livre com quais) entram ao lado de "brasil" e "local".
 */
export type Alcance = "brasil" | "local" | "outro_pais" | "mais_de_um_pais";

/** Perfis do cliente nas redes, coletados no briefing (secao 1). */
export type PerfisCliente = {
  instagram: string | null;
  tiktok: string | null;
  youtube: string | null;
};

/**
 * "negocio" vende o proprio produto ou servico; "criador" quer atrair marca.
 * "conhecido" e "negocios" (P1, item 2, marca do tipo pessoa): quer ficar
 * conhecido no que faz, ou levar gente para os proprios negocios (quando ela
 * tem); "vender o meu produto ou servico" nao existe para pessoa, por isso
 * nao reusa "negocio". Sao valores de texto (`$type`, nunca `pgEnum`, ver
 * `clientes.persona` abaixo), entao nao pedem migracao para crescer.
 */
export type Persona = "negocio" | "criador" | "conhecido" | "negocios";

/**
 * "negocio" fala como a marca ("a gente", "nossa loja"); "pessoa" fala em
 * primeira pessoa do singular (V9a, item 4, escopo 5.13, o pedaco da E33 que
 * a viagem precisa: o perfil do Bruno vira uma marca de tipo pessoa). Nao e
 * o mesmo campo que `Persona` (acima): `persona` diz quem se beneficia do
 * video (a propria marca vendendo, ou um criador atraindo marca patrocinadora);
 * `tipo` diz so a voz gramatical do roteiro. Uma marca "criador" pode muito
 * bem ser "negocio" (vende o proprio curso, por exemplo) ou "pessoa" (o
 * criador fala de si). As doze perguntas de briefing proprias de pessoa
 * (P1, briefing-e-rubricas.md, secao 2b) usam os mesmos ids, blocos e pesos
 * do negocio; so o enunciado, o que a IA procura e o rotulo curto mudam,
 * por `perguntasDoBriefing(tipo)` em `config/briefing.ts`.
 */
export type TipoMarca = "negocio" | "pessoa";

/** Preferencia de tema salva pelo cliente em /conta (etapa D, parte 2). */
export type TemaPreferido = "claro" | "escuro" | "sistema";

/**
 * O nivel de assinatura da marca (V9b-0, decisao do Gustavo em 22/09/2026):
 * `sem_limite` gera quantos roteiros quiser no mesmo dia, todos visiveis no
 * Hoje; `padrao` continua com um roteiro por dia. Interruptor por marca ate
 * os niveis de assinatura serem desenhados (E22).
 */
export type PlanoMarca = "padrao" | "sem_limite";

export const clientes = pgTable("clientes", {
  id: id(),
  /**
   * Usuario do better-auth que criou esta marca (V3, item 1: com varias
   * marcas por usuario, este campo deixa de ser unico e de ser a porta de
   * entrada; quem decide acesso e a tabela `membrosMarca`, abaixo). Nulo
   * (V12b, item 2, migracao 0035): uma marca pode existir sem ninguem, criada
   * so pelo admin; a primeira pessoa a ganhar acesso (`darAcesso`) vira o
   * dono em `membrosMarca`, este campo nunca e escrito depois da criacao.
   */
  usuarioId: text("usuario_id").references(() => user.id, { onDelete: "cascade" }),
  nome: text("nome").notNull(),
  nichoId: integer("nicho_id").references(() => nichos.id),
  /** V12c, item 1: ficam no banco, sem uso na tela desde que `alcance` existe. */
  cidade: text("cidade"),
  bairro: text("bairro"),
  /**
   * V12c, item 1 (decisao do Gustavo em 29/09): cidade e bairro nao
   * importam para quem vende para o Brasil inteiro; o que importa e saber
   * se a venda e nacional ou local. Nulo em cliente criado antes desta
   * coluna (a migracao preenche a partir de `cidade`).
   */
  alcance: text("alcance").$type<Alcance>(),
  /** Texto livre ("Campinas e regiao"), so usado quando `alcance = "local"`. */
  regiao: text("regiao"),
  /** E42a, item 1: texto livre ("Estados Unidos"), so usado quando `alcance = "outro_pais"`. */
  pais: text("pais"),
  /** E42a, item 1: texto livre ("Estados Unidos e Mexico"), so usado quando `alcance = "mais_de_um_pais"`. */
  paises: text("paises"),
  /** V12c, item 6, a E37b: endereco publico da marca, opcional. Validado como URL publica. */
  site: text("site"),
  /** Texto do ramo quando o cliente escolheu "outro" na lista (briefing-e-rubricas.md, secao 1). */
  ramoOutro: text("ramo_outro"),
  persona: text("persona").$type<Persona>().notNull().default("negocio"),
  tipo: text("tipo").$type<TipoMarca>().notNull().default("negocio"),
  plano: text("plano").$type<PlanoMarca>().notNull().default("padrao"),
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
  /**
   * Atualizado pelo layout do painel uma vez por dia, por qualquer pessoa
   * com acesso (etapa 12, decisao 5; V3: e da marca, nao da pessoa, porque
   * o lembrete de um membro considera a marca aberta quando qualquer outro
   * membro dela ja abriu hoje).
   */
  ultimoAcessoEm: timestamp("ultimo_acesso_em", { withTimezone: true }),
  /**
   * O id numerico da conta do Instagram do cliente na Graph API da Meta (V8,
   * item 1): so preenchido quando essa conta esta entre as Paginas que o
   * usuario do sistema do token enxerga (`meta-ig-cliente.ts`,
   * `resolverMetaIgId`). Nulo enquanto nao resolvido, ou quando o cliente nao
   * tem Instagram ligado a nenhuma Pagina do nosso portfolio: nesse caso a
   * curva continua pelo Apify, sem erro.
   */
  metaIgId: text("meta_ig_id"),
  /**
   * A rede onde a marca mais posta (V12, item 3a): perguntada uma vez, na
   * primeira vez que a porta Reels abre ("Onde você posta mais?"), nula até
   * responder, trocável pelo chip a qualquer hora. Prefere vídeos dessa rede
   * na evidência do roteiro (nunca exclui as outras) e prefiltra as
   * Referências.
   */
  redePrincipal: text("rede_principal").$type<Plataforma>(),
  criadoEm: criadoEm(),
});

/** "dono" criou a marca e nao perde o acesso pela tela; "membro" foi convidado (V3, item 1). */
export type PapelMarca = "dono" | "membro";

/**
 * O vinculo entre pessoa e marca (V3, item 1, escopo 4.13): um usuario pode
 * ser membro de varias marcas (`clientes`), e uma marca pode ter varios
 * membros. `clienteDaSessaoAtual` so abre uma marca de que o usuario e
 * membro aqui, nunca por `clientes.usuarioId` sozinho.
 */
export const membrosMarca = pgTable(
  "membros_marca",
  {
    id: id(),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clienteId: integer("cliente_id")
      .notNull()
      .references(() => clientes.id, { onDelete: "cascade" }),
    papel: text("papel").$type<PapelMarca>().notNull().default("membro"),
    /**
     * Diferente de `clientes.ultimoAcessoEm` (a marca inteira, atualizado por
     * qualquer membro): este e o acesso de uma pessoa especifica a esta
     * marca especifica, para o cartao "Quem tem acesso" do admin (item 5).
     */
    ultimoAcessoEm: timestamp("ultimo_acesso_em", { withTimezone: true }),
    criadoEm: criadoEm(),
  },
  (t) => [
    uniqueIndex("membros_marca_usuario_cliente").on(t.usuarioId, t.clienteId),
    index("membros_marca_usuario_id").on(t.usuarioId),
    index("membros_marca_cliente_id").on(t.clienteId),
  ],
);

/**
 * O que e da pessoa, nao da marca (V3, itens 4, 6 e 7): hora do lembrete,
 * quando o lembrete foi mandado pela ultima vez, e quando aceitou os termos.
 * Antes da V3 ficavam em `clientes` (a marca); com uma pessoa em varias
 * marcas, isso teria que valer para todas ao mesmo tempo, o que nao faz
 * sentido (o Bruno pode querer lembrete as 8h de uma marca e as 20h de
 * outra, mas so aceita os termos uma vez, na conta, nao por marca).
 */
export const preferenciasUsuario = pgTable("preferencias_usuario", {
  usuarioId: text("usuario_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** "HH:00", hora cheia de Brasilia (etapa 12, decisao 5 do PROXIMO.md: job lembrete). */
  horaLembrete: text("hora_lembrete").notNull().default("08:00"),
  /**
   * Gravado pelo job `lembrete` ao mandar o e-mail (etapa 13, ajuste 3; V3,
   * item 6: agora um e-mail por pessoa, nao por marca): evita mandar duas
   * vezes no mesmo dia.
   */
  ultimoLembreteEm: timestamp("ultimo_lembrete_em", { withTimezone: true }),
  /** Nulo ate aceitar; quem nao aceitou nao passa do layout (completo) (etapa 12, decisao 7; V3, item 7: da pessoa). */
  aceitouTermosEm: timestamp("aceitou_termos_em", { withTimezone: true }),
  /**
   * E48 PR 1: o convite de instalar o aplicativo no celular. "Agora não" adia por sete dias (`conviteInstalarAdiadoAte`); no servidor, e não no
   * navegador, para valer em qualquer aparelho da pessoa. `instaladoEm` é gravado uma vez, na primeira abertura em modo aplicativo (tela cheia).
   */
  conviteInstalarAdiadoAte: timestamp("convite_instalar_adiado_ate", { withTimezone: true }),
  instaladoEm: timestamp("instalado_em", { withTimezone: true }),
  /** E48 PR 2: onde o aplicativo foi instalado (`iphone`, `android` ou `computador`), gravado junto de `instaladoEm`: o admin diz onde e o aviso por push sabe se é um celular. */
  instaladoEmSistema: text("instalado_em_sistema").$type<SistemaInstalado>(),
  /** E48 PR 2: "agora não" no pedido de permissão do aviso de manhã: a folha não volta antes disto (sete dias, como o convite de instalar). */
  pushAdiadoAte: timestamp("push_adiado_ate", { withTimezone: true }),
});

export type SistemaInstalado = "iphone" | "android" | "computador";

/**
 * E48 PR 2: o aviso de manhã por push. Uma linha por aparelho que a pessoa deixou receber (pode ter mais de um); o endpoint é único. `falhasSeguidas` conta
 * os envios que falharam um atrás do outro (a segunda seguida apaga a inscrição; 404 e 410 do serviço de push apagam na hora, o aparelho já não existe).
 */
export const inscricoesPush = pgTable(
  "inscricoes_push",
  {
    id: id(),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    sistema: text("sistema").$type<SistemaInstalado>().notNull(),
    criadoEm: criadoEm(),
    /**
     * Quando começou a falha CORRENTE (a primeira de uma sequência sem nenhum envio aceito); nulo quando está tudo certo. Um envio aceito a zera. Uma
     * inscrição que falha por mais de 14 dias sem nenhum envio aceito (401, 403, 429, 5xx: falhas que não contam como do aparelho) é apagada.
     */
    ultimaFalhaEm: timestamp("ultima_falha_em", { withTimezone: true }),
    falhasSeguidas: integer("falhas_seguidas").notNull().default(0),
    /** Quando o serviço de push aceitou um envio pela última vez (A2). */
    ultimoSucessoEm: timestamp("ultimo_sucesso_em", { withTimezone: true }),
  },
  (t) => [uniqueIndex("inscricoes_push_endpoint").on(t.endpoint), index("inscricoes_push_usuario").on(t.usuarioId)],
);
export type InscricaoPush = typeof inscricoesPush.$inferSelect;

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
    /**
     * Só marca do tipo pessoa (P1, item 4, briefing-e-rubricas.md, secao 2b):
     * o episódio da virada (P3) e as opiniões que geram conversa (P6), com o
     * porquê de cada uma. Ausentes (ou `undefined`) no negócio; opcionais
     * também num perfil de pessoa compilado antes desta versão do prompt.
     */
    historia?: string;
    posicionamentos?: string[];
  };
  resumo: string;
  /**
   * Vídeos que o cliente favoritou em `/referencias` (etapa 12, decisão 1 do
   * `PROXIMO.md`), preenchido por código depois da chamada de IA, mesma
   * lógica de `clientes.camadaExclusiva`. Ausente em perfil compilado antes
   * desta etapa; `formatarPerfilCompilado` trata como lista vazia.
   */
  referencias: string[];
  /**
   * Concorrentes e perfis admirados citados pelo cliente nas duas listas de
   * @ da P12 (`perfis_citados`, V12c, item 8, a E37b), preenchido por
   * código depois da chamada de IA, mesma lógica de `referencias` acima.
   * Nesta etapa só guarda e mostra; conferir na API, analisar e levar ao
   * setor é a E38. Ausente em perfil compilado antes desta etapa;
   * `formatarPerfilCompilado` trata como listas vazias.
   */
  perfisCitados?: { concorrentes: string[]; admira: string[] };
  /**
   * E38 PR 2 ("o que entendemos da sua marca"): o que a pessoa CONFIRMOU ou CORRIGIU na seção "O
   * que a IA tirou das suas redes e do seu site" do briefing. Nunca mora neste JSON: `briefings.perfil`
   * é reescrito inteiro a cada edição de resposta (`compilarEGravarPerfil`), o que apagaria o
   * campo. A fonte é a tabela `contexto_marca_itens`; `perfilDoCliente` (src/servicos/briefing.ts)
   * mescla o campo na hora de ler, para todo consumidor do perfil (roteiro, tema, plano) ver a
   * versão em vigor sem recompilar nada. Opcional, nunca obrigatório: mais de 15 arquivos montam
   * literais deste tipo. Só item que a pessoa confirmou entra; pendente nunca vai para um prompt.
   */
  contextoConfirmado?: { categoria: CategoriaContextoMarca; texto: string }[];
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
  /**
   * P2, item 3: perguntaId -> a fala tal como veio da transcrição, antes de `organizarFalaBriefing`
   * tirar as muletas de fala. Opcional, para análise e auditoria; só existe quando a resposta veio
   * pelo microfone. Coluna nova (não um campo dentro de `respostas[id]`, que já é `string` em
   * produção com respostas reais de cliente: trocar a forma quebraria toda leitura existente).
   */
  transcricoesBrutas: jsonb("transcricoes_brutas")
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  notaGeral: numeric("nota_geral", { precision: 4, scale: 2 }),
  /** true quando a nota geral chegou a 8 (gate da plataforma) */
  completo: boolean("completo").notNull().default(false),
  /** Gerado na liberacao e recompilado a cada edicao posterior (tarefa compilarPerfil). */
  perfil: jsonb("perfil").$type<PerfilCompilado>(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});

/** "concorrente" ou perfil que o cliente admira, citado na P12 (V12c, item 7, a E37b). */
export type TipoPerfilCitado = "concorrente" | "admira";

/**
 * Concorrentes e perfis admirados citados pelo cliente, em campos de @ (V12c,
 * item 7, a E37b): substitui o texto solto que a pessoa digitava na P12.
 * Nesta etapa só guarda e mostra (sem conferir na API nem analisar, isso é a
 * E38). `migrar-perfis-citados.ts` preenche a partir das respostas antigas de
 * P12, sem duplicar numa segunda rodada (único por cliente, tipo, rede e
 * handle).
 */
export const perfisCitados = pgTable(
  "perfis_citados",
  {
    id: id(),
    clienteId: integer("cliente_id")
      .notNull()
      .references(() => clientes.id, { onDelete: "cascade" }),
    tipo: text("tipo").$type<TipoPerfilCitado>().notNull(),
    rede: text("rede").$type<Plataforma>().notNull(),
    handle: text("handle").notNull(),
    criadoEm: criadoEm(),
  },
  (t) => [uniqueIndex("perfis_citados_cliente_tipo_rede_handle").on(t.clienteId, t.tipo, t.rede, t.handle)],
);

/** "citado" (de `perfisCitados`) ou "propria_marca" (de `clientes.perfis`), E38 parte 2 e 3. */
export type OrigemPerfilAnalisado = "citado" | "propria_marca";

/**
 * Por que um perfil analisado não tem leitura (E38 PR 2, acabamento a). Separado de `erro`: a
 * tela escolhe a frase pelo motivo, e só "nao_encontrado" é de fato um @ digitado errado. Linhas
 * antigas têm `motivo` nulo; `estadoDoPerfilAnalisado` (src/lib/perfil-analisado-motivo.ts) deriva na leitura (pela frase antiga em `erro`).
 */
export type MotivoPerfilNaoLido = "tiktok_desligado" | "nao_encontrado" | "sem_videos" | "conta_restrita";

/**
 * A camada exclusiva de verdade (E38, partes 2 e 3; `clientes.camadaExclusiva`, acima, é só texto
 * livre para o prompt, sem vídeo nem conferência nenhuma). Uma linha por perfil citado pelo
 * cliente ou pela própria marca, conferido na API da rede de verdade (nunca por memória do
 * modelo), com a leitura curta que `src/ia/prompts/analisarPerfilCitado.ts` escreve. Separada de
 * `contas`/`videos` de propósito (nunca uma coluna `clienteId` ali): é pequena e exclusiva de um
 * cliente, nunca entra na base compartilhada do nicho nem aparece para outra marca.
 *
 * `perfilCitadoId` nulo é o perfil da própria marca (`clientes.perfis`); preenchido é um dos
 * citados. `qualificaParaSetor` é a mesma régua do `pesquisa-de-setor` (M2): só o admin liga
 * (`viraDoSetorEm`), nunca automático.
 */
export const perfisAnalisados = pgTable(
  "perfis_analisados",
  {
    id: id(),
    clienteId: integer("cliente_id")
      .notNull()
      .references(() => clientes.id, { onDelete: "cascade" }),
    perfilCitadoId: integer("perfil_citado_id").references(() => perfisCitados.id, { onDelete: "cascade" }),
    origem: text("origem").$type<OrigemPerfilAnalisado>().notNull(),
    rede: text("rede").$type<Plataforma>().notNull(),
    handle: text("handle").notNull(),
    /** A conta não existe na rede, ou a API recusou (perfil pessoal, restrição de idade). */
    existeNaRede: boolean("existe_na_rede").notNull().default(true),
    seguidores: integer("seguidores"),
    contagemVideosLidos: integer("contagem_videos_lidos").notNull().default(0),
    /** "o que esse perfil faz que você provavelmente gosta" (citado) ou "o que rende no seu
     * próprio perfil" (própria marca); nulo enquanto o job ainda não terminou. */
    leitura: text("leitura"),
    qualificaParaSetor: boolean("qualifica_para_setor").notNull().default(false),
    /** Preenchido quando o admin liga (parte 3): vira uma linha em `contas`, vigiada. */
    viraDoSetorEm: timestamp("vira_do_setor_em", { withTimezone: true }),
    /** A conferência ou a leitura falharam de um jeito que não vale tentar nesta mesma hora. */
    erro: text("erro"),
    /** Por que não há leitura (E38 PR 2, acabamento a); nulo em linha antiga e quando há leitura. */
    motivo: text("motivo").$type<MotivoPerfilNaoLido>(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
    criadoEm: criadoEm(),
  },
  (t) => [uniqueIndex("perfis_analisados_cliente_rede_handle").on(t.clienteId, t.rede, t.handle)],
);

/** As quatro coisas que "o que entendemos da sua marca" diz (plano, E38, item 1). */
export type CategoriaContextoMarca = "vende" | "fala" | "posta" | "rendeu";
/** De onde veio o item; só o que foi lido de verdade naquela leitura pode ser declarado. */
export type FonteContextoMarca = "site" | "instagram" | "youtube";
/** `para_confirmar`: a proposta da IA ainda sem resposta; `recusado`: a pessoa tirou, nunca volta. */
export type EstadoItemContextoMarca = "para_confirmar" | "confirmado" | "corrigido" | "recusado";
/** O que a pílula "novidade" diz: item novo, texto que mudou, ou algo que a pessoa não tinha contado. */
export type NovidadeContextoMarca = "nova" | "mudou" | "alem_do_briefing";

/** O estado de cada fonte na última leitura, para a tela dizer o que foi lido e o que não deu. */
export type FonteDoContexto = {
  tipo: FonteContextoMarca | "tiktok";
  lida: boolean;
  /** Por que não foi lida (ver `MotivoLeituraSite` e `MotivoPerfilNaoLido`); ausente quando lida. */
  motivo?: string;
  /** Páginas do site ou vídeos da rede que entraram na leitura. */
  quantidade?: number;
};

/**
 * E38 PR 2: o estado da leitura mensal do site e das redes da própria marca, uma linha por
 * cliente. Nada daqui alimenta a base do setor (nenhuma ligação com `nichos`, `contas` ou
 * `videos`): é a camada exclusiva do cliente, como `perfis_analisados`. ESTA tabela não guarda o
 * texto bruto das páginas, só o hash, a quantidade e o estado. Atenção: o texto lido (até cinco
 * páginas) vai na entrada da chamada de IA, e `geracoes_ia.entradas` guarda a entrada inteira de
 * toda chamada, sem prazo (ver "decisões pendentes" do TODO: privacidade e exclusão da marca).
 */
export const contextoMarca = pgTable("contexto_marca", {
  id: id(),
  clienteId: integer("cliente_id")
    .notNull()
    .references(() => clientes.id, { onDelete: "cascade" })
    .unique(),
  /** sha256 do texto das páginas, dos títulos lidos e do resumo do briefing usado; igual ao anterior e a IA não é chamada (o briefing pronto depois refaz a leitura). */
  hashFontes: text("hash_fontes"),
  ultimaLeituraOkEm: timestamp("ultima_leitura_ok_em", { withTimezone: true }),
  ultimaTentativaEm: timestamp("ultima_tentativa_em", { withTimezone: true }),
  /** Depois de uma falha esperada (site fora do ar, bloqueio, IA reprovada): não insistir antes. */
  proximaTentativaEm: timestamp("proxima_tentativa_em", { withTimezone: true }),
  /** Trava atômica: duas leituras da mesma marca nunca rodam juntas (hotfix de 01/10, jobs repetidos). */
  lendoDesde: timestamp("lendo_desde", { withTimezone: true }),
  fontes: jsonb("fontes").$type<FonteDoContexto[]>().notNull().default([]),
  criadoEm: criadoEm(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Uma afirmação sobre a marca que a pessoa confirma, corrige ou tira. `texto` é a última proposta
 * da IA; `textoConfirmado` é o que está em vigor (o texto da IA que ela aceitou, ou o que ela
 * escreveu no lugar) e é o único que chega aos prompts. Se uma leitura nova propõe outro texto,
 * `texto` muda e o item volta a `para_confirmar`, mas `textoConfirmado` continua valendo até a
 * pessoa decidir. A correção da pessoa nunca é sobrescrita pela IA; item `recusado` nunca volta.
 */
export const contextoMarcaItens = pgTable(
  "contexto_marca_itens",
  {
    id: id(),
    clienteId: integer("cliente_id")
      .notNull()
      .references(() => clientes.id, { onDelete: "cascade" }),
    categoria: text("categoria").$type<CategoriaContextoMarca>().notNull(),
    origem: text("origem").$type<FonteContextoMarca>().notNull(),
    texto: text("texto").notNull(),
    textoConfirmado: text("texto_confirmado"),
    estado: text("estado").$type<EstadoItemContextoMarca>().notNull().default("para_confirmar"),
    /** O estado de antes de a pessoa tirar o item, para "Desfazer" devolver o que era. */
    estadoAnterior: text("estado_anterior").$type<EstadoItemContextoMarca>(),
    novidade: text("novidade").$type<NovidadeContextoMarca>(),
    /** A última leitura que leu a fonte do item e não o propôs de novo. */
    sumiuEm: timestamp("sumiu_em", { withTimezone: true }),
    ultimaVezVistoEm: timestamp("ultima_vez_visto_em", { withTimezone: true }).notNull().defaultNow(),
    confirmadoEm: timestamp("confirmado_em", { withTimezone: true }),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contexto_marca_itens_cliente_id").on(t.clienteId)],
);

/** O pedido de ramo: aberto até o admin olhar; atendido (encaixado ou ramo criado) ou cancelado (a pessoa escolheu um ramo da lista antes). */
export type EstadoPedidoDeRamo = "aberto" | "atendido" | "cancelado";
export type ResolucaoPedidoDeRamo = "encaixado" | "ramo_criado";

/**
 * E45, PR 2: o "Não achei o meu". A pessoa que não se achou no catálogo escreve o ramo com as palavras dela; o texto vira um pedido ao
 * admin, e a marca entra PROVISORIAMENTE no ramo mais próximo do que escreveu (`setorProvisorioId`, nulo quando nada casou) para não ficar
 * sem temas. O admin decide (nunca setor novo automático): encaixa a marca num ramo que existe, ou cria o ramo. Uma marca tem no máximo um
 * pedido aberto (índice único parcial): escrever de novo atualiza o mesmo. O texto também fica em `clientes.ramo_outro` enquanto o pedido
 * está aberto.
 */
export const pedidosDeRamo = pgTable(
  "pedidos_de_ramo",
  {
    id: id(),
    clienteId: integer("cliente_id")
      .notNull()
      .references(() => clientes.id, { onDelete: "cascade" }),
    texto: text("texto").notNull(),
    /** O setor em que a marca entrou enquanto espera; nulo quando nada casou (ou o teto de setores novos do dia segurou). */
    setorProvisorioId: integer("setor_provisorio_id").references(() => nichos.id),
    estado: text("estado").$type<EstadoPedidoDeRamo>().notNull().default("aberto"),
    /** Como o admin resolveu (só em `atendido`). */
    resolucao: text("resolucao").$type<ResolucaoPedidoDeRamo>(),
    /** O setor em que a marca ficou ao resolver (o encaixado, ou o que o admin criou). */
    setorFinalId: integer("setor_final_id").references(() => nichos.id),
    criadoEm: criadoEm(),
    resolvidoEm: timestamp("resolvido_em", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("pedidos_de_ramo_um_aberto_por_marca").on(t.clienteId).where(sql`${t.estado} = 'aberto'`),
    index("pedidos_de_ramo_estado").on(t.estado),
  ],
);

/**
 * E45, PR 3: os ramos alternativos de uma marca. `clientes.nicho_id` continua sendo o ramo principal (os temas do dia vêm só dele); aqui ficam
 * até dois alternativos, que o admin liga e desliga (o cliente não liga sozinho, decisão do Gustavo de 02/10/2026). Entram no tema livre, nas
 * Referências e na evidência do roteiro. A regra do máximo de dois mora no serviço (`ramos-da-conta.ts`); o índice único impede o mesmo setor duas vezes.
 */
export const ramosDaConta = pgTable(
  "ramos_da_conta",
  {
    id: id(),
    clienteId: integer("cliente_id")
      .notNull()
      .references(() => clientes.id, { onDelete: "cascade" }),
    nichoId: integer("nicho_id")
      .notNull()
      .references(() => nichos.id),
    ligadoPorUsuarioId: text("ligado_por_usuario_id").references(() => user.id, { onDelete: "set null" }),
    ligadoEm: timestamp("ligado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ramos_da_conta_marca_setor").on(t.clienteId, t.nichoId), index("ramos_da_conta_setor").on(t.nichoId)],
);
export type RamoDaConta = typeof ramosDaConta.$inferSelect;

/**
 * E44 PR 1: as chaves de formato de uma marca. Uma linha só existe quando alguém decidiu: sem linha, vale o padrão do estudo (`config/formatos.ts`). `quem` é
 * `cliente` (a resposta do briefing) ou `admin` (a correção do Gustavo, que vale por cima); "voltar ao que o cliente escolheu" apaga a linha do admin.
 * Uma marca "tem resposta" quando tem qualquer linha aqui (o corte global de meme e recorte da H4 só sai para ela, até o PR 2).
 */
export const formatosDaMarca = pgTable(
  "formatos_da_marca",
  {
    id: id(),
    clienteId: integer("cliente_id")
      .notNull()
      .references(() => clientes.id, { onDelete: "cascade" }),
    chave: text("chave").notNull(),
    ligada: boolean("ligada").notNull(),
    quem: text("quem").$type<"cliente" | "admin">().notNull(),
    decididoPorUsuarioId: text("decidido_por_usuario_id").references(() => user.id, { onDelete: "set null" }),
    decididoEm: timestamp("decidido_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("formatos_da_marca_chave").on(t.clienteId, t.chave, t.quem)],
);
export type FormatoDaMarca = typeof formatosDaMarca.$inferSelect;

/**
 * E46 PR 1: o registro de tudo o que o admin troca na página de uma conta (ramo, tipo, rede, público, limite): quem, o quê, quando, com o antes e o depois em
 * texto curto. Só se acrescenta, nunca se edita. A conta apagada leva o registro junto (cascade); a pessoa apagada deixa a linha sem nome (set null).
 */
export const alteracoesDoAdmin = pgTable(
  "alteracoes_do_admin",
  {
    id: id(),
    clienteId: integer("cliente_id")
      .notNull()
      .references(() => clientes.id, { onDelete: "cascade" }),
    porUsuarioId: text("por_usuario_id").references(() => user.id, { onDelete: "set null" }),
    /** Chave curta do que mudou: "ramo", "tipo", "rede_principal", "publico", "roteiros_por_dia". */
    campo: text("campo").notNull(),
    antes: text("antes"),
    depois: text("depois"),
    em: timestamp("em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("alteracoes_do_admin_cliente_em").on(t.clienteId, t.em)],
);
export type AlteracaoDoAdmin = typeof alteracoesDoAdmin.$inferSelect;

/**
 * E46 PR 3: um custo fixo cadastrado no admin (o servidor, as contas de desenvolvimento, as coletas compartilhadas). Em reais ou em dólar, por mês ou por ano. "Tirar" não
 * apaga: `ativo = false` e `tiradoEm`, porque o que já custou continua nos meses que passaram.
 */
export const custosFixos = pgTable("custos_fixos", {
  id: id(),
  nome: text("nome").notNull(),
  /** O valor na moeda de cobrança, por período. */
  valor: numeric("valor", { precision: 12, scale: 2 }).notNull(),
  moeda: text("moeda").$type<"brl" | "usd">().notNull().default("brl"),
  periodo: text("periodo").$type<"mensal" | "anual">().notNull().default("mensal"),
  /** Texto livre: "todo dia 5", "cartão, no começo do mês". */
  cobra: text("cobra"),
  ativo: boolean("ativo").notNull().default(true),
  tiradoEm: timestamp("tirado_em", { withTimezone: true }),
  /** E49 PR 1, item 0: quem cadastrou, quem editou por último e quem tirou. */
  criadoPorUsuarioId: text("criado_por_usuario_id").references(() => user.id, { onDelete: "set null" }),
  atualizadoPorUsuarioId: text("atualizado_por_usuario_id").references(() => user.id, { onDelete: "set null" }),
  tiradoPorUsuarioId: text("tirado_por_usuario_id").references(() => user.id, { onDelete: "set null" }),
  criadoEm: criadoEm(),
});
export type CustoFixo = typeof custosFixos.$inferSelect;

/**
 * E46 PR 2: o registro do "ver como". Cada entrada do admin no painel de uma conta, como uma pessoa dela: quem (o admin), em qual pessoa e conta, quando entrou, quando o modo acaba
 * por si (30 minutos) e, quando termina, quando e por quê (`saiu` pelo botão, `expirou`, `trocou` por outra entrada do mesmo admin, `sessao` quando o cookie sobrou sem a sessão do admin).
 * Nunca se apaga: é o rastro de quem olhou o quê.
 */
export const verComoEntradas = pgTable("ver_como_entradas", {
  id: id(),
  // `restrict`: o rastro de quem olhou o quê não some junto com a pessoa, o admin ou a conta (nenhum fluxo do produto apaga usuário ou conta; quem precisar apagar decide à mão).
  adminId: text("admin_id")
    .notNull()
    .references(() => user.id, { onDelete: "restrict" }),
  pessoaId: text("pessoa_id")
    .notNull()
    .references(() => user.id, { onDelete: "restrict" }),
  clienteId: integer("cliente_id")
    .notNull()
    .references(() => clientes.id, { onDelete: "restrict" }),
  entrouEm: timestamp("entrou_em", { withTimezone: true }).notNull().defaultNow(),
  expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
  saiuEm: timestamp("saiu_em", { withTimezone: true }),
  motivoSaida: text("motivo_saida").$type<"saiu" | "expirou" | "trocou" | "sessao">(),
}, (t) => [index("ver_como_entradas_conta").on(t.clienteId, t.entrouEm), index("ver_como_entradas_admin").on(t.adminId, t.saiuEm)]);
export type VerComoEntrada = typeof verComoEntradas.$inferSelect;

/**
 * Custo que falta no admin: o que o sistema paga fora da IA e hoje só aparecia como unidade (a transcrição pela Groq, por minuto de áudio; a coleta pelo Apify, por execução). Uma linha por chamada
 * paga, com o custo em dólar (da API quando ela devolve, senão pelo preço da data em `config/precos-ia.ts`), a unidade medida e, quando se sabe, a execução e o ramo.
 */
export const custosExternos = pgTable(
  "custos_externos",
  {
    id: id(),
    /** De onde veio o gasto: "groq" (transcrição) ou "apify" (coleta). */
    fonte: text("fonte").$type<"groq" | "apify">().notNull(),
    custoUsd: numeric("custo_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    /** Quantas unidades a chamada gastou: minutos de áudio na Groq, resultados no Apify. */
    unidades: numeric("unidades", { precision: 12, scale: 3 }).notNull().default("0"),
    unidade: text("unidade").$type<"minutos" | "resultados">().notNull(),
    /** O ramo do gasto, quando se sabe (nulo na rodada de todos os ramos e no que não é de ramo). */
    ramoId: integer("ramo_id").references(() => nichos.id, { onDelete: "set null" }),
    /** A execução (`execucoes_job`) em que o gasto aconteceu, quando houve. */
    execucaoId: integer("execucao_id").references(() => execucoesJob.id, { onDelete: "set null" }),
    /** Se o custo veio da API ("api") ou foi estimado pelo preço da data ("estimado"). */
    origemDoCusto: text("origem_do_custo").$type<"api" | "estimado">().notNull().default("estimado"),
    detalhe: jsonb("detalhe").$type<Record<string, unknown>>(),
    criadoEm: criadoEm(),
  },
  (t) => [index("custos_externos_criado_em").on(t.criadoEm), index("custos_externos_ramo").on(t.ramoId, t.criadoEm)],
);
export type CustoExterno = typeof custosExternos.$inferSelect;

/** E46 PR 3: cada "rodar agora" que o admin dispara em Rotinas (quem, qual fila, quando), para o detalhe da rotina dizer "rodada à mão por fulano às 07:23". */
export const disparosDoAdmin = pgTable(
  "disparos_do_admin",
  {
    id: id(),
    fila: text("fila").notNull(),
    porUsuarioId: text("por_usuario_id").references(() => user.id, { onDelete: "set null" }),
    em: timestamp("em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("disparos_do_admin_fila_em").on(t.fila, t.em)],
);
export type DisparoDoAdmin = typeof disparosDoAdmin.$inferSelect;

/** E46 PR 3: ajustes do admin que valem para o sistema todo, uma linha por chave ("teto_diario_brl"). Texto, para qualquer valor caber. */
export const configuracaoAdmin = pgTable("configuracao_admin", {
  chave: text("chave").primaryKey(),
  valor: text("valor").notNull(),
  atualizadoPorUsuarioId: text("atualizado_por_usuario_id").references(() => user.id, { onDelete: "set null" }),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Motor de pesquisa (escopo 5)
// ---------------------------------------------------------------------------

export type Plataforma = "youtube" | "tiktok" | "instagram";

/**
 * De onde `medianaViews` veio (PROXIMO.md, E6 parte 3, item 2): "conta" e a
 * mediana de verdade (5 ou mais videos nos ultimos 90 dias); sem isso,
 * "seguidores" e o substituto por seguidor (`seguidores * taxa tipica do
 * nicho e da plataforma`, `src/jobs/pontuar.ts`); sem seguidores nem,
 * "setor" e a mediana de views do nicho inteiro naquela plataforma. Assim
 * que a conta ganha uma mediana de nivel melhor, a origem muda e o
 * multiplo de todo video da conta e recalculado no `pontuar` seguinte.
 *
 * V9d, item 0b (achado do Gustavo em 25/09, usando o painel): a formula do
 * substituto por seguidor mudou (`seguidores * taxa tipica`, no lugar de
 * `views do video / seguidores * 100`); o nome "seguidores" da origem
 * continua o mesmo, só a conta por trás dele mudou.
 */
export type MedianaOrigem = "conta" | "seguidores" | "setor";

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
    /** Nivel de `medianaViews` (nulo quando a conta nao tem nenhuma mediana ainda) */
    medianaOrigem: text("mediana_origem").$type<MedianaOrigem>(),
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
    /**
     * "coleta" veio do motor (upsertConta durante uma coleta), "seed" e
     * exemplo de desenvolvimento, "curadoria" foi acrescentada pelo admin
     * como conta semente (etapa 24, parte 1), "pesquisa" foi achada e
     * conferida pelo job `pesquisa-de-setor` (M2): mesmo tratamento de
     * semente que "curadoria" na vigilância, só que descoberta pela
     * máquina em vez de colada pela pessoa. "indicada" é um perfil citado por
     * um cliente (`perfisAnalisados`, E38) que o admin confirmou virar conta
     * do setor. Mesma forma de videos.origem.
     */
    origem: text("origem")
      .$type<"coleta" | "seed" | "curadoria" | "pesquisa" | "indicada">()
      .notNull()
      .default("coleta"),
    /**
     * Coleta por perfil falhou de um jeito conhecido e nao vale gastar cota
     * tentando de novo na mesma hora (rodada de acabamento de 06/09, item 2:
     * `@ninadobre` com 404 na playlist de uploads). A tela do nicho mostra
     * este texto ao lado da conta; `avisoColetaEm` e o que garante no maximo
     * uma tentativa por dia (limpo assim que uma coleta volta a funcionar).
     */
    avisoColeta: text("aviso_coleta"),
    avisoColetaEm: timestamp("aviso_coleta_em", { withTimezone: true }),
    /**
     * Job `contas-base` (E6 parte 3, item 5) ja tentou trazer o catch-up de
     * ate 10 videos recentes desta conta. Nulo faz a conta candidata a
     * selecao do job; marcado uma vez, nunca mais e selecionada de novo,
     * mesmo que continue com menos de 5 videos (a plataforma pode nao ter
     * mais que isso para ela).
     */
    baseCompletaEm: timestamp("base_completa_em", { withTimezone: true }),
    /**
     * A conta e pessoal ou tem restricao de idade: a Business Discovery da
     * Meta devolve erro para ela (E6 parte 3, segunda rodada, item 2).
     * Marcada uma vez, o job de Instagram pela API nunca mais tenta essa
     * conta, e ela volta a ser coberta pelo Apify.
     */
    apiIndisponivelEm: timestamp("api_indisponivel_em", { withTimezone: true }),
    /** Ultima vez que esta conta foi lida pela Business Discovery da Meta (admin, item 5). */
    ultimaLeituraMetaEm: timestamp("ultima_leitura_meta_em", { withTimezone: true }),
    /**
     * Pais da conta, duas letras (V2b, item 1, escopo 5.11: o Brasil
     * primeiro), nulo quando nao da para saber. Hoje so "BR" e gravado (pelo
     * indicio de Brasil da Meta ou pelo pais do canal do YouTube); a
     * vigilancia (`vigilancia.ts`) usa para preferir conta brasileira.
     */
    pais: text("pais"),
    /**
     * Idioma predominante da conta (V2b, item 4): a moda do `videos.idioma`
     * dos videos da conta nos ultimos 90 dias, calculada pelo `pontuar`
     * quando ha pelo menos 3 videos com idioma conhecido; nulo ate la.
     */
    idiomaPrincipal: text("idioma_principal"),
    /**
     * "Tirar" uma conta semente no admin do setor (M2, item 3): marca em vez
     * de apagar, para o histórico de vídeo já coletado continuar valendo.
     * `pesquisa-de-setor` nunca propõe de novo um handle com `removidaEm`
     * preenchido, e a vigilância para de marcar `vigiada` para ela.
     */
    removidaEm: timestamp("removida_em", { withTimezone: true }),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("contas_plataforma_handle").on(t.plataforma, t.handle)],
);

/**
 * Uma linha por rodada do job `pesquisa-de-setor` (M2): quando o setor nasce
 * pesquisado, quando o admin pede "Pesquisar o mercado de novo", e uma vez
 * por mês para os setores ativos. `resumo` é a prestação de contas que a
 * regra do projeto exige (nada entra por memória do modelo, toda conta
 * proposta é conferida): quantas foram sugeridas, quantas confirmadas na
 * API, quantas descartadas e por quê, quanto custou, mais os termos e
 * hashtags extras que a sugestão trouxe, para o admin aceitar com um toque.
 */
export const pesquisasSetor = pgTable("pesquisas_setor", {
  id: id(),
  nichoId: integer("nicho_id")
    .notNull()
    .references(() => nichos.id),
  resumo: jsonb("resumo").$type<ResumoPesquisaSetor>().notNull(),
  criadoEm: criadoEm(),
});

export type ResumoPesquisaSetor = {
  sugeridas: { youtube: number; instagram: number; tiktok: number };
  confirmadas: { youtube: number; instagram: number; tiktok: number };
  /** "sugerido e nao existe", "fora do setor", "nao brasileiro", "video longo demais", "sem alcance", etc, com a contagem. */
  descartadas: Record<string, number>;
  contasNovas: number;
  contasAtualizadas: number;
  termosSugeridos: string[];
  hashtagsSugeridas: string[];
  custo: {
    unidadesYoutube: number;
    chamadasMeta: number;
    resultadosApify: number;
    custoIaUsd: number;
  };
};

/**
 * O tipo de abertura de um vídeo (V4, roteiro sem vício, escopo 5.12, item
 * 5): a extração declara o tipo que já funcionou (`videos.tipoAbertura`), o
 * serviço do roteiro escolhe qual repetir a partir da evidência do dia sem
 * repetir os últimos 5 do cliente (`roteiros.tipoAbertura`), e o modelo
 * declara o que de fato escreveu. Fonte única para as duas colunas e para
 * os dois schemas de saída de IA que usam este enum.
 */
export const TIPOS_ABERTURA = [
  "cena",
  "resultado",
  "objeto",
  "fala_direta",
  "numero",
  "contraste",
  "pergunta",
  "outro",
] as const;
export type TipoAbertura = (typeof TIPOS_ABERTURA)[number];

/**
 * H4, item 2 (achado do Gustavo em produção em 01/10, o caso do roteiro 12): "original"
 * quando quem publica é quem aparece e fala; "recorte" quando é trecho de outra pessoa,
 * programa ou podcast repostado; "meme" quando é humor, POV, dublagem ou montagem;
 * "noticia" já existia como sinal de assunto, agora classificado junto com o resto. A
 * extração grava este campo (`extrairVideo.ts`); nulo em todo vídeo extraído antes dele
 * existir, até a reclassificação em lote rodar.
 */
export const TIPOS_CONTEUDO = ["original", "recorte", "meme", "noticia"] as const;
export type TipoConteudo = (typeof TIPOS_CONTEUDO)[number];

/**
 * O formato do roteiro (V9c, E34 enxuta): "reels" continua a estrutura de
 * gancho, corpo, fechamento e chamada; "story" sai em cartões numerados
 * (`ConteudoRoteiro.cartoes`), a partir das regras `R-IG-STORY`
 * (`src/ia/prompts/regras-formato.ts`). Coluna em `roteiros` e em
 * `plano_gravacoes` (a sugestão de `planejarDia` já nasce com um formato).
 */
export const FORMATOS_ROTEIRO = ["reels", "story"] as const;
export type FormatoRoteiro = (typeof FORMATOS_ROTEIRO)[number];

/**
 * M4: o estilo do roteiro, ortogonal ao formato (um Reels ou um Story podem ser `falado` ou
 * `sem_fala`). "sem_fala" usa a mesma estrutura de cartões do Story (`ConteudoRoteiro.cartoes`),
 * com `oQueFalar` sempre vazio: cada cartão é uma cena (o que mostrar, texto na tela), nunca fala.
 * Decisão do Gustavo em 30/09/2026 ("a gente não pode pensar em apenas vídeos falando").
 */
export const ESTILOS_ROTEIRO = ["falado", "sem_fala"] as const;
export type EstiloRoteiro = (typeof ESTILOS_ROTEIRO)[number];

/**
 * E39a: em que parte do dia um Story acontece, pergunta só para Story (um Reels não tem "quando
 * no dia", só "quando no calendário"). A pessoa completa o rótulo com as próprias palavras ("Manhã,
 * saindo de casa"); estas quatro chaves são só a parte fixa, do jeito que o desenho do Opus
 * (`Hoje.dc.html`, dúvida 12) define. Nulo em Reels, e em Story sem a pergunta respondida ainda.
 */
export const MOMENTOS_DO_DIA = ["manha", "meio_dia", "fim_tarde", "noite"] as const;
export type MomentoDoDia = (typeof MOMENTOS_DO_DIA)[number];

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
  /**
   * H4, item 2 (achado do Gustavo em produção em 01/10, o caso do roteiro 12, um meme virando
   * referência): o que o vídeo é e se serve de modelo de estrutura para um roteiro. Também
   * gravado nas colunas próprias `videos.tipoConteudo`/`videos.serveDeModelo` (para
   * `evidenciaParaRoteiro` filtrar por SQL); aqui dentro só para o registro completo da
   * extração. Ausente em toda análise gravada antes destes campos existirem.
   */
  tipoConteudo?: TipoConteudo;
  serveDeModelo?: boolean;
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
    /**
     * Item 0 da E45 (decisão 21 do M5c): quando a ÚLTIMA falha da transcrição foi de infraestrutura, e não do vídeo: o `yt-dlp`
     * ou a Groq passaram do tempo limite, ou o YouTube bloqueou o robô. Preenchida junto com `proximaTentativaTranscricao` nesses
     * dois casos, e apagada (nula) por qualquer falha comum e por uma transcrição que saiu. Existe porque `extrair-sem-fala`
     * aceitava "tentou e falhou" (`proximaTentativaTranscricao` não nula) como porta de entrada sem olhar o motivo: um vídeo
     * FALADO que só estourou o tempo ganhava uma ficha só por quadros, com o selo "sem fala", e o `transcrever` nunca mais o lia.
     */
    falhaDeInfraEm: timestamp("falha_de_infra_em", { withTimezone: true }),
    /**
     * M4/P2b, item 0e: o download ou a leitura falhou no caminho sem fala (`extrair-sem-fala.ts`);
     * preenchida com "agora + 7 dias", mesmo raciocínio de `proximaTentativaTranscricao`. Sem isto,
     * o mesmo vídeo que sempre falha (um link morto, por exemplo) ocupava vaga do teto diário em
     * toda rodada, achado em produção em 30/09 no setor da Overtake (7 das 15 vagas, três rodadas
     * seguidas).
     */
    proximaTentativaSemFala: timestamp("proxima_tentativa_sem_fala", { withTimezone: true }),
    /**
     * M4, item 1: `true` quando a análise veio do caminho sem fala (`extrair-sem-fala`, quadros e
     * legenda, sem transcrição); `false` quando veio do caminho normal (`extrair`, `extrair-agora`,
     * `extrair-coleta`, com transcrição). Nulo no que já estava analisado antes desta coluna existir
     * (conta como falado: é a leitura de longe mais comum). Usado para sugerir o estilo do roteiro
     * pela evidência (`sugerirEstiloPelaEvidencia`) e para a etiqueta "sem fala" em Referências.
     */
    semFala: boolean("sem_fala"),
    /** titulo + descricao + transcricao + analise.assunto, para busca de evidencia. */
    busca: tsvector("busca").generatedAlwaysAs(
      sql`to_tsvector('portuguese', coalesce(titulo, '') || ' ' || coalesce(descricao, '') || ' ' || coalesce(transcricao, '') || ' ' || coalesce(analise ->> 'assunto', ''))`,
    ),
    /**
     * "coleta" veio do Apify ou da YouTube Data API, "seed" e exemplo de
     * desenvolvimento, "curadoria" foi posto pela equipe, "meta" veio da
     * Business Discovery ou da Hashtag Search da Meta (E6 parte 3, segunda
     * rodada, item 2).
     */
    origem: text("origem")
      .$type<"coleta" | "seed" | "curadoria" | "meta">()
      .notNull()
      .default("coleta"),
    /**
     * Video da Hashtag Search da Meta (E6 parte 3, segunda rodada, item 3):
     * `contaId` fica nulo (a Hashtag Search nunca devolve a conta dona).
     * Nunca recebe mediana nem multiplo (nao ha conta para comparar); so
     * serve de sinal de assunto para o tema do dia, via a transcricao e a
     * extracao, como qualquer outro video.
     */
    semDono: boolean("sem_dono").notNull().default(false),
    /**
     * Execucao de job que trouxe este video (E6 parte 3, terceira rodada,
     * item 5): so preenchida na insercao (nunca no ON CONFLICT DO UPDATE de
     * `upsertVideo`), nula para todo video que ja existia antes desta
     * coluna. E como o admin de jobs calcula, por execucao de coleta paga,
     * quantos dos resultados novos viraram fora da curva (a "taxa de
     * acerto" da rodada).
     */
    execucaoId: integer("execucao_id").references(() => execucoesJob.id),
    /**
     * Endereço de mídia direto (CDN) que a Business Discovery da Meta
     * devolve, quando devolve (V2a, item 3): `transcrever` e
     * `analisar-visual` baixam por ele em vez do `yt-dlp` contra a página
     * do Instagram, sem precisar do extrator específico da plataforma.
     * Expira (a Meta não documenta em quanto tempo); `midiaUrlEm` é quando
     * foi lida, para só usar a url enquanto ainda está fresca.
     */
    midiaUrl: text("midia_url"),
    midiaUrlEm: timestamp("midia_url_em", { withTimezone: true }),
    /**
     * Quando a leitura de verdade aconteceu (ajuste 1 da revisão do PR #45,
     * V2a): `transcrever` (e o `meta-hashtags`, que transcreve na hora) grava
     * `transcritoEm` no sucesso, `analisar-visual` grava `analiseVisualEm`.
     * `atualizadoEm` não serve para isso: `upsertVideo` grava em toda
     * recoleta, e a coleta recolhe mais de mil vídeos por dia (medido em
     * produção em 19/09: 77 "transcritos hoje" contra 8 transcrições de
     * verdade). `upsertVideo` nunca toca nestas duas. Nulas para tudo que
     * já existia antes da migração 0023: não há como saber quando foi lido.
     */
    transcritoEm: timestamp("transcrito_em", { withTimezone: true }),
    analiseVisualEm: timestamp("analise_visual_em", { withTimezone: true }),
    /**
     * Idioma do video (V2b, item 1, escopo 5.11: o Brasil primeiro), nulo
     * quando nao da para saber. Detectado por codigo na coleta a partir do
     * titulo e da descricao (`detectarIdioma`, `src/config/idioma.ts`) e
     * sobrescrito pela extracao em lote, que le a transcricao inteira
     * (item 3, mais confiavel que titulo/descricao). Valores: "pt", "en",
     * "es", "outro" (alfabeto nao latino ou idioma nao reconhecido).
     */
    idioma: text("idioma"),
    /**
     * Achado 3 da revisao do motor (01/10/2026): `true` quando `idioma` veio da fala de verdade
     * (a Groq ou a legenda do YouTube detectaram, `transcrever.ts`), nao so do titulo/descricao
     * nem do palpite da extracao a partir de um texto que pode ter saido forcado no idioma errado.
     * `aplicarResultadoExtracao` nao sobrescreve `idioma` quando isto e verdadeiro: a extracao lendo
     * a transcricao ja correta so repetiria o mesmo palpite, com mais chance de errar num texto
     * curto do que a deteccao da propria Groq.
     */
    idiomaConfirmado: boolean("idioma_confirmado").notNull().default(false),
    /**
     * O tipo de abertura deste vídeo (V4, escopo 5.12, item 5), gravado pela
     * extração em lote a partir do gancho e do formato (`extrair-coleta.ts`).
     * Nulo em todo vídeo extraído antes desta coluna existir, até
     * `scripts/preencher-tipo-abertura.ts` rodar (item 2). É o que
     * `escolherTipoAbertura` (`servicos/roteiro.ts`) lê para decidir a
     * abertura do próximo roteiro sem repetir os últimos 5 do cliente.
     */
    tipoAbertura: text("tipo_abertura").$type<TipoAbertura>(),
    /**
     * H4, item 2 (achado do Gustavo em produção em 01/10, o caso do roteiro 12): o que a
     * extração classificou este vídeo como, e se ele serve de modelo de estrutura para um
     * roteiro. `serveDeModelo` é falso para "recorte" e "meme": continuam contando como sinal
     * de assunto para o tema do dia, nunca como modelo de roteiro nem como "de onde veio"
     * (`evidenciaParaRoteiro`, `pesquisa.ts`, filtra por esta coluna; `evidenciaParaTema` não
     * filtra, o sinal de assunto continua valendo para qualquer tipo). Colunas próprias, não só
     * dentro de `analise`, para o filtro valer em SQL. Nulas em todo vídeo analisado antes
     * delas existirem, até a reclassificação em lote rodar (`scripts/reclassificar-tipo-conteudo.ts`);
     * nulo não exclui da evidência do roteiro, só `false` explícito exclui.
     */
    tipoConteudo: text("tipo_conteudo").$type<TipoConteudo>(),
    serveDeModelo: boolean("serve_de_modelo"),
    /**
     * E44 PR 1: o formato do vídeo pela lista fechada do estudo (`config/formatos.ts`: as treze chaves do cliente mais os valores que nunca servem de modelo),
     * gravado pela extração. Nulo em todo vídeo analisado antes dele existir, até a reclassificação em lote rodar (`scripts/reclassificar-formato.ts`); nulo
     * passa como antes (o corte da H4). O `analise.formato` de cinco valores e o `tipo_conteudo` continuam gravados até o PR 2.
     */
    formatoCatalogo: text("formato_catalogo"),
    /** E49 PR 2: "para que o vídeo parece feito" (as cinco fichas, `config/fichas.ts`), lido pela extração; nulo até ser classificado (valor fora da lista também vira nulo). */
    fichaCatalogo: text("ficha_catalogo").$type<Ficha>(),
    /**
     * E49 PR 2 (ajuste da revisão): quando a extração tentou ler o tipo e a ficha pela última vez. Um vídeo cujo valor o modelo devolveu nulo não volta a ser
     * candidato da reclassificação por 30 dias (sem isso pagaria a extração em toda rodada); nulo é "nunca tentado".
     */
    formatoTentadoEm: timestamp("formato_tentado_em", { withTimezone: true }),
    fichaTentadaEm: timestamp("ficha_tentada_em", { withTimezone: true }),
    /**
     * A miniatura do vídeo (V9d, item 0b, migração 0033): o cartão de
     * Referências não tinha prévia nenhuma (lacuna do PR #52), e o Gustavo
     * leu isso como "não aparece a prévia". YouTube monta a url por código
     * (`https://i.ytimg.com/vi/<id>/hqdefault.jpg`, sem chamada nova, nunca
     * gravada aqui); Instagram guarda o `thumbnail_url` que a Business
     * Discovery já devolve; TikTok, a capa que o Apify devolve (suspenso
     * desde 09/09). A Meta expira link de mídia; se o `<img>` falhar no
     * cliente, o cartão volta ao retângulo neutro, nunca quebrado.
     */
    capaUrl: text("capa_url"),
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
    /** Taxa de acerto por execucao (E6 parte 3, terceira rodada, item 5). */
    index("videos_execucao_id").on(t.execucaoId),
    /** Proporcao 70/30 por nicho (V2b, item 6): filtra por idioma dentro do nicho. */
    index("videos_nicho_idioma").on(t.nichoId, t.idioma),
    /**
     * R2b, item 1: o segmento "Todos" ordena por views sem o corte do piso nem do múltiplo, então
     * pode varrer um volume bem maior que "Fora da curva"; sem este índice, `ordem: "views"` cairia
     * no mesmo plano de `videos_nicho_publicado` (ordena por data, teria que reordenar tudo em
     * memória). `foraDaCurva` e `velocidadeRelativa` já tinham índice próprio; só `views` faltava.
     */
    index("videos_nicho_views").on(t.nichoId, t.views),
    // E44 PR 1: o filtro por formato ligado da marca (`formato_catalogo`).
    index("videos_nicho_formato").on(t.nichoId, t.formatoCatalogo),
    // E49 PR 2: os exemplos por ficha do Criar e o filtro "Parece feito para" das Referências.
    index("videos_nicho_ficha").on(t.nichoId, t.fichaCatalogo),
    // E46 PR 3: o Início e as Rotinas contam o que o dia coletou, transcreveu e analisou.
    index("videos_coletado_em").on(t.coletadoEm),
    index("videos_transcrito_em").on(t.transcritoEm),
    index("videos_analise_visual_em").on(t.analiseVisualEm),
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

/**
 * E53, assuntos que eu acompanho: até cinco por marca (texto livre mais os termos que a pessoa deu), acompanhados todo dia pelas notícias, nunca por vídeo. O sistema nunca sugere
 * assunto sozinho. Some sozinho depois de 30 dias sem a pessoa abrir uma notícia dele (`ultimoAbertoEm`, ou `criadoEm` se nunca abriu), a não ser que esteja fixado.
 */
export const assuntosDaMarca = pgTable(
  "assuntos_da_marca",
  {
    id: id(),
    clienteId: integer("cliente_id")
      .notNull()
      .references(() => clientes.id, { onDelete: "cascade" }),
    /** O que a pessoa escreveu ("política", "eleição 2026"). */
    texto: text("texto").notNull(),
    /** O que casa com uma notícia: o texto e os termos dados, todos comparados sem acento e sem maiúscula. */
    termos: jsonb("termos").$type<string[]>().notNull().default([]),
    fixado: boolean("fixado").notNull().default(false),
    ativo: boolean("ativo").notNull().default(true),
    criadoEm: criadoEm(),
    ultimoAbertoEm: timestamp("ultimo_aberto_em", { withTimezone: true }),
    /** Quando o assunto saiu sozinho por falta de uso (nulo: ainda ativo ou tirado à mão). */
    expiradoEm: timestamp("expirado_em", { withTimezone: true }),
  },
  (t) => [
    index("assuntos_da_marca_cliente").on(t.clienteId, t.ativo),
    // Um assunto ativo por texto (sem diferença de maiúscula) em cada marca: o que a tela confere, o banco garante.
    uniqueIndex("assuntos_da_marca_texto_unico").on(t.clienteId, sql`lower(${t.texto})`).where(sql`${t.ativo}`),
  ],
);
export type AssuntoDaMarca = typeof assuntosDaMarca.$inferSelect;

/**
 * E53: a notícia de um assunto. NUNCA o texto da matéria: o título, o veículo, a hora, o link para o original, a foto do veículo com o crédito (do RSS ou do `og:image` da página) e o resumo
 * NOSSO de duas linhas. Uma por assunto e por endereço.
 */
export const noticiasDoAssunto = pgTable(
  "noticias_do_assunto",
  {
    id: id(),
    assuntoId: integer("assunto_id")
      .notNull()
      .references(() => assuntosDaMarca.id, { onDelete: "cascade" }),
    titulo: text("titulo").notNull(),
    veiculo: text("veiculo").notNull(),
    url: text("url").notNull(),
    publicadoEm: timestamp("publicado_em", { withTimezone: true }),
    imagemUrl: text("imagem_url"),
    /** "Foto: G1" (o veículo da notícia, nunca a nossa). */
    imagemCredito: text("imagem_credito"),
    /** O resumo nosso, em duas linhas, escrito pelo modelo barato a partir do título e do trecho que o próprio feed oferece. */
    resumoNosso: text("resumo_nosso"),
    /** De onde veio: o RSS direto do veículo ou a busca do Google News. */
    origem: text("origem").$type<"rss" | "google">().notNull(),
    coletadoEm: timestamp("coletado_em", { withTimezone: true }).notNull().defaultNow(),
    /** A pessoa abriu esta notícia (mantém o assunto vivo). */
    abertaEm: timestamp("aberta_em", { withTimezone: true }),
  },
  (t) => [uniqueIndex("noticias_do_assunto_url").on(t.assuntoId, t.url), index("noticias_do_assunto_recentes").on(t.assuntoId, t.publicadoEm)],
);
export type NoticiaDoAssunto = typeof noticiasDoAssunto.$inferSelect;

export type ModeloNicho = {
  resumo: string;
  ganchos: { tipo: string; exemplo: string; frequencia: string }[];
  /**
   * M5b, achado 4 da revisão do motor (01/10/2026): percentis 25 a 75 da duração dos vídeos de
   * referência, calculados por SQL (`faixaDeDuracao`, `jobs/modelo-nicho.ts`), não mais inventados
   * pelo modelo (o schema exigia o campo, a entrada não tinha a duração de nenhum vídeo). Nulo
   * quando nenhum vídeo da evidência tem `duracaoS` gravado (comum em setor majoritariamente
   * Instagram, que não traz duração do ator).
   */
  duracaoTipicaS: { min: number; max: number } | null;
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
  /**
   * ids de noticias que sustentam o tema (correcao do dia 1 da etapa 14,
   * `PROXIMO.md`): opcional porque nao ha linha em `temas_dia` de producao
   * com este campo; le como `[]` quando ausente.
   */
  evidenciasNoticias?: number[];
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
    /**
     * M5b, item 3: `[]` quando o setor tentou hoje e ficou sem prova (nunca sobrescreve uma linha
     * com tema de verdade; `temas-do-dia.ts` confere antes de gravar). Não é "sem tentativa", é "já
     * tentou, sem sucesso".
     */
    temas: jsonb("temas").$type<TemaDoDia[]>().notNull(),
    /**
     * M5b, item 3: quantos vídeos (subindo hoje mais sem dono) havia na última tentativa sem
     * prova; nulo quando `temas` tem conteúdo de verdade (a contagem só importa para decidir se
     * vale tentar de novo). Evita que cada análise nova dispare outra rodada no modelo forte sem
     * ter chegado evidência nenhuma a mais desde a última tentativa.
     */
    candidatosNaUltimaTentativa: integer("candidatos_na_ultima_tentativa"),
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

/**
 * O rascunho de `/criar/tema-livre` (V5b, item 2, `PROXIMO.md`): o que a
 * pessoa digitou e ainda não avaliou. Uma linha por pessoa e por marca
 * (`usuarioId` + `clienteId` único), porque duas pessoas na mesma marca
 * podem estar escrevendo assuntos diferentes ao mesmo tempo. Sem prazo;
 * some só quando a avaliação daquele texto termina com sucesso (continua se
 * a avaliação der erro, para não perder o que a pessoa escreveu).
 */
export const rascunhosTemaLivre = pgTable(
  "rascunhos_tema_livre",
  {
    id: id(),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clienteId: integer("cliente_id")
      .notNull()
      .references(() => clientes.id, { onDelete: "cascade" }),
    texto: text("texto").notNull(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("rascunhos_tema_livre_usuario_cliente").on(t.usuarioId, t.clienteId)],
);

export type Objetivo = "alcance" | "engajamento" | "conversao";

/** E49 PR 1: as cinco fichas do "O que você quer que esse vídeo faça?" (só Reels); cada uma conta em um dos três objetivos (`config/fichas.ts`). */
export type Ficha = "veja" | "guardem" | "mandem" | "comentem" | "me_chamem";

/**
 * Força da evidência que sustenta o roteiro (V4, escopo 5.12, item 8):
 * calculada por código (`src/config/forca-evidencia.ts`), nunca pela IA.
 */
export type ForcaEvidencia = "forte" | "media" | "fraca";

/**
 * A figurinha nativa que um cartão de Story pode pedir (V9c, item 2; a
 * lista de `pesquisa/plataformas/docs/instagram/figurinhas-ajuda.md`,
 * restrita às que servem de interação por objetivo, R-IG-STORY-04);
 * "nenhuma" quando o cartão não pede interação nenhuma.
 */
export const FIGURINHAS_STORY = [
  "enquete",
  "emoji_deslizavel",
  "teste",
  "perguntas",
  "link",
  "localizacao",
  "mencao",
  "contagem_regressiva",
  "nenhuma",
] as const;
export type FigurinhaStory = (typeof FIGURINHAS_STORY)[number];

/** Um cartão de Story (V9c, item 2, `R-IG-STORY-03`): o que falar, o que mostrar, o texto fixo e a figurinha. */
export type CartaoStory = {
  oQueFalar: string;
  oQueMostrar: string;
  textoNaTela: string;
  figurinha: FigurinhaStory;
};

export type ConteudoRoteiro = {
  titulo: string;
  duracaoS: number;
  /**
   * Em Story (V9c), string vazia: a estrutura desse formato é `cartoes`,
   * abaixo. O schema de saída da IA (`ia/prompts/roteiro.ts`) aceita nulo
   * aqui; `gerarConteudo` (`servicos/roteiro.ts`) troca por "" antes de
   * gravar, para este tipo continuar `string` em todo o resto do código
   * (a tela e o PDF já checam `roteiro.formato`, não precisam checar nulo).
   */
  gancho: string;
  corpo: string;
  fechamento: string;
  chamadaFinal: string;
  /**
   * Em Story (V9c, item 2), de 1 a 5 (E40: era de 2 a 5, `R-IG-STORY-03`); em sem fala (M4, item
   * 2), de 2 a 5, mesma estrutura; nulo em Reels falado.
   */
  cartoes: CartaoStory[] | null;
  /**
   * Por que o modelo escreveu do jeito que escreveu (V9c, item 2, E36): uma
   * entrada por regra numerada que ele seguiu (`R-IG-STORY-04`, ...), com o
   * motivo em português de gente. Vazio em Reels nesta rodada (o bloco
   * estável por formato ainda não existe para Reels).
   */
  porQueAssim: { regra: string; motivo: string }[];
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
  /**
   * Nao havia video fora da curva sobre o tema no banco (etapa 11, ajuste da
   * revisao do PR #17): o roteiro foi escrito so a partir do perfil, do
   * modelo do nicho e da camada exclusiva, sem citar nenhuma evidencia. A
   * tela troca a secao "Referencia" por um aviso quando isto e verdadeiro.
   */
  semEvidencia: boolean;
  /**
   * Força da evidência que sustenta este roteiro (V4, item 6): nula só
   * quando `semEvidencia` é verdadeiro (nada para medir). Mostrada no
   * cartão "de onde veio", fraca escrita sem esconder.
   */
  forcaEvidencia: ForcaEvidencia | null;
  /**
   * M4: a legenda do post, pronta para copiar, com a chamada para ação dentro dela. Só existe no
   * estilo sem fala (o falado já entrega a chamada final como fala); ausente ou nula no estilo
   * falado e em todo roteiro gravado antes desta coluna existir. Opcional (e não `null` obrigatório
   * como `cartoes`) de propósito: evita reescrever toda fixture de teste que monta um
   * `ConteudoRoteiro` de exemplo sem saber deste campo novo. A tela mostra como o último cartão,
   * com copiar (item 5).
   */
  legenda?: string | null;
};

/**
 * O que a pessoa contou sobre o momento que esta vivendo agora (V9a, item 1,
 * "Gravar agora"): preenchido por transcricao de audio (`lerMomento.ts`) ou
 * digitado direto na folha. `marcaId` so existe quando a pessoa e membro de
 * mais de uma marca e escolheu "Falar de" uma marca diferente da ativa
 * (item 4); `transcricao` guarda a fala inteira, mostrada no bloco "o que
 * voce disse", e fica nula quando o caminho foi so por texto.
 */
export type Momento = {
  onde: string;
  oQueEstaAcontecendo: string;
  oQueDaParaMostrar: string;
  marcaId?: number;
  transcricao?: string;
  /** E40, item 2: "o que este vídeo precisa comunicar?", campo opcional e curto. */
  objetivoDoVideo?: string;
};

/**
 * E39b, item (a): a resposta guardada de "ainda vale?", para não repetir a chamada de IA a cada
 * abertura da tela (`conferirAindaVale`, `servicos/roteiro.ts`). `videoId` aponta para `videos.id`,
 * a evidência nova citada; `assunto` vem da própria análise do vídeo, para o botão "Criar um novo
 * sobre isso" já ter o texto do tema livre pronto, sem precisar buscar de novo.
 */
export type AindaValeResultado = { vale: true } | { vale: false; videoId: number; assunto: string };

export const roteiros = pgTable(
  "roteiros",
  {
    id: id(),
    clienteId: integer("cliente_id")
      .notNull()
      .references(() => clientes.id),
    data: date("data").notNull(),
    tema: text("tema").notNull(),
    origem: text("origem").$type<"sugerido" | "livre" | "momento">().notNull(),
    /**
     * So preenchido quando `origem = "momento"` (V9a, item 1): o roteiro
     * nasceu do que a pessoa contou estar vivendo agora, sem busca de
     * evidencia no banco (`resolverTema` pula a busca para esta origem).
     */
    momento: jsonb("momento").$type<Momento>(),
    objetivo: text("objetivo").$type<Objetivo>().notNull(),
    /** E49 PR 1: a ficha escolhida (só Reels). Nula no Story e em todo roteiro de antes das fichas, que valem pela ficha padrão do objetivo. */
    ficha: text("ficha").$type<Ficha>(),
    /** V9c, item 1: "reels" (padrão) ou "story"; reescrever mantém o formato da versão anterior. */
    formato: text("formato").$type<FormatoRoteiro>().notNull().default("reels"),
    /** M4, item 2: "falado" (padrão) ou "sem_fala", ortogonal ao formato; reescrever mantém o estilo da versão anterior. */
    estilo: text("estilo").$type<EstiloRoteiro>().notNull().default("falado"),
    /**
     * E40, item 2: "o que este vídeo precisa comunicar?", campo opcional e curto que a pessoa
     * escreve no tema livre, na folha do momento ou no dia do plano (mesmo nome em
     * `planoGravacoes`, abaixo). Entra no prompt como instrução de primeira ordem e aparece no
     * topo da tela do roteiro. Nulo quando a pessoa não escreveu nada.
     */
    objetivoDoVideo: text("objetivo_do_video"),
    /**
     * V12c, item 3, a E37b: quem aparece neste vídeo, só quando a pessoa
     * trocou na folha "Gravar agora" ou no passo do objetivo; nulo usa o
     * `quemGrava` do briefing (`resolverQuemAparece`, `servicos/roteiro.ts`).
     * Troca só vale para este roteiro, o briefing não muda.
     */
    quemAparece: text("quem_aparece").$type<QuemGrava>(),
    /**
     * E39a: a parte do dia deste Story, respondida em "Para quando é?" (Criar, dúvida 12). Nula em
     * Reels (a pergunta nem aparece) e em todo roteiro de antes desta coluna existir; a Agenda
     * ordena os Stories do dia por ela, com "livre" (campo nulo) por último.
     */
    momentoDoDia: text("momento_do_dia").$type<MomentoDoDia>(),
    conteudo: jsonb("conteudo").$type<ConteudoRoteiro>().notNull(),
    /**
     * E40, item 1: a versão original, preservada só na primeira edição da pessoa (edições
     * seguintes não sobrescrevem, `conteudoOriginal` continua sendo a versão que a IA escreveu).
     * Nulo em todo roteiro nunca editado.
     */
    conteudoOriginal: jsonb("conteudo_original").$type<ConteudoRoteiro>(),
    /**
     * E40, item 1: verdadeiro a partir da primeira vez que a pessoa salva uma edição manual (sem
     * chamar a IA). O PDF, o modo de leitura e o Histórico mostram `conteudo`, que já é a versão
     * editada; esta coluna é só o sinal para a tela e para o aprendizado (E27, parte 2).
     */
    editadoPelaPessoa: boolean("editado_pela_pessoa").notNull().default(false),
    /** E40, item 1: a edição mais recente, para `aprender-cliente` janelar por 90 dias igual à reprovação. */
    editadoEm: timestamp("editado_em", { withTimezone: true }),
    /**
     * O tipo de abertura que o modelo declarou ter usado (V4, item 3): o
     * serviço lê os últimos 5 roteiros do cliente por esta coluna para não
     * repetir tipo (`escolherTipoAbertura`), e o verificador reprova quando
     * bate com o do roteiro anterior (`verificador.ts`). Nulo em todo
     * roteiro gerado antes desta coluna existir.
     */
    tipoAbertura: text("tipo_abertura").$type<TipoAbertura>(),
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
    /**
     * Quando esta versao foi reprovada (E27, parte 1, item 1): nulo na
     * versao em uso; marcado na versao anterior no momento em que
     * `reprovarERescrever` gera a proxima. Junto com a geracao dela
     * (`geracaoId`, `motivosAvaliacao`, `motivoAvaliacao`), e o que a tela
     * usa para mostrar "voce reprovou por: X e Y, em D de mes" no bloco de
     * versoes.
     */
    reprovadoEm: timestamp("reprovado_em", { withTimezone: true }),
    urlPostado: text("url_postado"),
    postadoEm: timestamp("postado_em", { withTimezone: true }),
    /**
     * E39b, item (b): quando a pessoa tirou um roteiro atrasado da Agenda sem gravar. Continua
     * existindo (e aparece no Histórico), só sai da lista de atrasados e da agenda do dia dele.
     */
    arquivadoEm: timestamp("arquivado_em", { withTimezone: true }),
    /** E39b, item (a): quando `conferirAindaVale` checou pela última vez; nulo até a pessoa tocar em "Conferir". */
    aindaValeChecadoEm: timestamp("ainda_vale_checado_em", { withTimezone: true }),
    aindaValeResultado: jsonb("ainda_vale_resultado").$type<AindaValeResultado>(),
    /**
     * E43: preenchida quando o roteiro nasceu de "Criar vídeo com esta notícia" (Tema livre,
     * estado `comNoticia`). É o que faz a notícia mostrar "virou roteiro" e "Ver o roteiro" para
     * quem já a transformou, isolado por marca (a mesma notícia pode virar roteiro em mais de uma
     * marca do mesmo setor).
     */
    noticiaId: integer("noticia_id").references(() => noticias.id),
    criadoEm: criadoEm(),
  },
  (t) => [index("roteiros_cliente_data").on(t.clienteId, t.data), index("roteiros_data").on(t.data)],
);

/**
 * O estado de um item do plano (V9b, E35 enxuta): "sugerido" é o que
 * `planejarDia` propôs; "aceito" quando a pessoa gera o roteiro a partir
 * dele (`roteiroId` preenchido); "gravado" quando esse roteiro é marcado
 * "Já gravei" (`servicos/plano.ts`, `marcarGravado`, ligado pelo
 * `roteiroId`); "pulado" some do bloco "o seu plano de hoje".
 */
export type EstadoPlano = "sugerido" | "aceito" | "gravado" | "pulado";

/**
 * O plano de gravações a partir da agenda colada (V9b, E35 enxuta, migração
 * 0030): uma linha por gravação sugerida num dia. `clienteId` é a marca dona
 * do plano (a agenda é da pessoa, mas o plano vive na marca ativa, mesma
 * regra do momento); `marcaId` é a marca citada nesse item ("Falar de" do
 * momento, item 4 da V9a), nula usa a marca ativa. Colar a agenda de novo
 * substitui o plano a partir de hoje (`servicos/plano.ts`, `limparPlano`); o
 * passado fica.
 */
export const planoGravacoes = pgTable(
  "plano_gravacoes",
  {
    id: id(),
    clienteId: integer("cliente_id")
      .notNull()
      .references(() => clientes.id),
    dia: date("dia").notNull(),
    /** A ordem dentro do dia (1 a 3 sugestões), para a lista sair sempre na mesma ordem. */
    ordem: integer("ordem").notNull(),
    lugar: text("lugar").notNull(),
    /** O compromisso da agenda que vira o momento (o `oQueEstaAcontecendo` do roteiro gerado). */
    situacao: text("situacao").notNull(),
    /** A sugestão de cena (o `oQueDaParaMostrar` do roteiro gerado). */
    oQueMostrar: text("o_que_mostrar").notNull(),
    objetivo: text("objetivo").$type<Objetivo>().notNull(),
    /** V9c, item 1: sugerido pelo objetivo (`sugerirFormatoPeloObjetivo`), a folha pré-preenchida respeita. */
    formato: text("formato").$type<FormatoRoteiro>().notNull().default("reels"),
    /** E40, item 2: mesmo campo de `roteiros.objetivoDoVideo`, preenchido já no dia do plano. */
    objetivoDoVideo: text("objetivo_do_video"),
    marcaId: integer("marca_id").references(() => clientes.id),
    estado: text("estado").$type<EstadoPlano>().notNull().default("sugerido"),
    /** Nulo até a pessoa aceitar (`servicos/plano.ts`, `aceitar`), gerando o roteiro (origem "momento"). */
    roteiroId: integer("roteiro_id").references(() => roteiros.id),
    criadoEm: criadoEm(),
  },
  (t) => [index("plano_gravacoes_cliente_dia").on(t.clienteId, t.dia)],
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
  /**
   * O id da midia na Graph API da Meta (V8, item 2), guardado na primeira vez
   * que `curva-cliente.ts` acha o video na conta do cliente (casando o codigo
   * curto do `idExterno` com o `permalink` de cada midia listada). Nas
   * medicoes seguintes, le a midia direto por este id (uma chamada so, sem
   * listar tudo de novo). Nunca sobrescreve `idExterno`: ele continua sendo o
   * codigo curto que monta a url do Apify (`buscarInstagramPorUrl`), a
   * reserva de sempre se a Meta falhar.
   */
  metaMediaId: text("meta_media_id"),
});

/** "youtube" e "meta" sao API oficial; "apify" e raspagem por url (V8, item 3). */
export type FonteMedida = "youtube" | "apify" | "meta";

export const metricasVideoCliente = pgTable("metricas_video_cliente", {
  id: id(),
  videoClienteId: integer("video_cliente_id")
    .notNull()
    .references(() => videosCliente.id),
  coletadoEm: timestamp("coletado_em", { withTimezone: true }).notNull().defaultNow(),
  views: integer("views").notNull().default(0),
  likes: integer("likes").notNull().default(0),
  comentarios: integer("comentarios").notNull().default(0),
  /** E49 PR 2: quantas vezes guardaram e mandaram o vídeo, só quando a rede devolve (a Meta, com a conta conectada); nulo é "sem número", nunca zero inventado. */
  saves: integer("saves"),
  shares: integer("shares"),
  /** De onde veio esta medida (V8, item 3); nula no que foi medido antes desta etapa. */
  fonte: text("fonte").$type<FonteMedida>(),
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
  /** Custo que falta no admin: o ramo da execução, quando ela é de um ramo só (o job rodou com `nichoId`); nulo na rodada de todos os ramos e nos jobs que não são por ramo. */
  ramoId: integer("ramo_id").references(() => nichos.id, { onDelete: "set null" }),
}, (t) => [index("execucoes_job_iniciado_em").on(t.iniciadoEm), index("execucoes_job_nome_id").on(t.nome, t.id)]);

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
  /** E49 PR 2: lote da reclassificação que só quer a ficha; quem já tem tipo o mantém (`aplicarResultadoExtracao`). */
  soFicha: boolean("so_ficha").notNull().default(false),
  videoIds: jsonb("video_ids").$type<number[]>().notNull().default([]),
  status: text("status")
    .$type<"em_andamento" | "concluido" | "erro">()
    .notNull()
    .default("em_andamento"),
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

/**
 * Uma linha por chamada da Graph API da Meta (E6 parte 3, segunda rodada,
 * item 1): o limite e 200 por hora, janela corrida, nao por dia calendario
 * como `consumo_api`; por isso uma tabela a parte, so com o instante da
 * chamada, em vez de um contador por data.
 */
export const chamadasMetaApi = pgTable(
  "chamadas_meta_api",
  {
    id: id(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chamadas_meta_api_criado_em").on(t.criadoEm)],
);

/**
 * Uma linha por termo ja resolvido em hashtag pela Meta (E6 parte 3,
 * segunda rodada, item 3): o limite de 30 hashtags unicas por semana e da
 * Meta (`ig_hashtag_search`, nao do `top_media`), entao guardar o
 * `hashtagId` aqui evita resolver de novo (e gastar mais uma das 30) um
 * termo que ja foi visto nos ultimos 7 dias, mesmo que dois nichos usem o
 * mesmo termo. `ultimoUsoEm` e o que conta como "usada esta semana".
 */
export const hashtagsMetaUsadas = pgTable(
  "hashtags_meta_usadas",
  {
    id: id(),
    termo: text("termo").notNull(),
    hashtagId: text("hashtag_id").notNull(),
    ultimoUsoEm: timestamp("ultimo_uso_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("hashtags_meta_usadas_termo").on(t.termo)],
);

/**
 * Como o cliente avaliou a geracao. "outro_angulo" e o nome antigo do fluxo
 * de reprovar (etapa 11); linhas gravadas antes da E27 continuam com esse
 * valor, nunca reescritas. "reprovado" e o fluxo novo (E27, parte 1),
 * sempre com `motivosAvaliacao` preenchido.
 */
export type AvaliacaoGeracao = "gostei" | "nao_gostei" | "outro_angulo" | "reprovado";

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
  /**
   * Custo que falta no admin: o ramo (setor) da geração, para a aba Custos separar o custo por ramo de verdade. Preenchido por `registrarGeracao`: o que a chamada diz, senão o `nichoId` das
   * entradas (tarefas de ramo), senão o ramo do vídeo (`entradas.videoId`), senão o ramo da conta (`clienteId`). Nulo em toda geração anterior a esta coluna e nas que não são de ramo.
   */
  ramoId: integer("ramo_id").references(() => nichos.id, { onDelete: "set null" }),
  /**
   * R1, item 0b (pedido do Gustavo em 01/10, captura do celular, "sempre demora mais"): quanto
   * tempo a chamada à IA levou, do pedido à resposta. Nulo em toda geração registrada antes
   * desta coluna existir. Fonte de dado real para calibrar a frase de espera (`TelaEscrevendo`,
   * `esperaDuracao`) em vez de impressão.
   */
  duracaoMs: integer("duracao_ms"),
  avaliacao: text("avaliacao").$type<AvaliacaoGeracao>(),
  motivoAvaliacao: text("motivo_avaliacao"),
  /**
   * Ids de `MOTIVOS_REPROVACAO` (E27, parte 1): so preenchido quando
   * `avaliacao = "reprovado"`; nulo nas linhas antigas de "outro_angulo" e
   * em toda avaliacao que nao e reprovacao. `motivoAvaliacao` continua com
   * o texto livre, dos dois fluxos.
   */
  motivosAvaliacao: jsonb("motivos_avaliacao").$type<string[]>(),
  criadoEm: criadoEm(),
}, (t) => [index("geracoes_ia_criado_em").on(t.criadoEm), index("geracoes_ia_ramo").on(t.ramoId, t.criadoEm)]);

/**
 * A memória do cliente (E27, parte 2): o que ele reprovou vira regra dele.
 * Um job barato (`src/jobs/aprender-cliente.ts`) lê as reprovações dos
 * últimos 90 dias e substitui o conjunto de regras ativas de origem
 * "reprovacao" a cada rodada; "manual" fica reservado, nada grava ainda.
 * Sem chave estrangeira para a geração que originou a regra: a regra é um
 * resumo consolidado, não um vínculo com uma reprovação específica.
 */
export type OrigemAprendizado = "reprovacao" | "manual";

export const aprendizadoCliente = pgTable(
  "aprendizado_cliente",
  {
    id: id(),
    clienteId: integer("cliente_id")
      .notNull()
      .references(() => clientes.id),
    /** Uma frase, em português de gente (tarefa `aprenderCliente`). */
    regra: text("regra").notNull(),
    /** Id de `MOTIVOS_REPROVACAO`; nulo quando a regra veio só do texto livre da reprovação. */
    motivoOrigem: text("motivo_origem"),
    /** Reprovações que sustentam esta regra nos últimos 90 dias; >= 2 é regra firme. */
    contagem: integer("contagem").notNull().default(1),
    primeiraEm: timestamp("primeira_em", { withTimezone: true }).notNull().defaultNow(),
    ultimaEm: timestamp("ultima_em", { withTimezone: true }).notNull().defaultNow(),
    /** Uma vez desativada (`"Não é bem assim"`), nunca volta sozinha, mesmo que o modelo a proponha de novo. */
    ativa: boolean("ativa").notNull().default(true),
    desativadaEm: timestamp("desativada_em", { withTimezone: true }),
    origem: text("origem").$type<OrigemAprendizado>().notNull().default("reprovacao"),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("aprendizado_cliente_cliente_id").on(t.clienteId)],
);

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
export type AprendizadoCliente = typeof aprendizadoCliente.$inferSelect;
export type ContextoMarca = typeof contextoMarca.$inferSelect;
export type ContextoMarcaItem = typeof contextoMarcaItens.$inferSelect;
export type PedidoDeRamo = typeof pedidosDeRamo.$inferSelect;
