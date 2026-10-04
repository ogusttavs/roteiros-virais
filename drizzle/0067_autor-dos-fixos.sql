ALTER TABLE "custos_fixos" ADD COLUMN "criado_por_usuario_id" text;--> statement-breakpoint
ALTER TABLE "custos_fixos" ADD COLUMN "atualizado_por_usuario_id" text;--> statement-breakpoint
ALTER TABLE "custos_fixos" ADD COLUMN "tirado_por_usuario_id" text;--> statement-breakpoint
ALTER TABLE "custos_fixos" ADD CONSTRAINT "custos_fixos_criado_por_usuario_id_user_id_fk" FOREIGN KEY ("criado_por_usuario_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custos_fixos" ADD CONSTRAINT "custos_fixos_atualizado_por_usuario_id_user_id_fk" FOREIGN KEY ("atualizado_por_usuario_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custos_fixos" ADD CONSTRAINT "custos_fixos_tirado_por_usuario_id_user_id_fk" FOREIGN KEY ("tirado_por_usuario_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;