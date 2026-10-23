ALTER TABLE "assinaturas" DROP CONSTRAINT "assinaturas_cliente_id_clientes_id_fk";
--> statement-breakpoint
ALTER TABLE "assinaturas" ADD CONSTRAINT "assinaturas_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE restrict ON UPDATE no action;