CREATE TABLE "membros_marca" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "membros_marca_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"usuario_id" text NOT NULL,
	"cliente_id" integer NOT NULL,
	"papel" text DEFAULT 'membro' NOT NULL,
	"ultimo_acesso_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preferencias_usuario" (
	"usuario_id" text PRIMARY KEY NOT NULL,
	"hora_lembrete" text DEFAULT '08:00' NOT NULL,
	"ultimo_lembrete_em" timestamp with time zone,
	"aceitou_termos_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "clientes" DROP CONSTRAINT "clientes_usuario_id_unique";--> statement-breakpoint
ALTER TABLE "membros_marca" ADD CONSTRAINT "membros_marca_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membros_marca" ADD CONSTRAINT "membros_marca_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preferencias_usuario" ADD CONSTRAINT "preferencias_usuario_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "membros_marca_usuario_cliente" ON "membros_marca" USING btree ("usuario_id","cliente_id");--> statement-breakpoint
CREATE INDEX "membros_marca_usuario_id" ON "membros_marca" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "membros_marca_cliente_id" ON "membros_marca" USING btree ("cliente_id");--> statement-breakpoint
-- V3, item 1: um membro "dono" para cada clientes.usuario_id existente (o unico dono possivel,
-- ja que ate aqui usuario_id era unico por clientes). A unique index acima cobre duplicata futura.
-- ultimo_acesso_em do membro comeca com o ultimo_acesso_em da propria marca: nao ha historico por
-- pessoa antes desta migracao, e e a melhor aproximacao disponivel (o dono e quem mais teria acessado).
INSERT INTO "membros_marca" ("usuario_id", "cliente_id", "papel", "ultimo_acesso_em")
SELECT "usuario_id", "id", 'dono', "ultimo_acesso_em" FROM "clientes";
--> statement-breakpoint
-- V3, itens 4, 6 e 7: hora_lembrete, ultimo_lembrete_em e aceitou_termos_em eram da marca,
-- viram da pessoa. Copia o valor do dono para preferencias_usuario.
INSERT INTO "preferencias_usuario" ("usuario_id", "hora_lembrete", "ultimo_lembrete_em", "aceitou_termos_em")
SELECT "usuario_id", "hora_lembrete", "ultimo_lembrete_em", "aceitou_termos_em" FROM "clientes";
-- As tres colunas ficam em "clientes", sem uso (saem do schema do Drizzle, so o codigo para de
-- ler e escrever nelas): tirar o DROP COLUMN daqui mantem o caminho de volta para a imagem
-- anterior se a V3 precisar ser desfeita em producao. A remocao e uma migracao de depois da
-- viagem (decisao da revisao do PR #47, 20/09/2026).
