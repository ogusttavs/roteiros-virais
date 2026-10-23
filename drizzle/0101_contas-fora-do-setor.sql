CREATE TABLE "contas_fora_do_setor" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contas_fora_do_setor_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"conta_id" integer NOT NULL,
	"nicho_id" integer NOT NULL,
	"origem" text NOT NULL,
	"motivo" text NOT NULL,
	"videos_conferidos" integer,
	"videos_fora_do_setor" integer,
	"marcada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"desfeita_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "contas_fora_do_setor" ADD CONSTRAINT "contas_fora_do_setor_conta_id_contas_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."contas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contas_fora_do_setor" ADD CONSTRAINT "contas_fora_do_setor_nicho_id_nichos_id_fk" FOREIGN KEY ("nicho_id") REFERENCES "public"."nichos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contas_fora_do_setor_conta_nicho" ON "contas_fora_do_setor" USING btree ("conta_id","nicho_id");