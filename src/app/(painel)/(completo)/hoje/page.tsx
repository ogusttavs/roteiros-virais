import { Video } from "lucide-react";

import { textosVazio } from "@/textos/vazio";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

export default function Hoje() {
  return <EstadoVazio icone={Video} frase={textosVazio.hoje.frase} />;
}
