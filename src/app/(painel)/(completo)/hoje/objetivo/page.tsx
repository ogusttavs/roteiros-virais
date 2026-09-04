import { Sparkles } from "lucide-react";

import { textosObjetivoProvisorio } from "@/textos/tema-livre";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

/**
 * Provisório (etapa 10, decisão 6 do `PROXIMO.md`): a etapa 11 escreve a
 * pergunta de objetivo e o roteiro de verdade aqui. Por enquanto só existe
 * para os botões de `/hoje` e `/hoje/tema-livre` terem para onde ir.
 */
export default function ObjetivoProvisorio() {
  return (
    <EstadoVazio
      icone={<Sparkles size={24} strokeWidth={1.5} aria-hidden="true" />}
      frase={textosObjetivoProvisorio.frase}
    />
  );
}
