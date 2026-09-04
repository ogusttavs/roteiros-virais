"use client";

import { AlertTriangle } from "lucide-react";

import { textosHoje } from "@/textos/hoje";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

/** Estado de erro de `/hoje` (etapa 10, brief-frontend.md 6.3). */
export default function ErroHoje({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EstadoVazio
      icone={<AlertTriangle size={24} strokeWidth={1.5} aria-hidden="true" />}
      frase={textosHoje.erro}
      acao={{ rotulo: textosHoje.tentarDeNovo, onClick: reset }}
    />
  );
}
