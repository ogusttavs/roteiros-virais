CREATE TABLE "posts_prontos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "posts_prontos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"estado" text DEFAULT 'na_fila' NOT NULL,
	"legenda" text DEFAULT '' NOT NULL,
	"imagens" jsonb NOT NULL,
	"agora" boolean DEFAULT false NOT NULL,
	"container_id" text,
	"midia_id" text,
	"permalink" text,
	"motivo" text,
	"codigo_falha" text,
	"codigo_meta" integer,
	"subcodigo_meta" integer,
	"aviso" text,
	"criado_por" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"terminado_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "posts_prontos" ADD CONSTRAINT "posts_prontos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts_prontos" ADD CONSTRAINT "posts_prontos_criado_por_user_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_prontos_marca_estado" ON "posts_prontos" USING btree ("cliente_id","estado");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_prontos_um_publicando_por_marca" ON "posts_prontos" USING btree ("cliente_id") WHERE "posts_prontos"."estado" = 'publicando';