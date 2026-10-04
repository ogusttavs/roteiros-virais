CREATE TABLE "ver_como_entradas" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ver_como_entradas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"admin_id" text NOT NULL,
	"pessoa_id" text NOT NULL,
	"cliente_id" integer NOT NULL,
	"entrou_em" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"saiu_em" timestamp with time zone,
	"motivo_saida" text
);
--> statement-breakpoint
ALTER TABLE "ver_como_entradas" ADD CONSTRAINT "ver_como_entradas_admin_id_user_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ver_como_entradas" ADD CONSTRAINT "ver_como_entradas_pessoa_id_user_id_fk" FOREIGN KEY ("pessoa_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ver_como_entradas" ADD CONSTRAINT "ver_como_entradas_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ver_como_entradas_conta" ON "ver_como_entradas" USING btree ("cliente_id","entrou_em");--> statement-breakpoint
CREATE INDEX "ver_como_entradas_admin" ON "ver_como_entradas" USING btree ("admin_id","saiu_em");