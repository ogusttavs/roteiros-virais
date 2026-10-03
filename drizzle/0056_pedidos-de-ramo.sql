CREATE TABLE "pedidos_de_ramo" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pedidos_de_ramo_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"texto" text NOT NULL,
	"setor_provisorio_id" integer,
	"estado" text DEFAULT 'aberto' NOT NULL,
	"resolucao" text,
	"setor_final_id" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"resolvido_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pedidos_de_ramo" ADD CONSTRAINT "pedidos_de_ramo_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedidos_de_ramo" ADD CONSTRAINT "pedidos_de_ramo_setor_provisorio_id_nichos_id_fk" FOREIGN KEY ("setor_provisorio_id") REFERENCES "public"."nichos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedidos_de_ramo" ADD CONSTRAINT "pedidos_de_ramo_setor_final_id_nichos_id_fk" FOREIGN KEY ("setor_final_id") REFERENCES "public"."nichos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pedidos_de_ramo_um_aberto_por_marca" ON "pedidos_de_ramo" USING btree ("cliente_id") WHERE "pedidos_de_ramo"."estado" = 'aberto';--> statement-breakpoint
CREATE INDEX "pedidos_de_ramo_estado" ON "pedidos_de_ramo" USING btree ("estado");
--> statement-breakpoint
-- E45 PR 2: as marcas que ja escolheram "Nao achei o meu" antes desta PR (o texto em `clientes.ramo_outro`, sem setor) viram pedidos abertos, para o admin ver
-- e resolver (antes, o texto ficava guardado e ninguem o lia). Idempotente: so quem ainda nao tem pedido aberto; marca desativada nao entra.
INSERT INTO "pedidos_de_ramo" ("cliente_id", "texto") SELECT c."id", trim(c."ramo_outro") FROM "clientes" c WHERE c."nicho_id" IS NULL AND c."ramo_outro" IS NOT NULL AND trim(c."ramo_outro") <> '' AND c."ativo" AND NOT EXISTS (SELECT 1 FROM "pedidos_de_ramo" p WHERE p."cliente_id" = c."id" AND p."estado" = 'aberto');
