import { History } from "lucide-react";

import { textosVazio } from "@/textos/vazio";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

export default function Historico() {
  return <EstadoVazio icone={History} frase={textosVazio.historico.frase} />;
}
