CREATE TABLE "imagens_noticia" (
	"noticia_id" integer PRIMARY KEY NOT NULL,
	"situacao" text NOT NULL,
	"tipo" text,
	"bytes" "bytea",
	"origem" text,
	"tentativas" integer DEFAULT 1 NOT NULL,
	"tentou_em" timestamp with time zone DEFAULT now() NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "imagens_noticia" ADD CONSTRAINT "imagens_noticia_noticia_id_noticias_id_fk" FOREIGN KEY ("noticia_id") REFERENCES "public"."noticias"("id") ON DELETE cascade ON UPDATE no action;