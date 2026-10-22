CREATE TABLE "senhas_provisorias" (
	"usuario_id" text PRIMARY KEY NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "senhas_provisorias" ADD CONSTRAINT "senhas_provisorias_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;