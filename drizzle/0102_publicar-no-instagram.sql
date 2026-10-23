CREATE TABLE "publicacoes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "publicacoes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"roteiro_id" integer NOT NULL,
	"plataforma" text DEFAULT 'instagram' NOT NULL,
	"tipo" text NOT NULL,
	"estado" text DEFAULT 'enviando' NOT NULL,
	"legenda" text DEFAULT '' NOT NULL,
	"tamanho_bytes" integer NOT NULL,
	"tipo_do_arquivo" text NOT NULL,
	"container_id" text,
	"midia_id" text,
	"permalink" text,
	"motivo" text,
	"codigo_meta" integer,
	"subcodigo_meta" integer,
	"conferencias" integer DEFAULT 0 NOT NULL,
	"criada_por" text,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"terminada_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "contas_conectadas" ADD COLUMN "publicar_liberado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "publicacoes" ADD CONSTRAINT "publicacoes_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publicacoes" ADD CONSTRAINT "publicacoes_roteiro_id_roteiros_id_fk" FOREIGN KEY ("roteiro_id") REFERENCES "public"."roteiros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publicacoes" ADD CONSTRAINT "publicacoes_criada_por_user_id_fk" FOREIGN KEY ("criada_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publicacoes_marca_roteiro" ON "publicacoes" USING btree ("cliente_id","roteiro_id");--> statement-breakpoint
CREATE UNIQUE INDEX "publicacoes_uma_viva_por_roteiro_e_tipo" ON "publicacoes" USING btree ("roteiro_id","tipo") WHERE "publicacoes"."estado" in ('enviando', 'processando', 'publicando', 'publicada');