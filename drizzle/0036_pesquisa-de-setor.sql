CREATE TABLE "pesquisas_setor" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pesquisas_setor_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nicho_id" integer NOT NULL,
	"resumo" jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contas" ADD COLUMN "removida_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pesquisas_setor" ADD CONSTRAINT "pesquisas_setor_nicho_id_nichos_id_fk" FOREIGN KEY ("nicho_id") REFERENCES "public"."nichos"("id") ON DELETE no action ON UPDATE no action;