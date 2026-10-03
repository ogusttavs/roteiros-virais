CREATE TABLE "perfis_analisados" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "perfis_analisados_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"perfil_citado_id" integer,
	"origem" text NOT NULL,
	"rede" text NOT NULL,
	"handle" text NOT NULL,
	"existe_na_rede" boolean DEFAULT true NOT NULL,
	"seguidores" integer,
	"contagem_videos_lidos" integer DEFAULT 0 NOT NULL,
	"leitura" text,
	"qualifica_para_setor" boolean DEFAULT false NOT NULL,
	"vira_do_setor_em" timestamp with time zone,
	"erro" text,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "perfis_analisados" ADD CONSTRAINT "perfis_analisados_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfis_analisados" ADD CONSTRAINT "perfis_analisados_perfil_citado_id_perfis_citados_id_fk" FOREIGN KEY ("perfil_citado_id") REFERENCES "public"."perfis_citados"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "perfis_analisados_cliente_rede_handle" ON "perfis_analisados" USING btree ("cliente_id","rede","handle");