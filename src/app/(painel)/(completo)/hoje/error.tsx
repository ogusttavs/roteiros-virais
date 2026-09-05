"use client";

import { captureException } from "@sentry/nextjs";
import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";

import { textosHoje } from "@/textos/hoje";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

/**
 * Estado de erro de `/hoje` (etapa 10, brief-frontend.md 6.3). `captureException`
 * aqui (etapa 13, decisao 1) so manda algo quando o Sentry do navegador
 * existir; nesta rodada, sem `Sentry.init` do lado do cliente, e um no-op
 * seguro que ja deixa o ponto certo pronto.
 */
export default function ErroHoje({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <EstadoVazio
      icone={<AlertTriangle size={24} strokeWidth={1.5} aria-hidden="true" />}
      frase={textosHoje.erro}
      acao={{ rotulo: textosHoje.tentarDeNovo, onClick: reset }}
    />
  );
}
