CREATE TABLE "perfis_citados" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "perfis_citados_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"tipo" text NOT NULL,
	"rede" text NOT NULL,
	"handle" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "alcance" text;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "regiao" text;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "site" text;--> statement-breakpoint
ALTER TABLE "roteiros" ADD COLUMN "quem_aparece" text;--> statement-breakpoint
-- V12c, item 1: quem tem cidade vira "local" com a regiao preenchida, para nenhum roteiro
-- mudar sozinho (o Gustavo corrige as marcas dele a mao depois). Quem nao tem cidade fica
-- sem alcance (nulo), a pessoa escolhe no proprio /comecar ou na edicao do briefing.
UPDATE "clientes"
SET "alcance" = 'local',
    "regiao" = CASE WHEN "bairro" IS NOT NULL AND "bairro" <> '' THEN "cidade" || ', ' || "bairro" ELSE "cidade" END
WHERE "cidade" IS NOT NULL AND "cidade" <> '';--> statement-breakpoint
ALTER TABLE "perfis_citados" ADD CONSTRAINT "perfis_citados_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "perfis_citados_cliente_tipo_rede_handle" ON "perfis_citados" USING btree ("cliente_id","tipo","rede","handle");