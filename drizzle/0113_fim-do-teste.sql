ALTER TABLE "assinaturas" ADD COLUMN "comecou_como_teste" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assinaturas" ADD COLUMN "primeiro_pagamento_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assinaturas" ADD COLUMN "atrasada_desde" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assinaturas" ADD COLUMN "tem_forma_de_pagamento" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assinaturas" ADD COLUMN "fim_do_teste_avisado_em" timestamp with time zone;