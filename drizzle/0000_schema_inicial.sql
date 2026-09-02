CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "avaliacoes_tema" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "avaliacoes_tema_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"tema" text NOT NULL,
	"pilares" jsonb NOT NULL,
	"nota" numeric(4, 2) NOT NULL,
	"recomendacao" text NOT NULL,
	"angulo_sugerido" text,
	"evidencias" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "briefings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "briefings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"respostas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"avaliacoes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"nota_geral" numeric(4, 2),
	"completo" boolean DEFAULT false NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "briefings_cliente_id_unique" UNIQUE("cliente_id")
);
--> statement-breakpoint
CREATE TABLE "clientes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "clientes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"usuario_id" text NOT NULL,
	"nome" text NOT NULL,
	"nicho_id" integer,
	"cidade" text,
	"bairro" text,
	"persona" text DEFAULT 'negocio' NOT NULL,
	"perfis" jsonb,
	"quem_grava" text,
	"camada_exclusiva" jsonb DEFAULT '{"concorrentes":[],"termos":[],"perfis":[]}'::jsonb NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clientes_usuario_id_unique" UNIQUE("usuario_id")
);
--> statement-breakpoint
CREATE TABLE "contas" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"plataforma" text NOT NULL,
	"handle" text NOT NULL,
	"nome" text,
	"url" text,
	"seguidores" integer,
	"nicho_id" integer,
	"vigiada" boolean DEFAULT false NOT NULL,
	"mediana_views" numeric(14, 2),
	"taxa_fora_da_curva" numeric(6, 4),
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execucoes_job" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "execucoes_job_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nome" text NOT NULL,
	"iniciado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"terminado_em" timestamp with time zone,
	"status" text DEFAULT 'rodando' NOT NULL,
	"resumo" jsonb,
	"erro" text
);
--> statement-breakpoint
CREATE TABLE "favoritos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "favoritos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"video_id" integer NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geracoes_ia" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "geracoes_ia_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tarefa" text NOT NULL,
	"versao_prompt" text NOT NULL,
	"modelo" text NOT NULL,
	"cliente_id" integer,
	"entradas" jsonb NOT NULL,
	"evidencias" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"saida" jsonb,
	"tokens_entrada" integer DEFAULT 0 NOT NULL,
	"tokens_saida" integer DEFAULT 0 NOT NULL,
	"tokens_cache" integer DEFAULT 0 NOT NULL,
	"custo_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"avaliacao" text,
	"motivo_avaliacao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metricas_video_cliente" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "metricas_video_cliente_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"video_cliente_id" integer NOT NULL,
	"coletado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"comentarios" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modelos_nicho" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "modelos_nicho_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nicho_id" integer NOT NULL,
	"semana" date NOT NULL,
	"modelo" jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nichos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "nichos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"termos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nichos_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "noticias" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "noticias_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nicho_id" integer,
	"titulo" text NOT NULL,
	"url" text NOT NULL,
	"fonte" text,
	"publicado_em" timestamp with time zone,
	"resumo" text,
	"relevante" boolean,
	"angulo" text,
	"coletado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "noticias_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "roteiros" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "roteiros_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"data" date NOT NULL,
	"tema" text NOT NULL,
	"origem" text NOT NULL,
	"objetivo" text NOT NULL,
	"conteudo" jsonb NOT NULL,
	"referencia_video_id" integer,
	"versao" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'gerado' NOT NULL,
	"url_postado" text,
	"postado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "temas_dia" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "temas_dia_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nicho_id" integer NOT NULL,
	"data" date NOT NULL,
	"temas" jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "videos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"plataforma" text NOT NULL,
	"id_externo" text NOT NULL,
	"url" text NOT NULL,
	"conta_id" integer,
	"nicho_id" integer,
	"titulo" text,
	"descricao" text,
	"publicado_em" timestamp with time zone,
	"duracao_s" integer,
	"views" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"comentarios" integer DEFAULT 0 NOT NULL,
	"fora_da_curva" numeric(10, 3),
	"velocidade" numeric(14, 3),
	"velocidade_relativa" numeric(10, 3),
	"transcricao" text,
	"analise" jsonb,
	"analise_visual" jsonb,
	"etiquetas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"busca" "tsvector" GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(titulo, '') || ' ' || coalesce(descricao, '') || ' ' || coalesce(transcricao, '') || ' ' || coalesce(analise ->> 'assunto', ''))) STORED,
	"origem" text DEFAULT 'coleta' NOT NULL,
	"coletado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "videos_cliente" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "videos_cliente_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"roteiro_id" integer,
	"plataforma" text,
	"url" text NOT NULL,
	"id_externo" text,
	"postado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ultima_coleta" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avaliacoes_tema" ADD CONSTRAINT "avaliacoes_tema_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_nicho_id_nichos_id_fk" FOREIGN KEY ("nicho_id") REFERENCES "public"."nichos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contas" ADD CONSTRAINT "contas_nicho_id_nichos_id_fk" FOREIGN KEY ("nicho_id") REFERENCES "public"."nichos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favoritos" ADD CONSTRAINT "favoritos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favoritos" ADD CONSTRAINT "favoritos_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geracoes_ia" ADD CONSTRAINT "geracoes_ia_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metricas_video_cliente" ADD CONSTRAINT "metricas_video_cliente_video_cliente_id_videos_cliente_id_fk" FOREIGN KEY ("video_cliente_id") REFERENCES "public"."videos_cliente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modelos_nicho" ADD CONSTRAINT "modelos_nicho_nicho_id_nichos_id_fk" FOREIGN KEY ("nicho_id") REFERENCES "public"."nichos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noticias" ADD CONSTRAINT "noticias_nicho_id_nichos_id_fk" FOREIGN KEY ("nicho_id") REFERENCES "public"."nichos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roteiros" ADD CONSTRAINT "roteiros_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roteiros" ADD CONSTRAINT "roteiros_referencia_video_id_videos_id_fk" FOREIGN KEY ("referencia_video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temas_dia" ADD CONSTRAINT "temas_dia_nicho_id_nichos_id_fk" FOREIGN KEY ("nicho_id") REFERENCES "public"."nichos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_conta_id_contas_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."contas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_nicho_id_nichos_id_fk" FOREIGN KEY ("nicho_id") REFERENCES "public"."nichos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos_cliente" ADD CONSTRAINT "videos_cliente_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos_cliente" ADD CONSTRAINT "videos_cliente_roteiro_id_roteiros_id_fk" FOREIGN KEY ("roteiro_id") REFERENCES "public"."roteiros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contas_plataforma_handle" ON "contas" USING btree ("plataforma","handle");--> statement-breakpoint
CREATE UNIQUE INDEX "favoritos_cliente_video" ON "favoritos" USING btree ("cliente_id","video_id");--> statement-breakpoint
CREATE INDEX "roteiros_cliente_data" ON "roteiros" USING btree ("cliente_id","data");--> statement-breakpoint
CREATE UNIQUE INDEX "temas_dia_nicho_data" ON "temas_dia" USING btree ("nicho_id","data");--> statement-breakpoint
CREATE UNIQUE INDEX "videos_plataforma_id_externo" ON "videos" USING btree ("plataforma","id_externo");--> statement-breakpoint
CREATE INDEX "videos_nicho_publicado" ON "videos" USING btree ("nicho_id","publicado_em");--> statement-breakpoint
CREATE INDEX "videos_nicho_fora_da_curva" ON "videos" USING btree ("nicho_id","fora_da_curva");--> statement-breakpoint
CREATE INDEX "videos_busca_idx" ON "videos" USING gin ("busca");