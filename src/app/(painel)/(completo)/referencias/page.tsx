import { Bookmark } from "lucide-react";

import { textosVazio } from "@/textos/vazio";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

export default function Referencias() {
  return (
    <EstadoVazio icone={<Bookmark size={24} strokeWidth={1.5} aria-hidden="true" />} frase={textosVazio.referencias.frase} />
  );
}
