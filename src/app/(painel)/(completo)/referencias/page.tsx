import { Bookmark } from "lucide-react";

import { textosVazio } from "@/textos/vazio";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

export default function Referencias() {
  return <EstadoVazio icone={Bookmark} frase={textosVazio.referencias.frase} />;
}
