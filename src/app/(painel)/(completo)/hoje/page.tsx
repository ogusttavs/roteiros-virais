import { Video } from "lucide-react";

import { textosVazio } from "@/textos/vazio";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

export default function Hoje() {
  return <EstadoVazio icone={<Video size={24} strokeWidth={1.5} aria-hidden="true" />} frase={textosVazio.hoje.frase} />;
}
