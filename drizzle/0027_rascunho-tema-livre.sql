CREATE TABLE "rascunhos_tema_livre" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rascunhos_tema_livre_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"usuario_id" text NOT NULL,
	"cliente_id" integer NOT NULL,
	"texto" text NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rascunhos_tema_livre" ADD CONSTRAINT "rascunhos_tema_livre_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rascunhos_tema_livre" ADD CONSTRAINT "rascunhos_tema_livre_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rascunhos_tema_livre_usuario_cliente" ON "rascunhos_tema_livre" USING btree ("usuario_id","cliente_id");