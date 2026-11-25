CREATE TABLE "animacoes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "animacoes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"roteiro_id" integer NOT NULL,
	"estado" text DEFAULT 'pedida' NOT NULL,
	"molde" text NOT NULL,
	"cenas" jsonb NOT NULL,
	"duracao_s" numeric(8, 3) NOT NULL,
	"caminho_previa" text,
	"caminho_final" text,
	"progresso" integer,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"motivo" text,
	"codigo_do_erro" text,
	"criada_por" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"final_expira_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "animacoes" ADD CONSTRAINT "animacoes_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animacoes" ADD CONSTRAINT "animacoes_roteiro_id_roteiros_id_fk" FOREIGN KEY ("roteiro_id") REFERENCES "public"."roteiros"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animacoes" ADD CONSTRAINT "animacoes_criada_por_user_id_fk" FOREIGN KEY ("criada_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "animacoes_marca_roteiro" ON "animacoes" USING btree ("cliente_id","roteiro_id");--> statement-breakpoint
CREATE UNIQUE INDEX "animacoes_uma_em_andamento_por_marca" ON "animacoes" USING btree ("cliente_id") WHERE "animacoes"."estado" in ('pedida', 'fazendo_previa', 'previa_pronta', 'fazendo_final');