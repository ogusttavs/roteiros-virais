CREATE TABLE "custos_externos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "custos_externos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"fonte" text NOT NULL,
	"custo_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"unidades" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unidade" text NOT NULL,
	"ramo_id" integer,
	"execucao_id" integer,
	"origem_do_custo" text DEFAULT 'estimado' NOT NULL,
	"detalhe" jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "execucoes_job" ADD COLUMN "ramo_id" integer;--> statement-breakpoint
ALTER TABLE "geracoes_ia" ADD COLUMN "ramo_id" integer;--> statement-breakpoint
ALTER TABLE "custos_externos" ADD CONSTRAINT "custos_externos_ramo_id_nichos_id_fk" FOREIGN KEY ("ramo_id") REFERENCES "public"."nichos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custos_externos" ADD CONSTRAINT "custos_externos_execucao_id_execucoes_job_id_fk" FOREIGN KEY ("execucao_id") REFERENCES "public"."execucoes_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custos_externos_criado_em" ON "custos_externos" USING btree ("criado_em");--> statement-breakpoint
CREATE INDEX "custos_externos_ramo" ON "custos_externos" USING btree ("ramo_id","criado_em");--> statement-breakpoint
ALTER TABLE "execucoes_job" ADD CONSTRAINT "execucoes_job_ramo_id_nichos_id_fk" FOREIGN KEY ("ramo_id") REFERENCES "public"."nichos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geracoes_ia" ADD CONSTRAINT "geracoes_ia_ramo_id_nichos_id_fk" FOREIGN KEY ("ramo_id") REFERENCES "public"."nichos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "geracoes_ia_ramo" ON "geracoes_ia" USING btree ("ramo_id","criado_em");