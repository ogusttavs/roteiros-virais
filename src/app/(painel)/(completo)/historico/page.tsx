import { History } from "lucide-react";

import { textosVazio } from "@/textos/vazio";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

export default function Historico() {
  return (
    <EstadoVazio icone={<History size={24} strokeWidth={1.5} aria-hidden="true" />} frase={textosVazio.historico.frase} />
  );
}
