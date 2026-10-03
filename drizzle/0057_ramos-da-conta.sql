CREATE TABLE "ramos_da_conta" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ramos_da_conta_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cliente_id" integer NOT NULL,
	"nicho_id" integer NOT NULL,
	"ligado_por_usuario_id" text,
	"ligado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ramos_da_conta" ADD CONSTRAINT "ramos_da_conta_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ramos_da_conta" ADD CONSTRAINT "ramos_da_conta_nicho_id_nichos_id_fk" FOREIGN KEY ("nicho_id") REFERENCES "public"."nichos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ramos_da_conta" ADD CONSTRAINT "ramos_da_conta_ligado_por_usuario_id_user_id_fk" FOREIGN KEY ("ligado_por_usuario_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ramos_da_conta_marca_setor" ON "ramos_da_conta" USING btree ("cliente_id","nicho_id");--> statement-breakpoint
CREATE INDEX "ramos_da_conta_setor" ON "ramos_da_conta" USING btree ("nicho_id");