-- Convite de grupo (27/11/2026). So CREATE TABLE/INDEX IF NOT EXISTS, nenhuma mudanca em tabela que ja existe.
-- O "when" desta migracao no _journal.json e 1795694483271, uma unidade acima da 0125_responsavel-tecnico (1795694483270, a ultima em producao): o migrator do drizzle so aplica uma
-- migracao cujo "when" seja MAIOR que o created_at da ultima aplicada no banco, entao um "when" maior que o das migracoes dos PRs ainda abertos (0126 e 0128, 1795694600000 e
-- 1795723165294) as deixaria sem aplicar quando entrassem depois desta. Com este valor, as tres entram em qualquer ordem.
CREATE TABLE IF NOT EXISTS "convites_de_grupo" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "convites_de_grupo_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"codigo_hash" text NOT NULL,
	"rotulo" text NOT NULL,
	"nicho_id" integer NOT NULL,
	"marcas_max" integer DEFAULT 5 NOT NULL,
	"cortesia" boolean DEFAULT true NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"usado_por" text,
	"usado_em" timestamp with time zone,
	"desativado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "convites_de_grupo_codigo_hash_unique" UNIQUE("codigo_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "marcas_do_grupo" (
	"cliente_id" integer PRIMARY KEY NOT NULL,
	"convite_id" integer NOT NULL,
	"usuario_id" text NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "convites_de_grupo" ADD CONSTRAINT "convites_de_grupo_nicho_id_nichos_id_fk" FOREIGN KEY ("nicho_id") REFERENCES "public"."nichos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "convites_de_grupo" ADD CONSTRAINT "convites_de_grupo_usado_por_user_id_fk" FOREIGN KEY ("usado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "marcas_do_grupo" ADD CONSTRAINT "marcas_do_grupo_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "marcas_do_grupo" ADD CONSTRAINT "marcas_do_grupo_convite_id_convites_de_grupo_id_fk" FOREIGN KEY ("convite_id") REFERENCES "public"."convites_de_grupo"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "marcas_do_grupo" ADD CONSTRAINT "marcas_do_grupo_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marcas_do_grupo_usuario_id" ON "marcas_do_grupo" USING btree ("usuario_id");