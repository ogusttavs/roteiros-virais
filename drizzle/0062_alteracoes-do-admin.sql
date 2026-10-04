CREATE TABLE "alteracoes_do_admin" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "alteracoes_do_admin_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"por_usuario_id" text,
	"campo" text NOT NULL,
	"antes" text,
	"depois" text,
	"em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alteracoes_do_admin" ADD CONSTRAINT "alteracoes_do_admin_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alteracoes_do_admin" ADD CONSTRAINT "alteracoes_do_admin_por_usuario_id_user_id_fk" FOREIGN KEY ("por_usuario_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alteracoes_do_admin_cliente_em" ON "alteracoes_do_admin" USING btree ("cliente_id","em");