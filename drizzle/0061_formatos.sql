CREATE TABLE "formatos_da_marca" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "formatos_da_marca_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"chave" text NOT NULL,
	"ligada" boolean NOT NULL,
	"quem" text NOT NULL,
	"decidido_por_usuario_id" text,
	"decidido_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "formato_catalogo" text;--> statement-breakpoint
ALTER TABLE "formatos_da_marca" ADD CONSTRAINT "formatos_da_marca_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formatos_da_marca" ADD CONSTRAINT "formatos_da_marca_decidido_por_usuario_id_user_id_fk" FOREIGN KEY ("decidido_por_usuario_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "formatos_da_marca_chave" ON "formatos_da_marca" USING btree ("cliente_id","chave","quem");--> statement-breakpoint
CREATE INDEX "videos_nicho_formato" ON "videos" USING btree ("nicho_id","formato_catalogo");