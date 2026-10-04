CREATE TABLE "configuracao_admin" (
	"chave" text PRIMARY KEY NOT NULL,
	"valor" text NOT NULL,
	"atualizado_por_usuario_id" text,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custos_fixos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "custos_fixos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nome" text NOT NULL,
	"valor" numeric(12, 2) NOT NULL,
	"moeda" text DEFAULT 'brl' NOT NULL,
	"periodo" text DEFAULT 'mensal' NOT NULL,
	"cobra" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"tirado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "configuracao_admin" ADD CONSTRAINT "configuracao_admin_atualizado_por_usuario_id_user_id_fk" FOREIGN KEY ("atualizado_por_usuario_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;